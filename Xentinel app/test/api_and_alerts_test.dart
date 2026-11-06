import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xentinel/core/api_config.dart';
import 'package:xentinel/core/session.dart';
import 'package:xentinel/models/emergency_alert.dart';
import 'package:xentinel/models/xentinel_models.dart';
import 'package:xentinel/providers/alerts_provider.dart';
import 'package:xentinel/repositories/access_repository.dart';
import 'package:xentinel/repositories/alerts_repository.dart';
import 'package:xentinel/repositories/auth_repository.dart';
import 'package:xentinel/services/alert_events.dart';
import 'package:xentinel/services/api_client.dart';

const user = UserEntity(
  id: '7',
  name: 'Usuario de prueba',
  documentId: '1007',
  role: UserRole.guardia,
  status: AccessStatus.permitido,
);
Map<String, Object> alertJson({int id = 1, String severity = 'critica'}) => {
  'id_alerta': id,
  'tipo_alerta': 'Sismo',
  'mensaje': 'Siga las indicaciones del personal.',
  'activa': true,
  'severidad': severity,
  'fecha_inicio': '2026-10-21T00:00:00Z',
  'fuente': 'SENA',
};
http.Response ok(Object? data) =>
    http.Response(jsonEncode({'data': data}), 200);

void main() {
  late SessionStore session;
  setUp(() {
    session = SessionStore()..signIn(user, 'test-token', 900);
  });
  tearDown(() => session.dispose());
  ApiClient api(
    FutureOr<http.Response> Function(http.Request) handle, {
    Duration timeout = const Duration(seconds: 15),
  }) {
    final client = ApiClient(
      session,
      client: MockClient((request) async => handle(request)),
      baseUrl: 'https://api.example.test/api/v1',
      timeout: timeout,
    );
    addTearDown(client.close);
    return client;
  }

  test('authenticated requests carry JWT; 401 clears session', () async {
    final client = api((request) {
      expect(request.url.path, '/api/v1/alertas/activas');
      expect(request.headers['Authorization'], 'Bearer test-token');
      return http.Response(
        '{"error":{"code":"INVALID_TOKEN","message":"expired"}}',
        401,
      );
    });
    await expectLater(
      client.request('alertas/activas'),
      throwsA(isA<ApiException>()),
    );
    expect(session.user, isNull);
    expect(session.message, isNotNull);
  });

  test(
    'late 401 from previous session does not sign out the new user',
    () async {
      final response = Completer<http.Response>();
      final client = api((_) => response.future);
      final request = client.request('auth/me');
      await Future<void>.delayed(Duration.zero);
      session.signIn(user, 'new-token', 900);
      response.complete(http.Response('{"error":{"message":"expired"}}', 401));
      await expectLater(request, throwsA(isA<ApiException>()));
      expect(session.token, 'new-token');
    },
  );

  test(
    'password recovery uses real endpoint, email key, and no bearer',
    () async {
      final repository = AuthRepository(
        api((request) {
          expect(request.method, 'POST');
          expect(request.url.path, '/api/v1/auth/olvide-contrasena');
          expect(jsonDecode(request.body), {'correo': 'user@example.test'});
          expect(request.headers.containsKey('Authorization'), isFalse);
          return http.Response('{"data":{"message":"generic"}}', 202);
        }),
      );
      await repository.forgotPassword(' User@Example.test ');
    },
  );

  test(
    'malformed success and timeout are errors, never empty success',
    () async {
      await expectLater(
        api(
          (_) => http.Response('<html>proxy</html>', 200),
        ).request('alertas/activas'),
        throwsA(isA<ApiException>()),
      );
      final pending = Completer<http.Response>();
      await expectLater(
        api(
          (_) => pending.future,
          timeout: const Duration(milliseconds: 10),
        ).request('auth/me'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TIMEOUT')),
      );
      pending.complete(ok({}));
    },
  );

  test(
    'QR validation rejects malformed, future, expired, and out-of-range IDs before networking',
    () async {
      var calls = 0;
      final now = DateTime.utc(2026, 10, 21);
      final repository = AccessRepository(
        api((_) {
          calls++;
          return ok({});
        }),
        now: () => now,
      );
      for (final payload in [
        'XENTINEL:-1:1',
        'XENTINEL:999999999999:1',
        'invalid',
        'XENTINEL:7:${now.millisecondsSinceEpoch + 46000}',
        'XENTINEL:7:${now.millisecondsSinceEpoch - 46000}',
      ]) {
        expect(
          await repository.processScanPayload(
            payload: payload,
            isExitMode: false,
          ),
          isA<Denied>(),
        );
      }
      expect(calls, 0);
    },
  );

  test(
    'retry after lost response preserves idempotency key; new direction changes it',
    () async {
      final keys = <String>[];
      var calls = 0;
      final now = DateTime.utc(2026, 10, 21);
      final repository = AccessRepository(
        api((request) {
          final body = jsonDecode(request.body) as Map;
          keys.add(body['request_id'] as String);
          if (calls++ == 0) throw http.ClientException('offline');
          return ok({
            'id_usuarios': 7,
            'tipo': body['tipo'],
            'estado': 'Permitido',
          });
        }),
        now: () => now,
      );
      final payload = 'XENTINEL:7:${now.millisecondsSinceEpoch}';
      await expectLater(
        repository.processScanPayload(payload: payload, isExitMode: false),
        throwsA(isA<ApiException>()),
      );
      expect(
        await repository.processScanPayload(
          payload: payload,
          isExitMode: false,
        ),
        isA<Granted>(),
      );
      expect(
        await repository.processScanPayload(payload: payload, isExitMode: true),
        isA<Granted>(),
      );
      expect(keys[0], keys[1]);
      expect(keys[1], isNot(keys[2]));
    },
  );

  test('authorized scan exposes name, document, ficha and aula', () async {
    final now = DateTime.utc(2026, 10, 21);
    final repository = AccessRepository(
      api(
        (_) => ok({
          'id_usuarios': 7,
          'tipo': 'ENTRADA',
          'estado': 'Permitido',
          'persona': {
            'nombres_completos': 'Ana Aprendiz',
            'tipo_documento': 'TI',
            'numero_documento': '1007',
            'numero_ficha': '3407177',
            'ambiente': '302 Sede Fontibon',
          },
        }),
      ),
      now: () => now,
    );
    final result = await repository.processScanPayload(
      payload: 'XENTINEL:7:${now.millisecondsSinceEpoch}',
      isExitMode: false,
    );
    final person = (result as Granted).person!;
    expect(person.name, 'Ana Aprendiz');
    expect(person.document, 'TI 1007');
    expect(person.ficha, '3407177');
    expect(person.aula, '302 Sede Fontibon');
  });

  test('unknown user is yellow, not a network failure', () async {
    final now = DateTime.utc(2026, 10, 21);
    final repository = AccessRepository(
      api(
        (_) => http.Response(
          '{"error":{"code":"NOT_FOUND","message":"Usuario no encontrado"}}',
          404,
        ),
      ),
      now: () => now,
    );
    expect(
      await repository.processScanPayload(
        payload: 'XENTINEL:7:${now.millisecondsSinceEpoch}',
        isExitMode: false,
      ),
      isA<NotRegistered>(),
    );
  });

  test(
    'web credential is accepted and each confirmed read is a new movement',
    () async {
      final keys = <Object?>[];
      final repository = AccessRepository(
        api((request) {
          final body = jsonDecode(request.body) as Map;
          keys.add(body['request_id']);
          return ok({
            'id_usuarios': body['id_usuarios'],
            'tipo': body['tipo'],
            'estado': 'Permitido',
          });
        }),
      );
      const qr = '{"sistema":"Xentinel","version":1,"id_usuarios":7}';
      expect(
        await repository.processScanPayload(payload: qr, isExitMode: false),
        isA<Granted>(),
      );
      expect(
        await repository.processScanPayload(payload: qr, isExitMode: false),
        isA<Granted>(),
      );
      expect(keys[0], isNot(keys[1]));
      for (final invalid in [
        '{"sistema":"Otro","version":1,"id_usuarios":7}',
        '{"sistema":"Xentinel","version":1,"id_usuarios":"7"}',
        '{"sistema":"Xentinel","version":1,"id_usuarios":0}',
        '{roto',
      ]) {
        expect(
          await repository.processScanPayload(
            payload: invalid,
            isExitMode: false,
          ),
          isA<Denied>(),
        );
      }
    },
  );

  test('server address accepts the short forms typed in the app', () {
    expect(
      ApiConfig.normalizeServer(' 192.168.1.40:8000/ '),
      'http://192.168.1.40:8000/api/v1',
    );
    expect(
      ApiConfig.normalizeServer('https://demo.example'),
      'https://demo.example/api/v1',
    );
    expect(
      ApiConfig.normalizeServer('https://demo.example/api/v1'),
      'https://demo.example/api/v1',
    );
    expect(ApiConfig.normalizeServer('   '), isNull);
  });

  test(
    'access sequence conflict remains yellow; unexpected state never grants entry',
    () async {
      final now = DateTime.utc(2026, 10, 21);
      final conflict = AccessRepository(
        api(
          (_) => http.Response(
            '{"error":{"code":"ACCESS_SEQUENCE","message":"sequence"}}',
            409,
          ),
        ),
        now: () => now,
      );
      expect(
        await conflict.processScanPayload(
          payload: 'XENTINEL:7:${now.millisecondsSinceEpoch}',
          isExitMode: false,
        ),
        isA<Alert>(),
      );
      final invalid = AccessRepository(
        api(
          (_) => ok({'id_usuarios': 7, 'tipo': 'ENTRADA', 'estado': 'unknown'}),
        ),
        now: () => now,
      );
      await expectLater(
        invalid.processScanPayload(
          payload: 'XENTINEL:7:${now.millisecondsSinceEpoch}',
          isExitMode: false,
        ),
        throwsA(isA<ApiException>()),
      );
    },
  );

  test(
    'alerts sort by severity and unknown severity is not downgraded',
    () async {
      final repository = AlertsRepository(
        api(
          (_) =>
              ok([alertJson(id: 1, severity: 'informativa'), alertJson(id: 2)]),
        ),
      );
      expect((await repository.fetchActive()).map((a) => a.id), [2, 1]);
      expect(
        EmergencyAlert.fromApi(alertJson(severity: 'unknown')).severity,
        AlertSeverity.alta,
      );
    },
  );

  test(
    'SSE handles split UTF8, CRLF, multiple data lines and checkpoints',
    () async {
      const raw =
          ': heartbeat\r\nid: 42\r\nevent: change\r\ndata: {"recurso":\r\ndata: "alertas_emergencia", "mensaje":"Sísmica"}\r\n\r\nevent: checkpoint\ndata: {"cursor":"42"}\n\n';
      final bytes = utf8.encode(raw);
      final result = await decodeServerEvents(
        Stream.fromIterable(bytes.map((byte) => [byte])),
      ).toList();
      expect(result, hasLength(2));
      expect(result.first.id, '42');
      expect(result.first.data['mensaje'], 'Sísmica');
      expect(result.last.type, 'checkpoint');
    },
  );

  test(
    'network failures retain emergency; authoritative empty response clears it',
    () async {
      var response = 0;
      final monitor = AlertsMonitor(
        AlertsRepository(
          api((_) {
            if (response == 1) throw http.ClientException('offline');
            return ok(response == 0 ? [alertJson()] : []);
          }),
        ),
        session,
        enableEvents: false,
        pollInterval: const Duration(minutes: 1),
      );
      addTearDown(monitor.dispose);
      monitor.setActive(true);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(monitor.alerts, hasLength(1));
      response = 1;
      await monitor.refresh();
      expect(monitor.alerts, hasLength(1));
      expect(monitor.error, isNotNull);
      response = 2;
      await monitor.refresh();
      expect(monitor.alerts, isEmpty);
      expect(monitor.error, isNull);
      monitor.setActive(false);
    },
  );

  test(
    'pausing monitor stops new requests and disposing ignores late results',
    () async {
      final pending = Completer<http.Response>();
      var calls = 0;
      final monitor = AlertsMonitor(
        AlertsRepository(
          api((_) {
            calls++;
            return pending.future;
          }),
        ),
        session,
        enableEvents: false,
        pollInterval: const Duration(milliseconds: 100),
      );
      monitor.setActive(true);
      await Future<void>.delayed(Duration.zero);
      monitor.setActive(false);
      monitor.dispose();
      pending.complete(ok([alertJson()]));
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(calls, 1);
    },
  );
}

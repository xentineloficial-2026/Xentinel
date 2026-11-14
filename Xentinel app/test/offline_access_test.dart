import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xentinel/core/qr_codes.dart';
import 'package:xentinel/core/server_clock.dart';
import 'package:xentinel/core/session.dart';
import 'package:xentinel/models/xentinel_models.dart';
import 'package:xentinel/repositories/access_repository.dart';
import 'package:xentinel/services/access_outbox.dart';
import 'package:xentinel/services/api_client.dart';
import 'package:xentinel/services/network_status.dart';

import 'support/fakes.dart';

const celador = UserEntity(
  id: '9',
  name: 'Celador de prueba',
  documentId: '900',
  role: UserRole.guardia,
  status: AccessStatus.permitido,
);

const json = {'content-type': 'application/json; charset=utf-8'};

void main() {
  final key = List<int>.generate(32, (i) => i * 3);
  late SessionStore session;
  late MemoryOutboxPersistence storage;
  late AccessOutbox outbox;
  late FakeConnectivity connectivity;
  late NetworkStatus network;
  late List<Map<String, dynamic>> bodies;
  late http.Response Function(Map<String, dynamic> body) respond;

  setUp(() async {
    ServerClock.reset();
    session = SessionStore()..signIn(celador, 'token', 900);
    storage = MemoryOutboxPersistence();
    outbox = AccessOutbox(storage);
    connectivity = FakeConnectivity();
    network = NetworkStatus(connectivity);
    bodies = [];
    respond = (body) => http.Response(
      jsonEncode({
        'data': {
          'id_usuarios': 51,
          'tipo': body['tipo'],
          'estado': 'Permitido',
          'persona': {'nombres_completos': 'Laura Ríos'},
        },
      }),
      201,
      headers: json,
    );
    await Future<void>.delayed(Duration.zero);
  });
  tearDown(() {
    session.dispose();
    network.dispose();
    outbox.dispose();
  });

  AccessRepository repository({bool offlineHttp = false}) {
    final api = ApiClient(
      session,
      baseUrl: 'https://api.example.test/api/v1',
      client: MockClient((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        bodies.add(body);
        if (offlineHttp) throw http.ClientException('sin red');
        return respond(body);
      }),
    );
    addTearDown(api.close);
    return AccessRepository(
      api,
      outbox: outbox,
      session: session,
      network: network,
    );
  }

  String codeNow([int offsetSteps = 0]) => XentinelQr.generate(
    key,
    51,
    XentinelQr.stepAt(ServerClock.now()) + offsetSteps,
  );

  test(
    'signed carnet is sent for server verification, not a bare id',
    () async {
      final result = await repository().processScanPayload(
        payload: codeNow(),
        isExitMode: false,
      );
      expect(result, isA<Granted>());
      expect(bodies.single['codigo_qr'], startsWith('XN2:51:'));
      expect(bodies.single.containsKey('id_usuarios'), isFalse);
      expect(bodies.single.containsKey('escaneado_en'), isFalse);
    },
  );

  test(
    'server verdicts on signed carnets are explained to the guard',
    () async {
      for (final (code, text) in [
        ('INVALID_QR', 'revocado'),
        ('QR_EXPIRED', 'QR vencido'),
        ('QR_UNSIGNED', 'carnet firmado'),
      ]) {
        respond = (_) => http.Response(
          jsonEncode({
            'error': {'code': code, 'message': code},
          }),
          422,
        );
        final result = await repository().processScanPayload(
          payload: codeNow(),
          isExitMode: false,
        );
        expect((result as Denied).reason, contains(text));
      }
      expect(outbox.pending, isEmpty);
    },
  );

  test('a clearly old signed capture is rejected before networking', () async {
    final result = await repository().processScanPayload(
      payload: codeNow(-20),
      isExitMode: false,
    );
    expect((result as Denied).reason, contains('QR vencido'));
    expect(bodies, isEmpty);
  });

  test(
    'without connection the scan is queued once, survives restarts and syncs idempotently',
    () async {
      final offline = repository(offlineHttp: true);
      final first = await offline.processScanPayload(
        payload: codeNow(),
        isExitMode: false,
      );
      expect(first, isA<QueuedOffline>());
      expect((first as QueuedOffline).repeated, isFalse);
      // El carnet rota mientras sigue frente a la cámara: no se duplica.
      final again = await offline.processScanPayload(
        payload: codeNow(1),
        isExitMode: false,
      );
      expect((again as QueuedOffline).repeated, isTrue);
      expect(outbox.pending, hasLength(1));
      final queued = outbox.pending.single;
      expect(queued.operatorId, '9');
      expect(queued.signedCode, startsWith('XN2:51:'));

      // Reinicio de la app: la cola se recupera del almacenamiento.
      final restored = AccessOutbox(storage);
      await restored.load();
      expect(restored.pending.single.requestId, queued.requestId);
      restored.dispose();

      bodies.clear();
      final online = repository();
      expect(await online.syncPending(), 1);
      expect(bodies.single['request_id'], queued.requestId);
      expect(bodies.single['codigo_qr'], queued.signedCode);
      expect(
        DateTime.parse(bodies.single['escaneado_en'] as String),
        queued.scannedAt.toUtc(),
      );
      expect(outbox.pending, isEmpty);
      expect(outbox.issues, isEmpty);
    },
  );

  test(
    'known offline network skips the request and queues immediately',
    () async {
      connectivity.set(false);
      await Future<void>.delayed(Duration.zero);
      expect(network.online, isFalse);
      final result = await repository().processScanPayload(
        payload: '{"sistema":"Xentinel","version":1,"id_usuarios":51}',
        isExitMode: true,
      );
      expect(result, isA<QueuedOffline>());
      expect(bodies, isEmpty);
      expect(outbox.pending.single.type, 'SALIDA');
      expect(outbox.pending.single.signedCode, isNull);
      expect(
        outbox.pending.single.body(includeScanTime: true)['id_usuarios'],
        51,
      );
    },
  );

  test(
    'sync reports rejected movements and keeps transient failures',
    () async {
      await repository(
        offlineHttp: true,
      ).processScanPayload(payload: codeNow(), isExitMode: false);
      // El servidor está ocupado: el registro sigue pendiente.
      respond = (_) =>
          http.Response('{"error":{"code":"X","message":"x"}}', 503);
      expect(await repository().syncPending(), 0);
      expect(outbox.pending, hasLength(1));
      expect(outbox.pending.single.attempts, 1);
      // Respuesta definitiva: deja de reintentarse y queda para revisión.
      respond = (_) => http.Response(
        '{"error":{"code":"ACCESS_SEQUENCE","message":"orden"}}',
        409,
      );
      expect(await repository().syncPending(), 0);
      expect(outbox.pending, isEmpty);
      expect(outbox.issues.single.reason, contains('fuera de orden'));
      expect(outbox.issues.single.userId, 51);
    },
  );

  test('a denied person synced later is flagged for the guard', () async {
    await repository(
      offlineHttp: true,
    ).processScanPayload(payload: codeNow(), isExitMode: false);
    respond = (body) => http.Response(
      jsonEncode({
        'data': {
          'id_usuarios': 51,
          'tipo': body['tipo'],
          'estado': 'Denegado',
          'persona': {'nombres_completos': 'Laura Ríos'},
        },
      }),
      201,
      headers: json,
    );
    expect(await repository().syncPending(), 1);
    expect(outbox.issues.single.name, 'Laura Ríos');
    expect(outbox.issues.single.reason, contains('DENEGADO'));
  });

  test('only the guard who scanned can send the movement', () async {
    await repository(
      offlineHttp: true,
    ).processScanPayload(payload: codeNow(), isExitMode: false);
    session.signIn(
      const UserEntity(
        id: '10',
        name: 'Otro celador',
        documentId: '901',
        role: UserRole.guardia,
        status: AccessStatus.permitido,
      ),
      'token-2',
      900,
    );
    bodies.clear();
    expect(await repository().syncPending(), 0);
    expect(bodies, isEmpty);
    expect(outbox.pending, hasLength(1));
  });

  test(
    'entries older than 72 hours become issues instead of syncing',
    () async {
      final old = DateTime.now().subtract(const Duration(hours: 73));
      storage.value = jsonEncode({
        'pendientes': [
          PendingAccess(
            requestId: '7c0b7e7e-1111-4111-8111-111111111111',
            operatorId: '9',
            userId: 51,
            type: 'ENTRADA',
            scannedAt: old,
          ).toJson(),
        ],
      });
      final queue = AccessOutbox(storage);
      await queue.load();
      expect(queue.pending, isEmpty);
      expect(queue.issues.single.reason, contains('72 horas'));
      queue.dispose();
    },
  );
}

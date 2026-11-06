import 'dart:convert';
import 'dart:io' show HttpDate;

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xentinel/core/server_clock.dart';
import 'package:xentinel/core/session.dart';
import 'package:xentinel/models/xentinel_models.dart';
import 'package:xentinel/repositories/access_repository.dart';
import 'package:xentinel/services/api_client.dart';

const celador = UserEntity(
  id: '9',
  name: 'Celador de prueba',
  documentId: '900',
  role: UserRole.guardia,
  status: AccessStatus.permitido,
);

void main() {
  late SessionStore session;
  setUp(() {
    ServerClock.reset();
    session = SessionStore()..signIn(celador, 'token', 900);
  });
  tearDown(() {
    ServerClock.reset();
    session.dispose();
  });

  ApiClient apiWith(http.Response Function(http.Request) handle) {
    final client = ApiClient(
      session,
      baseUrl: 'https://api.example.test/api/v1',
      client: MockClient((request) async => handle(request)),
    );
    addTearDown(client.close);
    return client;
  }

  http.Response granted(http.Request request, {Map<String, String>? headers}) {
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    return http.Response(
      jsonEncode({
        'data': {
          'id_usuarios': body['id_usuarios'],
          'tipo': body['tipo'],
          'estado': 'Permitido',
          'persona': {'nombres_completos': 'Aprendiz de prueba'},
        },
      }),
      201,
      headers: {'content-type': 'application/json', ...?headers},
    );
  }

  test('a carnet is valid although both phones disagree on the time', () async {
    // El teléfono del aprendiz adelanta 10 minutos: conoce la diferencia real
    // al hablar con el servidor y genera su QR con la hora del servidor.
    final phoneAhead = DateTime.now().add(const Duration(minutes: 10));
    final serverNow = DateTime.now();
    ServerClock.syncFromHeader(
      HttpDate.format(serverNow),
      receivedAt: phoneAhead,
    );
    final studentTimestamp = phoneAhead
        .add(serverNow.difference(phoneAhead))
        .millisecondsSinceEpoch;

    // El teléfono del celador tiene la hora correcta.
    ServerClock.reset();
    final repository = AccessRepository(apiWith(granted));
    final result = await repository.processScanPayload(
      payload: 'XENTINEL:27:$studentTimestamp',
      isExitMode: false,
    );
    expect(result, isA<Granted>());
    expect((result as Granted).person?.name, 'Aprendiz de prueba');
  });

  test('the client adopts the server time from each response', () async {
    final serverNow = DateTime.now().add(const Duration(minutes: 5));
    final client = apiWith(
      (request) => http.Response(
        jsonEncode({'data': {}}),
        200,
        headers: {'date': HttpDate.format(serverNow)},
      ),
    );
    await client.request('alertas/activas');
    final difference = ServerClock.now().difference(serverNow).abs();
    expect(difference, lessThan(const Duration(seconds: 3)));
  });

  test('an invalid date header never breaks a request', () async {
    final client = apiWith(
      (request) => http.Response(
        jsonEncode({'data': {}}),
        200,
        headers: {'date': 'no es una fecha'},
      ),
    );
    await client.request('alertas/activas');
    final difference = ServerClock.now().difference(DateTime.now()).abs();
    expect(difference, lessThan(const Duration(seconds: 1)));
  });

  test('a truly old QR is still rejected', () async {
    final old = DateTime.now()
        .subtract(const Duration(minutes: 2))
        .millisecondsSinceEpoch;
    final repository = AccessRepository(apiWith(granted));
    final result = await repository.processScanPayload(
      payload: 'XENTINEL:27:$old',
      isExitMode: false,
    );
    expect(result, isA<Denied>());
    expect((result as Denied).reason, contains('QR vencido'));
  });

  test('out of order movements explain what to do', () async {
    final repository = AccessRepository(
      apiWith(
        (request) => http.Response(
          jsonEncode({
            'error': {'code': 'ACCESS_SEQUENCE', 'message': 'Debe alternar'},
          }),
          409,
        ),
      ),
    );
    final now = DateTime.now().millisecondsSinceEpoch;
    final entering = await repository.processScanPayload(
      payload: 'XENTINEL:27:$now',
      isExitMode: false,
    );
    expect((entering as Alert).reason, contains('Cambia a SALIDA'));
    final leaving = await repository.processScanPayload(
      payload: 'XENTINEL:27:$now',
      isExitMode: true,
    );
    expect((leaving as Alert).reason, contains('Cambia a ENTRADA'));
  });
}

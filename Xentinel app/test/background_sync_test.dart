import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xentinel/core/session.dart';
import 'package:xentinel/models/xentinel_models.dart';
import 'package:xentinel/repositories/auth_repository.dart';
import 'package:xentinel/services/api_client.dart';
import 'package:xentinel/services/background_sync.dart';
import 'package:xentinel/services/credential_store.dart';

import 'support/fakes.dart';

const guard = UserEntity(
  id: '9',
  name: 'Andrés García',
  documentId: '10003',
  role: UserRole.guardia,
  status: AccessStatus.permitido,
);

Map<String, Object> usuarioJson() => {
  'id_usuarios': 9,
  'nombres_completos': 'Andrés García',
  'nombre_rol': 'Celador',
  'estado': 'Activo',
  'numero_documento': '10003',
};

/// Varias vueltas: la respuesta HTTP simulada atraviesa streams y futures.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

/// Respuesta JSON en UTF-8, como la del servidor (nombres con tildes).
http.Response utf8Json(String body, int status) => http.Response(
  body,
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  late SessionStore session;
  late List<String> paths;
  late int renewals;
  late http.Response Function(http.Request) renewResponse;
  late MemorySecureStore secure;
  late CredentialStore credentials;
  late ApiClient api;
  late BackgroundSync sync;

  // Todo se crea dentro de la zona de tiempo simulado de cada prueba.
  void build() {
    session = SessionStore();
    secure = MemorySecureStore();
    credentials = CredentialStore(secure);
    api = ApiClient(
      session,
      baseUrl: 'https://api.example.test/api/v1',
      client: MockClient((request) async {
        paths.add(request.url.path.replaceFirst('/api/v1/', ''));
        switch (request.url.path) {
          case '/api/v1/auth/renovar':
            renewals++;
            return renewResponse(request);
          case '/api/v1/auth/credencial-qr':
            return http.Response(
              jsonEncode({
                'data': {
                  'version': 2,
                  'formato': 'XN2',
                  'id_usuarios': 9,
                  'clave': base64Url.encode(List.filled(32, 7)),
                  'paso_segundos': 15,
                  'ventana_pasos': 3,
                  'servidor_ms': DateTime.now().millisecondsSinceEpoch,
                },
              }),
              200,
            );
        }
        return http.Response('{"data":{}}', 200);
      }),
    );
    sync = BackgroundSync(
      session: session,
      auth: AuthRepository(api),
      credentials: credentials,
    )..start();
  }

  setUp(() {
    paths = [];
    renewals = 0;
    renewResponse = (_) => utf8Json(
      jsonEncode({
        'data': {
          'access_token': 'jwt-${renewals + 1}',
          'token_type': 'Bearer',
          'expires_in': 8,
          'usuario': usuarioJson(),
        },
      }),
      200,
    );
  });

  tearDown(() {
    sync.dispose();
    api.close();
    session.dispose();
  });

  testWidgets('token renews at 75 % of its lifetime and keeps renewing', (
    tester,
  ) async {
    build();
    session.signIn(guard, 'jwt-1', 8);
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));
    expect(renewals, 0);
    await tester.pump(const Duration(seconds: 2));
    await settle(tester);
    expect(renewals, 1);
    expect(session.token, 'jwt-2');
    expect(session.user?.id, '9');
    // El nuevo token también se renueva antes de vencer.
    await tester.pump(const Duration(seconds: 7));
    await settle(tester);
    expect(renewals, 2);
    expect(session.token, 'jwt-3');
    session.clear();
    await tester.pump(const Duration(seconds: 10));
  });

  testWidgets('a session at its maximum age ends instead of renewing', (
    tester,
  ) async {
    renewResponse = (_) => http.Response(
      '{"error":{"code":"SESSION_MAX_AGE","message":"Vuelve a ingresar"}}',
      401,
    );
    build();
    session.signIn(guard, 'jwt-1', 8);
    await tester.pump(const Duration(seconds: 7));
    await settle(tester);
    expect(renewals, 1);
    expect(session.token, isNull);
    expect(session.message, contains('venció'));
  });

  testWidgets('signed carnet key is fetched at sign in and kept in memory', (
    tester,
  ) async {
    build();
    session.signIn(guard, 'jwt-1', 900);
    await settle(tester);
    expect(paths, contains('auth/credencial-qr'));
    final credential = credentials.current!;
    expect(credential.userId, 9);
    expect(credential.name, 'Andrés García');
    expect(credential.codeAt(DateTime.now()), startsWith('XN2:9:'));
    // Solo en línea: la clave nunca se escribe en el almacén del teléfono.
    expect(secure.values, isEmpty);
    session.clear();
    await tester.pump(const Duration(seconds: 1));
  });

  testWidgets('the offline carnet saved by older versions is erased', (
    tester,
  ) async {
    build();
    secure.values['xentinel_qr_credential_v1'] = '{"v":1,"id":9}';
    await credentials.load();
    expect(secure.values, isEmpty);
    expect(credentials.current, isNull);
    await tester.pump();
  });
}

// Integración con el Backend FastAPI real (scripts/fastapi-smoke-server.py):
//
//   flutter test test_backend/cloud_flow_test.dart --dart-define=ALLOW_INSECURE_HTTP=true
//
// Recorre el flujo de producción con los servicios reales de la app: carnet firmado
// emitido por el servidor, lectura de celular a celular, registro sin conexión con
// sincronización idempotente, canal WebSocket, renovación de sesión y revocación.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xentinel/core/api_config.dart';
import 'package:xentinel/core/server_clock.dart';
import 'package:xentinel/core/session.dart';
import 'package:xentinel/models/xentinel_models.dart';
import 'package:xentinel/repositories/access_repository.dart';
import 'package:xentinel/repositories/auth_repository.dart';
import 'package:xentinel/services/access_outbox.dart';
import 'package:xentinel/services/alert_events.dart';
import 'package:xentinel/services/api_client.dart';
import 'package:xentinel/services/credential_store.dart';
import 'package:xentinel/services/network_status.dart';
import 'package:xentinel/services/realtime_socket.dart';

import '../test/support/fakes.dart';

const base = 'http://127.0.0.1:18924/api/v1';
const password = 'Mobile-Prueba-2026!';

void main() {
  // Preferencias en memoria: esta prueba vive fuera de test/.
  // ignore: invalid_use_of_visible_for_testing_member
  SharedPreferences.setMockInitialValues({});

  test(
    'cloud flow: signed carnet, offline queue, WebSocket, renewal and revocation',
    () async {
      final studentSession = SessionStore();
      final guardSession = SessionStore();
      final adminSession = SessionStore();
      final studentApi = ApiClient(studentSession, baseUrl: base);
      final guardApi = ApiClient(guardSession, baseUrl: base);
      final adminApi = ApiClient(adminSession, baseUrl: base);
      // Mismo celador, pero sin red: un puerto donde nadie escucha.
      final offlineApi = ApiClient(
        guardSession,
        baseUrl: 'http://127.0.0.1:9/api/v1',
      );
      addTearDown(() {
        for (final api in [studentApi, guardApi, adminApi, offlineApi]) {
          api.close();
        }
      });

      Future<void> signIn(
        SessionStore session,
        ApiClient api,
        String doc,
      ) async {
        final result = await AuthRepository(api).login(doc, password);
        session.signIn(result.user, result.token, result.expiresIn);
      }

      await signIn(studentSession, studentApi, '90002');
      await signIn(guardSession, guardApi, '90003');
      await signIn(adminSession, adminApi, '90001');
      expect(guardSession.user!.role, UserRole.guardia);

      // 1. El servidor emite la clave del carnet; la app genera el código sola.
      final credentialData = await AuthRepository(studentApi).qrCredential();
      final credential = QrCredential.fromApi(
        credentialData,
        studentSession.user!,
        DateTime.now(),
      )!;
      final store = CredentialStore(MemorySecureStore());
      await store.save(credential);
      final carnet = store.current!.codeAt(ServerClock.now());
      expect(carnet, matches(RegExp(r'^XN2:\d+:\d+:[A-Z2-7]{20}$')));

      // 2. Lectura de celular a celular con el servidor en línea.
      final outbox = AccessOutbox(MemoryOutboxPersistence());
      final network = NetworkStatus(FakeConnectivity());
      final guard = AccessRepository(
        guardApi,
        outbox: outbox,
        session: guardSession,
        network: network,
      );
      final entry = await guard.processScanPayload(
        payload: carnet,
        isExitMode: false,
      );
      expect(entry, isA<Granted>());
      expect((entry as Granted).person?.name, 'Andrés Prueba');

      // 3. Sin conexión: la salida queda en la cola y se sincroniza después.
      final offlineGuard = AccessRepository(
        offlineApi,
        outbox: outbox,
        session: guardSession,
        network: network,
      );
      await Future<void>.delayed(const Duration(seconds: 16));
      final exitCode = store.current!.codeAt(ServerClock.now());
      final queued = await offlineGuard.processScanPayload(
        payload: exitCode,
        isExitMode: true,
      );
      expect(queued, isA<QueuedOffline>());
      expect(outbox.pending, hasLength(1));
      final scannedAt = outbox.pending.single.scannedAt;
      expect(await guard.syncPending(), 1);
      expect(outbox.pending, isEmpty);
      expect(outbox.issues, isEmpty);
      final history = await adminApi.request(
        'ingresos?id_usuarios=${studentSession.user!.id}',
      );
      final rows = (history as List).cast<Map>();
      expect(rows.map((r) => r['tipo']), ['SALIDA', 'ENTRADA']);
      // El movimiento conserva la hora del escaneo, no la de la sincronización.
      expect(
        DateTime.parse(
          rows.first['fechahora'] as String,
        ).difference(scannedAt).inSeconds.abs(),
        lessThan(2),
      );

      // 4. Canal WebSocket: una alerta creada en el centro de control llega al celular.
      final socket = WebSocketEventConnection();
      addTearDown(socket.close);
      final ready = Completer<void>();
      final alert = Completer<ServerEvent>();
      socket
          .connect(
            ApiConfig.realtimeEndpoint(base: base),
            guardSession.token!,
            null,
          )
          .listen((event) {
            if (event.type == 'ready' && !ready.isCompleted) ready.complete();
            if (event.type == 'change' &&
                event.data['recurso'] == 'alertas_emergencia' &&
                !alert.isCompleted) {
              alert.complete(event);
            }
          }, onError: (Object e) => fail('WebSocket: $e'));
      await ready.future.timeout(const Duration(seconds: 10));
      await adminApi.request(
        'alertas',
        method: 'POST',
        body: {
          'tipo_alerta': 'Simulacro',
          'mensaje': 'Simulacro de evacuación de prueba',
          'severidad': 'moderada',
        },
      );
      final change = await alert.future.timeout(const Duration(seconds: 10));
      expect(change.id, isNotNull);

      // 5. Renovación: nuevo token sin contraseña; el canal abierto lo recibe.
      final renewed = await AuthRepository(guardApi).renew();
      expect(renewed.token, isNot(guardSession.token));
      guardSession.renew(renewed.token, renewed.expiresIn);
      socket.updateToken(renewed.token);
      expect(await guardApi.request('auth/me'), isA<Map>());

      // 6. Cerrar sesión revoca el carnet guardado: ya no sirve en otro teléfono.
      await AuthRepository(studentApi).logout();
      await Future<void>.delayed(const Duration(seconds: 16));
      final revoked = await guard.processScanPayload(
        payload: store.current!.codeAt(ServerClock.now()),
        isExitMode: false,
      );
      expect((revoked as Denied).reason, contains('revocado'));
      network.dispose();
      debugPrintSynchronously(jsonEncode({'ok': true}));
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );
}

void debugPrintSynchronously(String message) {
  // ignore: avoid_print
  print(message);
}

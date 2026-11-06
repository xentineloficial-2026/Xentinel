import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:xentinel/core/api_config.dart';
import 'package:xentinel/core/session.dart';
import 'package:xentinel/models/xentinel_models.dart';
import 'package:xentinel/repositories/access_repository.dart';
import 'package:xentinel/repositories/alerts_repository.dart';
import 'package:xentinel/repositories/auth_repository.dart';
import 'package:xentinel/services/alert_events.dart';
import 'package:xentinel/services/api_client.dart';

void main() {
  test(
    'real REST/PostgreSQL: auth, recovery, access idempotency, SSE alerts, logout',
    () async {
      final session = SessionStore();
      final api = ApiClient(session, baseUrl: 'http://127.0.0.1:18923/api/v1');
      addTearDown(() {
        api.close();
        session.dispose();
      });
      final auth = AuthRepository(api);
      final student = await auth.login('90002', 'Mobile-Prueba-2026!');
      expect(student.user.name, 'Andrés Prueba');
      expect(student.user.role, UserRole.aprendiz);
      final admin = await auth.login('90001', 'Mobile-Prueba-2026!');
      session.signIn(admin.user, admin.token, admin.expiresIn);
      await auth.forgotPassword('90002@mobile-test.example');
      final access = AccessRepository(api);
      final qr =
          'XENTINEL:${student.user.id}:${DateTime.now().millisecondsSinceEpoch}';
      expect(
        await access.processScanPayload(payload: qr, isExitMode: false),
        isA<Granted>(),
      );
      expect(
        await access.processScanPayload(payload: qr, isExitMode: false),
        isA<Granted>(),
      );
      expect(
        await access.processScanPayload(payload: qr, isExitMode: true),
        isA<Granted>(),
      );

      final events = AlertEventConnection();
      addTearDown(events.close);
      final ready = Completer<void>();
      final changed = Completer<ServerEvent>();
      final subscription = events
          .connect(api.uri('eventos'), admin.token, null)
          .listen(
            (event) {
              if (!ready.isCompleted) ready.complete();
              if (event.type == 'change' &&
                  event.data['recurso'] == 'alertas_emergencia' &&
                  !changed.isCompleted) {
                changed.complete(event);
              }
            },
            onError: (Object error) {
              if (!ready.isCompleted) ready.completeError(error);
              if (!changed.isCompleted) changed.completeError(error);
            },
          );
      addTearDown(subscription.cancel);
      await ready.future.timeout(const Duration(seconds: 10));
      final created =
          await api.request(
                'alertas',
                method: 'POST',
                body: {
                  'tipo_alerta': 'Simulacro',
                  'severidad': 'alta',
                  'fuente': 'Prueba móvil',
                  'mensaje':
                      'Prueba automatizada: siga las indicaciones del personal.',
                },
              )
              as Map;
      expect(
        (await changed.future.timeout(const Duration(seconds: 10))).id,
        isNotNull,
      );
      final alerts = AlertsRepository(api);
      expect((await alerts.fetchActive()).single.id, created['id_alerta']);
      await api.request(
        'alertas/${created['id_alerta']}/cerrar',
        method: 'PATCH',
      );
      expect(await alerts.fetchActive(), isEmpty);
      await events.close();
      await subscription.cancel();
      await auth.logout();
      await expectLater(
        api.request('auth/me'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      );
      expect(session.token, isNull);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}

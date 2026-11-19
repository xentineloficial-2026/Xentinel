import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:xentinel/screens/seismic_alert_screen.dart';
import 'package:xentinel/services/seismic_alerts.dart';

/// Datos tal como los envía el servidor (xentinel/push.py) por FCM.
const serverData = {
  'tipo': 'SISMO',
  'id_alerta': '42',
  'severidad': 'alta',
  'magnitud': '5.5',
  'lugar': 'Colombia',
  'profundidad': '12',
  'lat': '4.4200',
  'lon': '-74.2800',
  'distancia_km': '27',
  'timestamp': '2026-11-19T15:30:00+00:00',
  'titulo': 'Sismo M5.5 · Colombia',
  'mensaje': 'Sismo de magnitud 5.5 (Colombia) a 27 km de la sede.',
};

void main() {
  test('reads the server payload and survives the notification round trip', () {
    final alert = SeismicAlert.fromData(serverData)!;
    expect(alert.magnitude, 5.5);
    expect(alert.distanceKm, 27);
    expect(alert.notificationId, 42);
    expect(alert.title, 'Sismo M5.5 · Colombia');
    expect(alert.summary, contains('27 km'));
    expect(alert.occurredAt!.isUtc, isFalse);

    final again = SeismicAlert.fromData(alert.toData())!;
    expect(again.magnitude, alert.magnitude);
    expect(again.place, alert.place);
    expect(again.occurredAt, alert.occurredAt);
  });

  test('ignores other messages and broken payloads', () {
    expect(SeismicAlert.fromData({...serverData, 'tipo': 'OTRO'}), isNull);
    expect(SeismicAlert.fromData({...serverData, 'magnitud': 'x'}), isNull);
    expect(SeismicAlert.fromPayload('no es json'), isNull);
    expect(SeismicAlert.fromPayload(null), isNull);
  });

  test('push stays disabled until Firebase is configured', () {
    expect(SeismicAlerts.available, isFalse);
  });

  testWidgets('full-screen alert shows the quake and closes back to the app', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(path: '/home', builder: (_, _) => const Text('Inicio')),
        GoRoute(
          path: '/sismo',
          builder: (_, state) =>
              SeismicAlertScreen(alert: state.extra as SeismicAlert?),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    router.push('/sismo', extra: SeismicAlert.fromData(serverData));
    await tester.pumpAndSettle();

    expect(find.text('ALERTA SÍSMICA'), findsOneWidget);
    expect(find.text('M5.5'), findsOneWidget);
    expect(find.text('Colombia'), findsOneWidget);
    expect(find.textContaining('A 27 km de la sede'), findsOneWidget);
    expect(find.textContaining('Agáchate'), findsOneWidget);

    await tester.ensureVisible(find.text('Entendido'));
    await tester.tap(find.text('Entendido'));
    await tester.pumpAndSettle();
    expect(find.text('Inicio'), findsOneWidget);
  });
}

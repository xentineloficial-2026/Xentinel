import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xentinel/components/emergency_card.dart';
import 'package:xentinel/components/emergency_takeover.dart';
import 'package:xentinel/core/theme.dart';
import 'package:xentinel/models/emergency_alert.dart';

EmergencyAlert alert({
  AlertSeverity severity = AlertSeverity.critica,
  String type = 'Sismo',
}) => EmergencyAlert(
  id: 1,
  type: type,
  message: 'Evacúa por la salida más cercana.',
  severity: severity,
  startedAt: DateTime(2026, 11, 5, 8, 30),
  source: 'Centro de control',
);

/// Luminancia relativa WCAG para comprobar el contraste de la emergencia.
double contrast(Color a, Color b) {
  final la = a.computeLuminance() + 0.05;
  final lb = b.computeLuminance() + 0.05;
  return la > lb ? la / lb : lb / la;
}

void main() {
  Future<void> mount(
    WidgetTester tester,
    EmergencyAlert value, {
    VoidCallback? onAcknowledge,
    VoidCallback? onDetails,
  }) => tester.pumpWidget(
    MaterialApp(
      theme: XentinelTheme.dark(),
      home: EmergencyTakeover(
        alert: value,
        onAcknowledge: onAcknowledge ?? () {},
        onDetails: onDetails ?? () {},
      ),
    ),
  );

  testWidgets('shows the alert and reports both actions', (tester) async {
    var acknowledged = 0;
    var details = 0;
    await mount(
      tester,
      alert(),
      onAcknowledge: () => acknowledged++,
      onDetails: () => details++,
    );
    expect(find.text('Sismo'), findsOneWidget);
    expect(find.text('Evacúa por la salida más cercana.'), findsOneWidget);
    expect(find.textContaining('Simulacro'), findsNothing);
    await tester.tap(find.text('Entendido'));
    await tester.ensureVisible(find.text('Ver indicaciones'));
    await tester.tap(find.text('Ver indicaciones'));
    expect(acknowledged, 1);
    expect(details, 1);
  });

  testWidgets('drills say clearly that they are not real', (tester) async {
    await mount(tester, alert(type: 'Simulacro'));
    expect(find.text('Simulacro. No es una emergencia real.'), findsOneWidget);
  });

  testWidgets('long text on a small phone does not overflow', (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 1.4;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await mount(
      tester,
      EmergencyAlert(
        id: 2,
        type: 'Evacuación',
        message: 'Mantén la calma y sigue a tu brigadista. ' * 8,
        severity: AlertSeverity.alta,
        startedAt: DateTime(2026, 11, 5),
        source: 'Centro de control',
      ),
    );
    expect(tester.takeException(), isNull);
  });

  test('every alert color keeps readable text', () {
    for (final severity in AlertSeverity.values) {
      expect(
        contrast(severityColor(severity), severityForeground(severity)),
        greaterThanOrEqualTo(4.5),
        reason: severity.name,
      );
    }
  });
}

import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../models/emergency_alert.dart';

Color severityColor(AlertSeverity severity) => switch (severity) {
  AlertSeverity.critica || AlertSeverity.alta => XentinelTheme.emergency,
  AlertSeverity.moderada => XentinelTheme.alarm,
  AlertSeverity.informativa => XentinelTheme.raised,
};

/// Texto legible sobre cada color de severidad.
Color severityForeground(AlertSeverity severity) => switch (severity) {
  AlertSeverity.moderada => XentinelTheme.ink,
  _ => Colors.white,
};

class EmergencyCard extends StatelessWidget {
  const EmergencyCard({super.key, required this.alert});
  final EmergencyAlert alert;

  @override
  Widget build(BuildContext context) {
    final foreground = severityForeground(alert.severity);
    final date = alert.startedAt.toLocal();
    final time =
        '${date.day}/${date.month}/${date.year} · ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: severityColor(alert.severity),
        borderRadius: BorderRadius.circular(XentinelTheme.radiusL),
      ),
      child: DefaultTextStyle.merge(
        style: TextStyle(color: foreground),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Icon(Icons.warning_amber_rounded, color: foreground),
                Text(
                  'ALERTA ${alert.severityLabel}',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              alert.type,
              style: const TextStyle(
                fontSize: 34,
                height: 1.05,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.7,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Indicaciones del centro de control',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            SelectableText(
              alert.message.isEmpty
                  ? 'Espera las indicaciones del personal de emergencia.'
                  : alert.message,
              style: TextStyle(
                fontSize: 19,
                height: 1.35,
                fontWeight: FontWeight.w500,
                color: foreground,
              ),
            ),
            const SizedBox(height: 18),
            Text(alert.source, style: const TextStyle(height: 1.4)),
            Text(
              time,
              style: TextStyle(
                fontFamily: XentinelTheme.monoFamily,
                fontSize: 13,
                height: 1.4,
                color: foreground,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

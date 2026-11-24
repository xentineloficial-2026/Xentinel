import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/emergency_alert.dart';
import 'emergency_card.dart';

/// Interrupción de pantalla completa: una sola tarea, botones grandes y sin
/// vidrio ni matices. Es el mismo diseño que usa la web durante una emergencia.
class EmergencyTakeover extends StatelessWidget {
  const EmergencyTakeover({
    super.key,
    required this.alert,
    required this.onAcknowledge,
    required this.onDetails,
  });
  final EmergencyAlert alert;
  final VoidCallback onAcknowledge;
  final VoidCallback onDetails;

  @override
  Widget build(BuildContext context) {
    final background = severityColor(alert.severity);
    final foreground = severityForeground(alert.severity);
    final moderate = alert.severity == AlertSeverity.moderada;
    final primaryBg = moderate ? XentinelTheme.ink : Colors.white;
    final primaryFg = moderate ? Colors.white : XentinelTheme.emergencyDeep;
    final secondaryBg = moderate ? Colors.white : XentinelTheme.emergencyDeep;
    final secondaryFg = moderate ? XentinelTheme.ink : Colors.white;
    // También los simulacros de la API de riesgos (fuente PRUEBA), como en la web.
    final isDrill = alert.isDrill;
    final date = alert.startedAt.toLocal();
    final time =
        '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';

    return Material(
      color: background,
      child: SafeArea(
        child: Semantics(
          liveRegion: true,
          container: true,
          label:
              'Alerta ${alert.severityLabel}: ${alert.type}. ${alert.message}',
          child: LayoutBuilder(
            builder: (context, constraints) => SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(22, 20, 22, 22),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: constraints.maxHeight - 42,
                ),
                child: IntrinsicHeight(
                  child: DefaultTextStyle.merge(
                    style: TextStyle(color: foreground),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Alerta ${alert.severityLabel.toLowerCase()}',
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            Text(
                              time,
                              style: TextStyle(
                                fontFamily: XentinelTheme.monoFamily,
                                fontSize: 15,
                                color: foreground,
                              ),
                            ),
                          ],
                        ),
                        if (isDrill) ...[
                          const SizedBox(height: 14),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              border: Border.all(color: foreground, width: 2),
                              borderRadius: BorderRadius.circular(
                                XentinelTheme.radiusS,
                              ),
                            ),
                            child: const Text(
                              'Simulacro. No es una emergencia real.',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                        const Spacer(),
                        const SizedBox(height: 28),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Icon(
                            Icons.warning_amber_rounded,
                            size: 68,
                            color: foreground,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          alert.type,
                          style: const TextStyle(
                            fontSize: 60,
                            height: 1,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -1.5,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          alert.message.isEmpty
                              ? 'Espera las indicaciones del personal de emergencia.'
                              : alert.message,
                          style: const TextStyle(
                            fontSize: 24,
                            height: 1.25,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const Spacer(),
                        const SizedBox(height: 28),
                        _TakeoverButton(
                          label: 'Entendido',
                          background: primaryBg,
                          foreground: primaryFg,
                          onPressed: onAcknowledge,
                        ),
                        const SizedBox(height: 12),
                        _TakeoverButton(
                          label: 'Ver indicaciones',
                          background: secondaryBg,
                          foreground: secondaryFg,
                          onPressed: onDetails,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TakeoverButton extends StatelessWidget {
  const _TakeoverButton({
    required this.label,
    required this.background,
    required this.foreground,
    required this.onPressed,
  });
  final String label;
  final Color background;
  final Color foreground;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => FilledButton(
    style: FilledButton.styleFrom(
      backgroundColor: background,
      foregroundColor: foreground,
      minimumSize: const Size.fromHeight(72),
      textStyle: const TextStyle(
        fontFamily: XentinelTheme.fontFamily,
        fontSize: 22,
        fontWeight: FontWeight.w700,
      ),
    ),
    onPressed: onPressed,
    child: Text(label, textAlign: TextAlign.center),
  );
}

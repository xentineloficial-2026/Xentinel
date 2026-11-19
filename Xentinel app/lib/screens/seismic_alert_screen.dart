import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/theme.dart';
import '../services/seismic_alerts.dart';

/// Alerta sísmica a pantalla completa: se abre desde la notificación, aun con el
/// teléfono bloqueado, o al llegar el aviso con la app abierta.
class SeismicAlertScreen extends StatelessWidget {
  const SeismicAlertScreen({super.key, this.alert});

  final SeismicAlert? alert;

  static const _steps = [
    'Agáchate, cúbrete bajo una mesa firme y sujétate.',
    'Aléjate de ventanas, estantes y objetos que puedan caer.',
    'No uses ascensores. Cuando pase el movimiento, evacúa con calma y sigue al personal.',
  ];

  void _close(BuildContext context) =>
      context.canPop() ? context.pop() : context.go('/home');

  @override
  Widget build(BuildContext context) {
    final alert = this.alert;
    final time = alert?.occurredAt;
    final details = [
      if (alert?.distanceKm != null)
        'A ${alert!.distanceKm!.round()} km de la sede',
      if (alert?.depthKm != null) 'Profundidad ${alert!.depthKm!.round()} km',
      if (time != null)
        'Hora ${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}',
    ];
    return Scaffold(
      backgroundColor: XentinelTheme.emergency,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(28, 32, 28, 28),
          children: [
            Semantics(
              liveRegion: true,
              child: const Row(
                children: [
                  Icon(
                    Icons.warning_amber_rounded,
                    color: Colors.white,
                    size: 36,
                  ),
                  SizedBox(width: 12),
                  Text(
                    'ALERTA SÍSMICA',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.5,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),
            if (alert == null)
              const Text(
                'Se detectó un sismo cerca de la sede. Agáchate, cúbrete y sujétate.',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  height: 1.4,
                ),
              )
            else ...[
              Text(
                'M${alert.magnitude.toStringAsFixed(1)}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 88,
                  fontWeight: FontWeight.w800,
                  height: 1,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                alert.place,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (details.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  details.join(' · '),
                  style: const TextStyle(color: Colors.white70, fontSize: 16),
                ),
              ],
            ],
            const SizedBox(height: 32),
            for (final step in _steps)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 3),
                      child: Icon(
                        Icons.check_circle,
                        color: Colors.white,
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        step,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 24),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: XentinelTheme.emergencyDeep,
                minimumSize: const Size.fromHeight(56),
              ),
              onPressed: () => _close(context),
              child: const Text(
                'Entendido',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

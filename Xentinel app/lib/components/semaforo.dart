import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/scan_alarm.dart';

/// Color de cada luz del semáforo, el mismo de la web.
Color semaforoColor(Semaforo color) => switch (color) {
  Semaforo.rojo => XentinelTheme.emergency,
  Semaforo.amarillo => XentinelTheme.alarm,
};

/// Texto legible sobre cada color del semáforo.
Color semaforoForeground(Semaforo color) => switch (color) {
  Semaforo.rojo => Colors.white,
  Semaforo.amarillo => XentinelTheme.ink,
};

/// Caja oscura con dos luces, como en la calle: rojo arriba y amarillo abajo. Cada
/// luz se enciende solo si hay alarmas de su color.
class SemaforoLamps extends StatelessWidget {
  const SemaforoLamps({
    super.key,
    required this.red,
    required this.yellow,
    this.lamp = 18,
  });

  final int red;
  final int yellow;
  final double lamp;

  @override
  Widget build(BuildContext context) {
    Widget light(Semaforo color, bool on) {
      final base = semaforoColor(color);
      return Container(
        width: lamp,
        height: lamp,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: on ? base : Color.lerp(XentinelTheme.ink, base, 0.22),
          boxShadow: on
              ? [
                  BoxShadow(
                    color: base.withValues(alpha: 0.65),
                    blurRadius: lamp * 0.7,
                    spreadRadius: lamp * 0.05,
                  ),
                ]
              : null,
        ),
      );
    }

    return Semantics(
      label: 'Semáforo: $red en rojo y $yellow en amarillo',
      child: ExcludeSemantics(
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: lamp * 0.3,
            vertical: lamp * 0.35,
          ),
          decoration: BoxDecoration(
            color: XentinelTheme.ink,
            borderRadius: BorderRadius.circular(lamp),
            border: Border.all(color: XentinelTheme.glassBorder),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              light(Semaforo.rojo, red > 0),
              SizedBox(height: lamp * 0.35),
              light(Semaforo.amarillo, yellow > 0),
            ],
          ),
        ),
      ),
    );
  }
}

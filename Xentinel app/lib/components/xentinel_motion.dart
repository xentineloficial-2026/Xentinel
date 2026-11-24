import 'dart:io' show Platform;
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme.dart';
import 'xentinel_brand.dart';

/// Las animaciones continuas respetan "reducir movimiento" del teléfono y se
/// apagan en las pruebas, que esperan a que la pantalla quede quieta.
bool motionEnabled(BuildContext context) =>
    !MediaQuery.disableAnimationsOf(context) &&
    !Platform.environment.containsKey('FLUTTER_TEST');

/// La X oficial con una franja de luz que la recorre en diagonal, como el haz de un
/// escáner. [progress] va de 0 a 1; en los extremos la X queda plana y quieta.
class SheenMark extends StatelessWidget {
  const SheenMark({super.key, required this.size, required this.progress});
  final double size;
  final double progress;

  @override
  Widget build(BuildContext context) {
    if (progress <= 0 || progress >= 1) {
      return XentinelLogo(size: size, color: XentinelTheme.text);
    }
    return ShaderMask(
      blendMode: BlendMode.srcIn,
      shaderCallback: (bounds) {
        // La franja entra por la izquierda, cruza la hoja larga y sale por la derecha.
        final x = progress * 3.4 - 1.7;
        return LinearGradient(
          begin: Alignment(x - 1, -1),
          end: Alignment(x + 1, 1),
          colors: const [
            XentinelTheme.text,
            Colors.white,
            XentinelTheme.steel,
            XentinelTheme.text,
          ],
          stops: const [0.34, 0.48, 0.56, 0.70],
        ).createShader(bounds);
      },
      child: XentinelLogo(size: size, color: Colors.white),
    );
  }
}

/// Facetas oscuras en bajo relieve: el material sobre el que se ve el vidrio,
/// igual al fondo del login y del panel web.
class FacetBackdrop extends StatelessWidget {
  const FacetBackdrop({super.key});

  @override
  Widget build(BuildContext context) => const IgnorePointer(
    child: ExcludeSemantics(
      child: RepaintBoundary(
        child: CustomPaint(painter: _FacetPainter(), size: Size.infinite),
      ),
    ),
  );
}

class _FacetPainter extends CustomPainter {
  const _FacetPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final random = math.Random(4021);
    const columns = 7;
    final cell = size.width / columns;
    final rows = (size.height / cell).ceil() + 1;
    Offset point(int c, int r) {
      final jitter = random.nextDouble() * 0.62 - 0.31;
      final jitterY = random.nextDouble() * 0.62 - 0.31;
      return Offset((c + jitter) * cell, (r + jitterY) * cell);
    }

    final grid = [
      for (var r = 0; r <= rows; r++)
        [for (var c = 0; c <= columns; c++) point(c, r)],
    ];
    // La luz llega desde arriba a la derecha y se apaga hacia abajo.
    void triangle(Offset a, Offset b, Offset c) {
      final center = (a + b + c) / 3;
      final light =
          (1 - center.dy / size.height) * 0.75 + center.dx / size.width * 0.25;
      final shade = (light * 0.55 + random.nextDouble() * 0.45) * 0.72;
      canvas.drawPath(
        Path()
          ..moveTo(a.dx, a.dy)
          ..lineTo(b.dx, b.dy)
          ..lineTo(c.dx, c.dy)
          ..close(),
        Paint()
          ..isAntiAlias = true
          ..color = Color.lerp(
            XentinelTheme.ink,
            const Color(0xFF253F50),
            shade,
          )!,
      );
    }

    canvas.drawColor(XentinelTheme.ink, BlendMode.src);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < columns; c++) {
        final (a, b, d, e) = (
          grid[r][c],
          grid[r][c + 1],
          grid[r + 1][c],
          grid[r + 1][c + 1],
        );
        triangle(a, b, d);
        triangle(b, e, d);
      }
    }
  }

  @override
  bool shouldRepaint(_FacetPainter oldDelegate) => false;
}

/// Entrada breve de un bloque: sube y aparece una sola vez.
class Entrance extends StatelessWidget {
  const Entrance({super.key, required this.child, this.delay = 0});
  final Widget child;

  /// Parte de la animación (0 a 1) que espera antes de empezar.
  final double delay;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: 1),
    duration: Duration(milliseconds: motionEnabled(context) ? 620 : 1),
    curve: Interval(delay, 1, curve: Curves.easeOutCubic),
    builder: (context, value, child) => Opacity(
      opacity: value,
      child: Transform.translate(
        offset: Offset(0, (1 - value) * 18),
        child: child,
      ),
    ),
    child: child,
  );
}

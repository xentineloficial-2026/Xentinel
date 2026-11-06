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

/// El logo con volumen: capas apiladas en perspectiva, un vaivén lento y un
/// brillo metálico que lo recorre. Es el mismo escudo 3D de la portada web.
class Shield3D extends StatefulWidget {
  const Shield3D({super.key, this.size = 120});
  final double size;

  @override
  State<Shield3D> createState() => _Shield3DState();
}

class _Shield3DState extends State<Shield3D>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 7),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (motionEnabled(context) && !_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const layers = 12;
    final depth = widget.size * 0.012;
    return Semantics(
      label: 'Xentinel',
      image: true,
      child: ExcludeSemantics(
        child: RepaintBoundary(
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) {
              final t = _controller.value * 2 * math.pi;
              Matrix4 pose(double z) => Matrix4.identity()
                ..setEntry(3, 2, 0.0014)
                ..rotateY(math.sin(t) * 0.42)
                ..rotateX(math.cos(t) * 0.07)
                ..translateByDouble(0.0, 0.0, z, 1.0);
              return Stack(
                alignment: Alignment.center,
                children: [
                  for (var i = layers; i > 0; i--)
                    Transform(
                      alignment: Alignment.center,
                      transform: pose(i * depth),
                      child: XentinelLogo(
                        size: widget.size,
                        color: Color.lerp(
                          XentinelTheme.steel,
                          XentinelTheme.slate,
                          i / layers,
                        )!,
                      ),
                    ),
                  Transform(
                    alignment: Alignment.center,
                    transform: pose(0),
                    child: ShaderMask(
                      blendMode: BlendMode.srcIn,
                      shaderCallback: (bounds) {
                        final sheen = _controller.value * 3 - 1;
                        return LinearGradient(
                          begin: Alignment(sheen - 1, -1),
                          end: Alignment(sheen + 1, 1),
                          colors: const [
                            XentinelTheme.steel,
                            Colors.white,
                            XentinelTheme.mist,
                            XentinelTheme.steel,
                          ],
                          stops: const [0, 0.42, 0.58, 1],
                        ).createShader(bounds);
                      },
                      child: XentinelLogo(
                        size: widget.size,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
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

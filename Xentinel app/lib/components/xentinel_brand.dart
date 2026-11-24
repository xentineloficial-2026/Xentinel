import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Logo oficial de Xentinel: la X. Es el mismo trazo del icono de la app y de la web
/// (simbolo-x.png) y toma el color indicado para funcionar sobre cualquier fondo.
class XentinelLogo extends StatelessWidget {
  const XentinelLogo({
    super.key,
    this.size = 40,
    this.color = XentinelTheme.mist,
  });

  /// Ancho del logo; el alto conserva la proporción original.
  final double size;
  final Color color;

  static const asset = 'assets/images/xentinel-x.png';
  static const aspectRatio = 1116 / 1028;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Xentinel',
    image: true,
    child: Image.asset(
      asset,
      width: size,
      height: size * aspectRatio,
      color: color,
      colorBlendMode: BlendMode.srcIn,
      filterQuality: FilterQuality.medium,
      excludeFromSemantics: true,
      gaplessPlayback: true,
    ),
  );
}

Path _shieldOutline(double x, double y) => Path()
  ..moveTo(x, y)
  ..relativeCubicTo(43, 37, 108, 65, 170, 74)
  ..relativeCubicTo(6, 133, -52, 248, -170, 306)
  ..relativeCubicTo(-118, -58, -177, -173, -171, -306)
  ..relativeCubicTo(62, -9, 127, -37, 171, -74)
  ..close();

/// Motivo de marca: el contorno del escudo repetido hacia afuera, como un
/// perímetro que se extiende. Es el mismo fondo de la portada web.
class PerimeterBackdrop extends StatelessWidget {
  const PerimeterBackdrop({
    super.key,
    this.alignment = const Alignment(0, -0.55),
  });
  final Alignment alignment;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: ExcludeSemantics(
      child: CustomPaint(
        painter: _PerimeterPainter(alignment),
        size: Size.infinite,
      ),
    ),
  );
}

class _PerimeterPainter extends CustomPainter {
  const _PerimeterPainter(this.alignment);
  final Alignment alignment;
  static const _scales = [0.42, 0.68, 0.98, 1.32, 1.7, 2.12, 2.6];

  @override
  void paint(Canvas canvas, Size size) {
    final center = alignment.alongSize(size);
    final shield = _shieldOutline(0, -190);
    for (var i = 0; i < _scales.length; i++) {
      final alpha = 0.24 * (1 - i / _scales.length);
      canvas
        ..save()
        ..translate(center.dx, center.dy)
        ..scale(_scales[i])
        ..drawPath(
          shield,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1 / _scales[i]
            ..color = XentinelTheme.steel.withValues(alpha: alpha),
        )
        ..restore();
    }
  }

  @override
  bool shouldRepaint(_PerimeterPainter oldDelegate) =>
      oldDelegate.alignment != alignment;
}

/// Superficie de vidrio: se usa solo sobre contenido que realmente pasa por
/// detrás (dock, controles sobre la cámara, formulario sobre el perímetro).
class GlassPanel extends StatelessWidget {
  const GlassPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.radius = XentinelTheme.radiusL,
  });
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(radius),
    child: BackdropFilter(
      filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: XentinelTheme.glass,
          borderRadius: BorderRadius.circular(radius),
          border: Border.all(color: XentinelTheme.glassBorder),
        ),
        child: Padding(padding: padding, child: child),
      ),
    ),
  );
}

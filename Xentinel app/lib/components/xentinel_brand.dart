import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Escudo con candado y llave, trazado en vector desde el logo oficial.
/// Usa los mismos trazos que la web (simbolo-xentinel.svg).
class XentinelLogo extends StatelessWidget {
  const XentinelLogo({
    super.key,
    this.size = 40,
    this.color = XentinelTheme.mist,
  });
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Xentinel',
    image: true,
    child: SizedBox(
      width: size,
      height: size * 406 / 368,
      child: CustomPaint(painter: _LogoPainter(color)),
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

class _LogoPainter extends CustomPainter {
  const _LogoPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 368;
    canvas
      ..scale(scale)
      ..translate(-118, -50);
    final fill = Paint()
      ..color = color
      ..isAntiAlias = true;

    final inner = Path()
      ..moveTo(302, 93)
      ..relativeCubicTo(-43, 33, -98, 57, -147, 64)
      ..relativeCubicTo(-3, 108, 49, 203, 147, 259)
      ..relativeCubicTo(98, -56, 150, -151, 147, -259)
      ..relativeCubicTo(-49, -7, -104, -31, -147, -64)
      ..close();
    canvas.drawPath(
      Path.combine(PathOperation.difference, _shieldOutline(302, 63), inner),
      fill,
    );

    final shackle = Path()
      ..moveTo(272, 224)
      ..relativeLineTo(0, -34)
      ..relativeCubicTo(0, -22, 15, -34, 32, -34)
      ..relativeCubicTo(18, 0, 32, 14, 34, 40);
    canvas.drawPath(
      shackle,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 19
        ..strokeCap = StrokeCap.round,
    );

    final body = Path()
      ..addRRect(
        RRect.fromRectAndRadius(
          const Rect.fromLTWH(240, 217, 122, 93),
          const Radius.circular(12),
        ),
      );
    final keyhole = Path()
      ..addOval(Rect.fromCircle(center: const Offset(301, 250), radius: 14))
      ..moveTo(294, 260)
      ..lineTo(290, 286)
      ..lineTo(312, 286)
      ..lineTo(308, 260)
      ..close();
    canvas.drawPath(
      Path.combine(PathOperation.difference, body, keyhole),
      fill,
    );

    final key = Path()
      ..moveTo(283, 306)
      ..relativeLineTo(27, 0)
      ..relativeLineTo(0, 10)
      ..relativeLineTo(17, 4)
      ..relativeLineTo(0, 10)
      ..relativeLineTo(-13, 4)
      ..relativeLineTo(0, 6)
      ..relativeLineTo(8, 2)
      ..relativeLineTo(0, 9)
      ..relativeLineTo(-12, 4)
      ..relativeLineTo(0, 13)
      ..relativeLineTo(-12, 13)
      ..relativeLineTo(-15, -16)
      ..close();
    canvas.drawPath(key, fill);
  }

  @override
  bool shouldRepaint(_LogoPainter oldDelegate) => oldDelegate.color != color;
}

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

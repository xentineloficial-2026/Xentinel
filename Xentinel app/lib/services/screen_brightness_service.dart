import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:screen_brightness/screen_brightness.dart';

/// Brillo de la pantalla mientras se muestra el carnet.
///
/// Una pantalla atenuada (brillo automático, ahorro de batería o modo oscuro)
/// reduce el contraste del QR y la cámara de otro teléfono no logra leerlo; por eso
/// el carnet sube el brillo de la app al máximo, como las tarjetas de embarque, y lo
/// devuelve al salir. Solo afecta a esta app, no al ajuste del sistema.
abstract interface class BrightnessControl {
  Future<void> maximize();
  Future<void> restore();
}

class DeviceBrightness implements BrightnessControl {
  const DeviceBrightness();

  @override
  Future<void> maximize() async {
    try {
      await ScreenBrightness.instance.setApplicationScreenBrightness(1.0);
    } catch (_) {
      // Dispositivo o plataforma sin control de brillo: el carnet sigue visible.
    }
  }

  @override
  Future<void> restore() async {
    try {
      await ScreenBrightness.instance.resetApplicationScreenBrightness();
    } catch (_) {}
  }
}

final brightnessControlProvider = Provider<BrightnessControl>(
  (_) => const DeviceBrightness(),
);

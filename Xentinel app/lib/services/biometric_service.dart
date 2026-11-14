import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

/// Verificación biométrica (huella / rostro / PIN del dispositivo).
class BiometricService {
  final LocalAuthentication _auth = LocalAuthentication();

  /// Devuelve `true` si el usuario se verificó con huella, rostro o el PIN/patrón
  /// del teléfono. Un teléfono sin ningún bloqueo de pantalla no puede verificar a
  /// nadie: se acepta, porque en el login la contraseña ya la validó el servidor y el
  /// carnet sin conexión solo existe en el teléfono de su titular.
  Future<bool> authenticate() async {
    try {
      final supported = await _auth.isDeviceSupported();
      if (!supported) return true;
      return await _auth.authenticate(
        localizedReason: 'Verifica tu identidad para ingresar a Xentinel',
        options: const AuthenticationOptions(stickyAuth: true),
      );
    } on PlatformException {
      return false;
    }
  }
}

final biometricServiceProvider = Provider<BiometricService>(
  (_) => BiometricService(),
);

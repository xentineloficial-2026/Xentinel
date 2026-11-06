import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

/// Verificación biométrica (huella / rostro / PIN del dispositivo).
class BiometricService {
  final LocalAuthentication _auth = LocalAuthentication();

  /// Devuelve `true` si el usuario se verificó.
  /// Si el dispositivo no soporta biometría ni credenciales, devuelve `true`
  /// (modo de pruebas/emulador). Cambia ese comportamiento si lo necesitas.
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

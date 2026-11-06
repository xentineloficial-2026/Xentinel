import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/errors.dart';
import '../models/xentinel_models.dart';
import '../repositories/auth_repository.dart';
import '../services/biometric_service.dart';
import '../core/session.dart';

/// Login REST por documento + contraseña con verificación biométrica
/// del dispositivo.
class AuthController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  /// Devuelve un mensaje de error, o `null` si el ingreso fue exitoso.
  Future<String?> login(String documentId, String password) async {
    if (state.isLoading) return null;
    final doc = documentId.trim();
    if (doc.isEmpty || password.isEmpty) {
      return 'Ingresa tu documento y tu contraseña.';
    }

    state = const AsyncLoading();
    try {
      final result = await ref
          .read(authRepositoryProvider)
          .login(doc, password);
      final user = result.user;
      if (user.status == AccessStatus.denegado) {
        state = const AsyncData(null);
        return user.denialReason ?? 'Tu acceso está denegado.';
      }

      final verified = await ref.read(biometricServiceProvider).authenticate();
      if (!verified) {
        state = const AsyncData(null);
        return 'Verificación biométrica cancelada.';
      }

      state = const AsyncData(null);
      ref.read(sessionProvider).signIn(user, result.token, result.expiresIn);
      return null;
    } catch (e) {
      state = const AsyncData(null);
      return describeError(e);
    }
  }

  Future<void> logout() async {
    final session = ref.read(sessionProvider);
    final token = session.token;
    try {
      await ref.read(authRepositoryProvider).logout();
    } catch (_) {
      /* Local logout remains possible when offline. */
    } finally {
      if (session.token == token) session.clear();
    }
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, void>(
  AuthController.new,
);

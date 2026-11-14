import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_config.dart';
import '../services/api_client.dart';
import '../models/xentinel_models.dart';

/// Contrato REST del Backend Xentinel /api/v1/auth.
class AuthRepository {
  AuthRepository(this._client);

  final ApiClient _client;

  Future<({UserEntity user, String token, int expiresIn})> login(
    String documentId,
    String password,
  ) async {
    final data = await _client.request(
      'auth/login',
      method: 'POST',
      authenticated: false,
      body: {'documento': documentId.trim(), 'contrasena': password},
    );
    return _session(data, 'La respuesta de inicio de sesión no es válida.');
  }

  /// Nuevo JWT antes de que venza el actual (`POST /auth/renovar`).
  Future<({UserEntity user, String token, int expiresIn})> renew() async {
    final data = await _client.request('auth/renovar', method: 'POST');
    return _session(data, 'La renovación de la sesión no es válida.');
  }

  static ({UserEntity user, String token, int expiresIn}) _session(
    Object? data,
    String invalidMessage,
  ) {
    if (data is! Map ||
        data['usuario'] is! Map ||
        data['access_token'] is! String ||
        (data['access_token'] as String).isEmpty ||
        data['expires_in'] is! int ||
        (data['expires_in'] as int) <= 0) {
      throw ApiException('INVALID_RESPONSE', invalidMessage);
    }
    return (
      user: UserEntity.fromApi(
        Map<String, dynamic>.from(data['usuario'] as Map),
      ),
      token: data['access_token'] as String,
      expiresIn: data['expires_in'] as int,
    );
  }

  /// Clave del carnet QR firmado del titular (`GET /auth/credencial-qr`).
  Future<Object?> qrCredential() => _client.request('auth/credencial-qr');

  Future<void> forgotPassword(String email) async {
    await _client.request(
      'auth/olvide-contrasena',
      method: 'POST',
      authenticated: false,
      body: {'correo': email.trim().toLowerCase()},
    );
  }

  Future<void> logout() async {
    await _client.request('auth/logout', method: 'POST');
  }
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(apiClientProvider)),
);

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/qr_codes.dart';
import '../models/xentinel_models.dart';

/// Credencial del carnet QR firmado guardada en el almacén seguro del sistema
/// (Android Keystore / Keychain de iOS), para mostrar el carnet sin conexión.
///
/// Contiene la clave HMAC del titular y los datos visibles del carnet. No guarda
/// contraseñas ni JWT. El servidor la revoca al cerrar sesión, cambiar la
/// contraseña o desactivar la cuenta.
class QrCredential {
  const QrCredential({
    required this.userId,
    required this.name,
    required this.documentId,
    required this.role,
    required this.status,
    required this.key,
    required this.stepSeconds,
    required this.issuedAt,
  });

  final int userId;
  final String name;
  final String documentId;
  final UserRole role;
  final AccessStatus status;
  final Uint8List key;
  final int stepSeconds;
  final DateTime issuedAt;

  /// Una credencial sin renovar en 30 días deja de mostrarse sin conexión.
  static const maxOfflineAge = Duration(days: 30);

  bool isUsableAt(DateTime now) =>
      key.length >= 16 && now.difference(issuedAt) < maxOfflineAge;

  String codeAt(DateTime serverNow) => XentinelQr.generate(
    key,
    userId,
    XentinelQr.stepAt(serverNow, seconds: stepSeconds),
  );

  /// Respuesta de `GET /auth/credencial-qr` más el usuario de la sesión.
  static QrCredential? fromApi(Object? data, UserEntity user, DateTime now) {
    if (data is! Map ||
        data['formato'] != XentinelQr.prefix ||
        data['id_usuarios'] is! int ||
        '${data['id_usuarios']}' != user.id ||
        data['clave'] is! String ||
        data['paso_segundos'] != XentinelQr.stepSeconds) {
      return null;
    }
    final Uint8List key;
    try {
      key = XentinelQr.decodeKey(data['clave'] as String);
    } on FormatException {
      return null;
    }
    if (key.length < 16) return null;
    return QrCredential(
      userId: data['id_usuarios'] as int,
      name: user.name,
      documentId: user.documentId,
      role: user.role,
      status: user.status,
      key: key,
      stepSeconds: XentinelQr.stepSeconds,
      issuedAt: now,
    );
  }

  Map<String, Object> toJson() => {
    'v': 1,
    'id': userId,
    'nombre': name,
    'documento': documentId,
    'rol': role.name,
    'estado': status.name,
    'clave': base64Url.encode(key),
    'paso': stepSeconds,
    'emitida': issuedAt.toUtc().toIso8601String(),
  };

  static QrCredential? fromJson(Object? json) {
    if (json is! Map || json['v'] != 1) return null;
    try {
      return QrCredential(
        userId: json['id'] as int,
        name: json['nombre'] as String,
        documentId: json['documento'] as String,
        role: UserRole.values.byName(json['rol'] as String),
        status: AccessStatus.values.byName(json['estado'] as String),
        key: base64Url.decode(json['clave'] as String),
        stepSeconds: json['paso'] as int,
        issuedAt: DateTime.parse(json['emitida'] as String),
      );
    } catch (_) {
      return null;
    }
  }
}

abstract interface class SecureKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class DeviceSecureStore implements SecureKeyValueStore {
  const DeviceSecureStore();
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(resetOnError: true),
    // Solo en este dispositivo; disponible tras el primer desbloqueo.
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Carnet guardado del último titular que inició sesión en este teléfono.
class CredentialStore extends ChangeNotifier {
  CredentialStore(this._store);

  static const _key = 'xentinel_qr_credential_v1';
  final SecureKeyValueStore _store;
  QrCredential? _current;
  bool _loaded = false;
  Future<void>? _loading;

  QrCredential? get current => _current;
  bool get loaded => _loaded;

  Future<void> load() => _loading ??= _load();

  Future<void> _load() async {
    try {
      final raw = await _store.read(_key);
      _current = raw == null ? null : QrCredential.fromJson(jsonDecode(raw));
    } catch (_) {
      // Un almacén ilegible (p. ej. tras restaurar otro teléfono) equivale a vacío.
      _current = null;
    }
    _loaded = true;
    notifyListeners();
  }

  Future<void> save(QrCredential credential) async {
    _current = credential;
    _loaded = true;
    notifyListeners();
    try {
      await _store.write(_key, jsonEncode(credential.toJson()));
    } catch (_) {
      // Sin almacén seguro el carnet funciona igual mientras la app esté abierta.
    }
  }

  Future<void> clear() async {
    _current = null;
    notifyListeners();
    try {
      await _store.delete(_key);
    } catch (_) {}
  }
}

final secureStoreProvider = Provider<SecureKeyValueStore>(
  (_) => const DeviceSecureStore(),
);

final credentialStoreProvider = ChangeNotifierProvider<CredentialStore>((ref) {
  final store = CredentialStore(ref.watch(secureStoreProvider));
  store.load();
  return store;
});

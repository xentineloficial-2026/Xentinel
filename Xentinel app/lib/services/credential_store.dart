import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/qr_codes.dart';
import '../models/xentinel_models.dart';

/// Credencial del carnet QR firmado del titular de la sesión.
///
/// Contiene la clave HMAC del titular y los datos visibles del carnet. Vive solo en
/// memoria mientras hay sesión: Xentinel valida los carnets en línea y no conserva
/// un carnet para mostrarlo sin conexión. El servidor la revoca al cerrar sesión,
/// cambiar la contraseña o desactivar la cuenta.
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

/// Carnet del titular de la sesión, en memoria.
///
/// Las versiones 1.2 y anteriores guardaban la credencial en el almacén seguro para
/// mostrar el carnet sin conexión; al cargar se borra ese residuo.
class CredentialStore extends ChangeNotifier {
  CredentialStore(this._store);

  static const _legacyKey = 'xentinel_qr_credential_v1';
  final SecureKeyValueStore _store;
  QrCredential? _current;
  bool _loaded = false;
  Future<void>? _loading;

  QrCredential? get current => _current;
  bool get loaded => _loaded;

  Future<void> load() => _loading ??= _load();

  Future<void> _load() async {
    try {
      await _store.delete(_legacyKey);
    } catch (_) {
      // Un almacén ilegible no impide usar la app: la credencial nunca se lee de él.
    }
    _loaded = true;
    notifyListeners();
  }

  Future<void> save(QrCredential credential) async {
    _current = credential;
    _loaded = true;
    notifyListeners();
  }

  Future<void> clear() async {
    _current = null;
    notifyListeners();
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

import 'dart:async';

import 'package:xentinel/services/access_outbox.dart';
import 'package:xentinel/services/credential_store.dart';
import 'package:xentinel/services/network_status.dart';
import 'package:xentinel/services/screen_brightness_service.dart';

/// Almacén seguro en memoria (Keystore/Keychain no existen en las pruebas).
class MemorySecureStore implements SecureKeyValueStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

class MemoryOutboxPersistence implements OutboxPersistence {
  String? value;
  int writes = 0;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String data) async {
    writes++;
    value = data;
  }
}

/// Red controlable: permite simular pérdida y recuperación de la conexión.
class FakeConnectivity implements ConnectivitySource {
  FakeConnectivity({this.online = true});
  bool online;
  final _changes = StreamController<bool>.broadcast();

  void set(bool value) {
    online = value;
    _changes.add(value);
  }

  @override
  Future<bool> isOnline() async => online;
  @override
  Stream<bool> get changes => _changes.stream;
}

class FakeBrightness implements BrightnessControl {
  int maximized = 0;
  int restored = 0;
  @override
  Future<void> maximize() async => maximized++;
  @override
  Future<void> restore() async => restored++;
}

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Fuente de cambios de red del sistema (sustituible en pruebas).
abstract interface class ConnectivitySource {
  Future<bool> isOnline();
  Stream<bool> get changes;
}

class DeviceConnectivity implements ConnectivitySource {
  DeviceConnectivity([Connectivity? connectivity])
    : _connectivity = connectivity ?? Connectivity();
  final Connectivity _connectivity;

  static bool _hasNetwork(List<ConnectivityResult> results) =>
      results.any((r) => r != ConnectivityResult.none);

  @override
  Future<bool> isOnline() async =>
      _hasNetwork(await _connectivity.checkConnectivity());

  @override
  Stream<bool> get changes =>
      _connectivity.onConnectivityChanged.map(_hasNetwork).distinct();
}

/// Estado de red de la app. Solo distingue "hay interfaz de red" de "no la hay":
/// una red sin salida a internet se detecta con el fallo de la propia solicitud.
///
/// Sirve para reaccionar al instante cuando el teléfono pasa de Wi‑Fi a datos
/// móviles o recupera señal: reconectar el canal en tiempo real y enviar los
/// accesos registrados sin conexión, sin esperar a un temporizador.
class NetworkStatus extends ChangeNotifier {
  NetworkStatus(this._source) {
    _subscription = _source.changes.listen(_update, onError: (Object _) {});
    _source.isOnline().then(_update).catchError((Object _) {});
  }

  final ConnectivitySource _source;
  StreamSubscription<bool>? _subscription;
  bool _online = true;
  bool _closed = false;
  final _restored = StreamController<void>.broadcast();

  bool get online => _online;

  /// Se emite cada vez que vuelve la conectividad.
  Stream<void> get restored => _restored.stream;

  void _update(bool value) {
    if (_closed || value == _online) return;
    _online = value;
    notifyListeners();
    if (value) _restored.add(null);
  }

  @override
  void dispose() {
    _closed = true;
    _subscription?.cancel();
    _restored.close();
    super.dispose();
  }
}

final connectivitySourceProvider = Provider<ConnectivitySource>(
  (_) => DeviceConnectivity(),
);

final networkStatusProvider = ChangeNotifierProvider<NetworkStatus>(
  (ref) => NetworkStatus(ref.watch(connectivitySourceProvider)),
);

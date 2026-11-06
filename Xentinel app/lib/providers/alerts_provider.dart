import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_config.dart';
import '../core/errors.dart';
import '../core/session.dart';
import '../models/emergency_alert.dart';
import '../repositories/alerts_repository.dart';
import '../services/alert_events.dart';

class AlertsMonitor extends ChangeNotifier {
  AlertsMonitor(
    this.repository,
    this.session, {
    this.enableEvents = true,
    this.pollInterval = const Duration(seconds: 3),
  });
  final AlertsRepository repository;
  final SessionStore session;
  final bool enableEvents;
  final Duration pollInterval;
  List<EmergencyAlert> alerts = const [];
  DateTime? lastUpdated;
  String? error;
  bool connected = false;
  bool loading = false;
  bool _active = false;
  bool _closed = false;
  bool _refreshAgain = false;
  int _failures = 0;
  int _streamGeneration = 0;
  int _reconnectSeconds = 2;
  String? _cursor;
  Timer? _poll;
  Timer? _reconnect;
  AlertEventConnection? _connection;
  StreamSubscription<ServerEvent>? _events;

  void setActive(bool active) {
    if (_closed || _active == active) return;
    _active = active;
    if (active && session.token != null) {
      unawaited(refresh());
      if (enableEvents) _connect();
    } else {
      _poll?.cancel();
      _reconnect?.cancel();
      _streamGeneration++;
      _connection?.close();
      unawaited(_events?.cancel());
      connected = false;
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    if (_closed || !_active || session.token == null) return;
    if (loading) {
      _refreshAgain = true;
      return;
    }
    _poll?.cancel();
    loading = true;
    notifyListeners();
    try {
      final result = await repository.fetchActive();
      if (_closed) return;
      alerts = result;
      lastUpdated = DateTime.now();
      error = null;
      _failures = 0;
    } catch (failure) {
      if (_closed) return;
      // Retain the last known emergency. Network failure is not an all-clear.
      error = describeError(failure);
      _failures = (_failures + 1).clamp(0, 4);
    } finally {
      if (!_closed) {
        loading = false;
        notifyListeners();
        if (_active && session.token != null) {
          final delay = _refreshAgain
              ? Duration.zero
              : Duration(
                  milliseconds: (pollInterval.inMilliseconds * (1 << _failures))
                      .clamp(100, 30000),
                );
          _refreshAgain = false;
          _poll = Timer(delay, refresh);
        }
      }
    }
  }

  void _connect() {
    if (_closed || !_active || session.token == null) return;
    final generation = ++_streamGeneration;
    final token = session.token!;
    _connection?.close();
    _connection = AlertEventConnection();
    try {
      _events = _connection!
          .connect(repository.api.uri('eventos'), token, _cursor)
          .listen(
            (event) {
              if (_closed || !_active || generation != _streamGeneration) {
                return;
              }
              connected = true;
              _reconnectSeconds = 2;
              _cursor = event.id ?? _cursor;
              if (event.type == 'auth-expired') {
                if (session.token == token) session.expire();
                return;
              }
              if (event.type == 'change' &&
                  event.data['recurso'] == 'alertas_emergencia') {
                unawaited(refresh());
              }
              notifyListeners();
            },
            onError: (Object failure) {
              if (failure is ApiException &&
                  failure.status == 401 &&
                  session.token == token) {
                session.expire();
              }
              if (failure is ApiException && failure.status == 409) {
                _cursor = null;
              }
              _reconnectStream(generation);
            },
            onDone: () => _reconnectStream(generation),
            cancelOnError: true,
          );
    } catch (_) {
      _reconnectStream(generation);
    }
  }

  void _reconnectStream(int generation) {
    if (_closed ||
        !_active ||
        generation != _streamGeneration ||
        session.token == null) {
      return;
    }
    connected = false;
    _reconnect?.cancel();
    _reconnect = Timer(Duration(seconds: _reconnectSeconds), _connect);
    _reconnectSeconds = (_reconnectSeconds * 2).clamp(2, 30);
    notifyListeners();
  }

  @override
  void dispose() {
    _closed = true;
    _poll?.cancel();
    _reconnect?.cancel();
    _connection?.close();
    unawaited(_events?.cancel());
    super.dispose();
  }
}

final alertsProvider = ChangeNotifierProvider<AlertsMonitor>((ref) {
  ref.watch(sessionProvider.select((session) => session.token));
  return AlertsMonitor(
    ref.watch(alertsRepositoryProvider),
    ref.read(sessionProvider),
  );
});

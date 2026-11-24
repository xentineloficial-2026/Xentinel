import 'dart:async';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_config.dart';
import '../core/errors.dart';
import '../core/session.dart';
import '../models/emergency_alert.dart';
import '../models/scan_alarm.dart';
import '../models/xentinel_models.dart';
import '../repositories/alerts_repository.dart';
import '../services/alert_events.dart';
import '../services/network_status.dart';
import '../services/realtime_socket.dart';

typedef EventConnectionFactory = EventConnection Function();

/// Estado de la conexión en vivo, para mostrarlo a la persona.
enum LinkState { offline, connecting, live, polling }

/// Sincroniza las alertas con el servidor en la nube desde cualquier red.
///
/// 1. WebSocket seguro (WSS) como canal principal.
/// 2. SSE si una red o un proxy bloquea WebSocket.
/// 3. Consulta periódica de respaldo: cada 60 s con canal en vivo (red de
///    seguridad) y cada 3 s, con espera progresiva, cuando no lo hay.
///
/// Al recuperar la red o volver la app al frente reconecta de inmediato. Sin red no
/// gasta batería reintentando: espera el aviso del sistema. Las últimas alertas se
/// conservan sin conexión y se marcan como desactualizadas.
class AlertsMonitor extends ChangeNotifier {
  AlertsMonitor(
    this.repository,
    this.session, {
    this.network,
    this.enableEvents = true,
    this.pollInterval = const Duration(seconds: 3),
    this.livePollInterval = const Duration(seconds: 60),
    EventConnectionFactory? webSocket,
    EventConnectionFactory? sse,
    Uri Function()? realtimeUri,
    Random? random,
  }) : _webSocket = webSocket ?? WebSocketEventConnection.new,
       _sse = sse ?? AlertEventConnection.new,
       _realtimeUri = realtimeUri ?? ApiConfig.realtimeEndpoint,
       _random = random ?? Random() {
    _networkSubscription = network?.restored.listen(
      (_) => _onNetworkRestored(),
    );
    network?.addListener(_onNetworkChanged);
  }

  final AlertsRepository repository;
  final SessionStore session;
  final NetworkStatus? network;
  final bool enableEvents;
  final Duration pollInterval;
  final Duration livePollInterval;
  final EventConnectionFactory _webSocket;
  final EventConnectionFactory _sse;
  final Uri Function() _realtimeUri;
  final Random _random;

  List<EmergencyAlert> alerts = const [];

  /// Carnets QR vencidos o que no son verídicos, pendientes de revisar. Solo para el
  /// personal de control y la administración.
  List<ScanAlarm> scanAlarms = const [];
  DateTime? lastUpdated;
  String? error;
  bool connected = false;
  bool loading = false;

  /// Transporte en uso: "WebSocket", "SSE" o null.
  String? transport;
  bool _active = false;
  bool _closed = false;
  bool _refreshAgain = false;
  int _failures = 0;
  int _streamGeneration = 0;
  int _reconnectSeconds = 1;
  int _webSocketFailures = 0;
  DateTime? _sseUntil;
  String? _cursor;
  String? _streamToken;
  Timer? _poll;
  Timer? _reconnect;
  EventConnection? _connection;
  StreamSubscription<ServerEvent>? _events;
  StreamSubscription<void>? _networkSubscription;

  bool get online => network?.online ?? true;

  /// El personal de control y la administración también ven las alarmas de escaneo.
  bool get includesScans =>
      session.user?.role == UserRole.guardia ||
      session.user?.role == UserRole.administrador;

  /// Alarmas por color del semáforo (riesgos y escaneos).
  int countOf(Semaforo color) =>
      alerts.where((alert) => alert.semaforo == color).length +
      scanAlarms.where((alarm) => alarm.semaforo == color).length;

  /// Marca una alarma de escaneo como revisada y la quita de la lista.
  Future<void> attendScan(ScanAlarm alarm) async {
    await repository.attendScanAlarm(alarm.id);
    if (_closed) return;
    scanAlarms = List.unmodifiable(
      scanAlarms.where((item) => item.id != alarm.id),
    );
    notifyListeners();
  }

  LinkState get linkState {
    if (!online) return LinkState.offline;
    if (connected) return LinkState.live;
    if (_active && enableEvents && _reconnect == null && _connection != null) {
      return LinkState.connecting;
    }
    return LinkState.polling;
  }

  void setActive(bool active) {
    if (_closed || _active == active) return;
    _active = active;
    if (active && session.token != null) {
      session.addListener(_onSessionChanged);
      unawaited(refresh());
      if (enableEvents) _connect();
    } else {
      session.removeListener(_onSessionChanged);
      _stopStream();
      _poll?.cancel();
      notifyListeners();
    }
  }

  void _stopStream() {
    _reconnect?.cancel();
    _reconnect = null;
    _streamGeneration++;
    unawaited(_connection?.close());
    _connection = null;
    unawaited(_events?.cancel());
    connected = false;
    transport = null;
  }

  /// Un token renovado se entrega al canal abierto sin reconectar.
  void _onSessionChanged() {
    final token = session.token;
    if (_closed || !_active || token == null || token == _streamToken) return;
    _streamToken = token;
    _connection?.updateToken(token);
  }

  void _onNetworkChanged() {
    if (_closed) return;
    if (!online) {
      // Sin red no se reintenta; el aviso de recuperación reconecta al instante.
      _stopStream();
      _poll?.cancel();
    }
    notifyListeners();
  }

  void _onNetworkRestored() {
    if (_closed || !_active || session.token == null) return;
    _failures = 0;
    _reconnectSeconds = 1;
    unawaited(refresh());
    if (enableEvents && !connected) {
      _stopStream();
      _connect();
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
      if (includesScans) {
        try {
          scanAlarms = await repository.fetchScanAlarms();
        } catch (_) {
          // Sin la lista de escaneos, las alarmas de riesgo siguen al día.
        }
      } else {
        scanAlarms = const [];
      }
      if (_closed) return;
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
        _schedulePoll();
      }
    }
  }

  void _schedulePoll() {
    _poll?.cancel();
    if (!_active || session.token == null) return;
    if (!online && !_refreshAgain) return;
    final base = connected ? livePollInterval : pollInterval;
    final delay = _refreshAgain
        ? Duration.zero
        : Duration(
            milliseconds: (base.inMilliseconds * (1 << _failures)).clamp(
              100,
              connected ? livePollInterval.inMilliseconds : 30000,
            ),
          );
    _refreshAgain = false;
    _poll = Timer(delay, refresh);
  }

  bool get _preferSse =>
      _sseUntil != null && DateTime.now().isBefore(_sseUntil!);

  void _connect() {
    _reconnect = null;
    if (_closed || !_active || session.token == null || !online) return;
    final generation = ++_streamGeneration;
    final token = session.token!;
    _streamToken = token;
    unawaited(_connection?.close());
    final useSse = _preferSse;
    final connection = useSse ? _sse() : _webSocket();
    _connection = connection;
    try {
      final uri = useSse ? repository.api.uri('eventos') : _realtimeUri();
      _events = connection
          .connect(uri, token, _cursor)
          .listen(
            (event) => _onEvent(event, generation, token, connection),
            onError: (Object failure) =>
                _onStreamError(failure, generation, token, connection),
            onDone: () => _reconnectStream(generation),
            cancelOnError: true,
          );
    } catch (failure) {
      _onStreamError(failure, generation, token, connection);
    }
    notifyListeners();
  }

  void _onEvent(
    ServerEvent event,
    int generation,
    String token,
    EventConnection connection,
  ) {
    if (_closed || !_active || generation != _streamGeneration) return;
    final wasConnected = connected;
    connected = true;
    transport = connection.transport;
    _reconnectSeconds = 1;
    if (connection.transport != 'SSE') _webSocketFailures = 0;
    _cursor = event.id ?? _cursor;
    if (event.type == 'auth-expired') {
      // El canal SSE se abrió con el token anterior a la renovación: reabrirlo.
      if (session.token != null && session.token != token) {
        _stopStream();
        _connect();
      } else if (session.token == token) {
        session.expire();
      }
      return;
    }
    if (event.type == 'change' &&
        const {
          'alertas_emergencia',
          'alarmas_qr',
        }.contains(event.data['recurso'])) {
      unawaited(refresh());
    }
    // Con el canal en vivo la consulta periódica pasa a ser una red de seguridad.
    if (!wasConnected) _schedulePoll();
    notifyListeners();
  }

  void _onStreamError(
    Object failure,
    int generation,
    String token,
    EventConnection connection,
  ) {
    if (_closed || generation != _streamGeneration) return;
    final webSocket = connection.transport != 'SSE';
    if (failure is ApiException) {
      if (failure.status == 401) {
        if (session.token == token) {
          session.expire();
          return;
        }
        // Se cerró con un token ya renovado: reconectar con el actual.
        _reconnectSeconds = 1;
      }
      if (failure.status == 409) _cursor = null;
      if (webSocket &&
          (failure.code == 'UPGRADE_REJECTED' || failure.status == 403)) {
        // La red o el proxy no permiten WebSocket: SSE durante 5 minutos.
        _useSseForAWhile();
      }
    }
    if (webSocket && !connected && ++_webSocketFailures >= 2) {
      _useSseForAWhile();
    }
    _reconnectStream(generation);
  }

  void _useSseForAWhile() {
    _sseUntil = DateTime.now().add(const Duration(minutes: 5));
    _webSocketFailures = 0;
  }

  void _reconnectStream(int generation) {
    if (_closed ||
        !_active ||
        generation != _streamGeneration ||
        session.token == null) {
      return;
    }
    final wasConnected = connected;
    connected = false;
    transport = null;
    _reconnect?.cancel();
    _reconnect = null;
    if (online) {
      // Espera progresiva con variación aleatoria: muchos teléfonos que pierden la
      // red a la vez no reconectan todos en el mismo instante.
      final jitter = _random.nextInt(500);
      _reconnect = Timer(
        Duration(milliseconds: _reconnectSeconds * 1000 + jitter),
        _connect,
      );
      _reconnectSeconds = (_reconnectSeconds * 2).clamp(1, 30);
    }
    if (wasConnected) _schedulePoll();
    notifyListeners();
  }

  @override
  void dispose() {
    _closed = true;
    session.removeListener(_onSessionChanged);
    network?.removeListener(_onNetworkChanged);
    unawaited(_networkSubscription?.cancel());
    _poll?.cancel();
    _reconnect?.cancel();
    unawaited(_connection?.close());
    unawaited(_events?.cancel());
    super.dispose();
  }
}

/// Se recrea solo al cambiar la persona (no al renovar el token): las alertas
/// atendidas y el canal abierto sobreviven a la renovación de la sesión.
final alertsProvider = ChangeNotifierProvider<AlertsMonitor>((ref) {
  ref.watch(sessionProvider.select((session) => session.user?.id));
  return AlertsMonitor(
    ref.watch(alertsRepositoryProvider),
    ref.read(sessionProvider),
    // `read`: un cambio de red lo atiende el monitor; no debe recrearlo.
    network: ref.read(networkStatusProvider),
  );
});

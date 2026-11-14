import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../core/api_config.dart';
import '../core/server_clock.dart';
import 'alert_events.dart';

/// Abre un WebSocket. Sustituible en pruebas.
typedef WebSocketConnector = Future<WebSocket> Function(Uri uri);

Future<WebSocket> _connectDevice(Uri uri) async {
  final client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 10)
    ..idleTimeout = const Duration(seconds: 30);
  try {
    return await WebSocket.connect(
      uri.toString(),
      customClient: client,
      headers: const {'User-Agent': 'Xentinel-Movil/1.1'},
    );
  } finally {
    // El socket ya actualizado queda separado del cliente: cerrarlo no lo afecta y
    // evita acumular clientes HTTP en cada reconexión.
    client.close();
  }
}

/// Canal WSS `/api/v1/tiempo-real`: una sola conexión saliente cifrada al
/// servidor en la nube, por el mismo puerto 443 de la API. Funciona detrás de NAT,
/// en datos móviles y entre redes distintas; no requiere puertos abiertos ni que
/// los teléfonos compartan Wi‑Fi.
///
/// - Autenticación en el primer mensaje: el JWT no viaja en la URL.
/// - Ping de protocolo cada 20 s y vigilancia de inactividad: el servidor envía un
///   `checkpoint` cada 15 s, si no llega nada en 45 s la conexión se da por caída
///   (cambio de antena, Wi‑Fi a datos) y el monitor reconecta.
/// - `ping` de aplicación para sincronizar el reloj del servidor.
class WebSocketEventConnection implements EventConnection {
  WebSocketEventConnection({
    WebSocketConnector? connector,
    this.connectTimeout = const Duration(seconds: 15),
    this.idleTimeout = const Duration(seconds: 45),
    this.clockSyncInterval = const Duration(seconds: 60),
    this.protocolPingInterval = const Duration(seconds: 20),
  }) : _connector = connector ?? _connectDevice;

  final WebSocketConnector _connector;
  final Duration connectTimeout;
  final Duration idleTimeout;
  final Duration clockSyncInterval;
  final Duration protocolPingInterval;

  late final _output = StreamController<ServerEvent>(onCancel: close);
  WebSocket? _socket;
  StreamSubscription<dynamic>? _subscription;
  Future<void>? _opening;
  Future<void>? _closing;
  Timer? _idle;
  Timer? _clockSync;
  DateTime? _pingSentAt;
  DateTime? _authSentAt;
  ApiException? _serverError;
  bool _closed = false;

  @override
  String get transport => 'WebSocket';

  @override
  Stream<ServerEvent> connect(Uri uri, String token, String? cursor) {
    if (_opening != null || _closed) {
      throw StateError('Connection already used');
    }
    _opening = _open(uri, token, cursor);
    return _output.stream;
  }

  Future<void> _open(Uri uri, String token, String? cursor) async {
    try {
      final socket = await _connector(uri).timeout(connectTimeout);
      if (_closed) {
        await socket.close(1000);
        return;
      }
      _socket = socket..pingInterval = protocolPingInterval;
      _subscription = socket.listen(
        _onMessage,
        onError: (Object error, StackTrace trace) =>
            _fail(_describe(error), trace),
        onDone: _onDone,
        cancelOnError: true,
      );
      _authSentAt = DateTime.now();
      _send({'tipo': 'auth', 'token': token, 'cursor': cursor ?? '0'});
      _armIdle();
    } catch (error, trace) {
      _fail(_describe(error), trace);
    }
  }

  static Object _describe(Object error) {
    if (error is ApiException || error is FormatException) return error;
    if (error is TimeoutException) {
      return const ApiException(
        'TIMEOUT',
        'El canal en tiempo real no respondió a tiempo.',
      );
    }
    // El servidor o un proxy respondió, pero no aceptó WebSocket (p. ej. 404 o
    // un proxy que no permite Upgrade): el monitor usará SSE.
    if (error is WebSocketException) {
      return ApiException(
        'UPGRADE_REJECTED',
        'El servidor no aceptó la conexión WebSocket.',
        status: _statusFrom(error.message),
      );
    }
    return const ApiException(
      'NETWORK',
      'No se pudo conectar con Xentinel. Revisa tu conexión a internet.',
    );
  }

  static int? _statusFrom(String message) {
    final match = RegExp(r'\b([1-5]\d\d)\b').firstMatch(message);
    return match == null ? null : int.tryParse(match.group(1)!);
  }

  void _armIdle() {
    _idle?.cancel();
    _idle = Timer(idleTimeout, () {
      _fail(
        const ApiException(
          'TIMEOUT',
          'El canal en tiempo real dejó de responder.',
        ),
        StackTrace.current,
      );
    });
  }

  void _onMessage(dynamic raw) {
    if (_closed) return;
    _armIdle();
    if (raw is! String || raw.length > 65536) {
      _fail(const FormatException('Mensaje inválido'), StackTrace.current);
      return;
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException catch (error, trace) {
      _fail(error, trace);
      return;
    }
    if (decoded is! Map<String, dynamic>) return;
    final type = decoded['tipo'];
    switch (type) {
      case 'listo':
        _syncClock(decoded['servidor_ms'], sentAt: _authSentAt);
        _scheduleClockSync();
        _emit('ready', decoded, _cursor(decoded['cursor']));
      case 'checkpoint':
        _emit('checkpoint', decoded, _cursor(decoded['cursor']));
      case 'change':
        final data = decoded['data'];
        if (data is Map<String, dynamic>) {
          _emit('change', data, _cursor(decoded['id']));
        }
      case 'pong':
        _syncClock(decoded['servidor_ms'], sentAt: _pingSentAt);
        _pingSentAt = null;
      case 'auth-expired':
        _emit('auth-expired', const {}, null);
      case 'error':
        final code = decoded['code'];
        final message = decoded['message'];
        _serverError = ApiException(
          code is String ? code : 'STREAM',
          message is String ? message : 'El canal en tiempo real se cerró.',
        );
    }
  }

  static String? _cursor(Object? value) =>
      value is String && RegExp(r'^\d{1,18}$').hasMatch(value) ? value : null;

  void _emit(String type, Map<String, dynamic> data, String? id) {
    if (!_closed) _output.add(ServerEvent(type, data, id));
  }

  void _syncClock(Object? serverMs, {DateTime? sentAt}) {
    if (serverMs is int && serverMs > 0) {
      ServerClock.syncFromMillis(serverMs, sentAt: sentAt);
    }
  }

  void _scheduleClockSync() {
    _clockSync?.cancel();
    _clockSync = Timer.periodic(clockSyncInterval, (_) {
      if (_pingSentAt != null) return;
      _pingSentAt = DateTime.now();
      _send({'tipo': 'ping'});
    });
  }

  @override
  void updateToken(String token) => _send({'tipo': 'auth', 'token': token});

  void _send(Map<String, Object?> message) {
    final socket = _socket;
    if (_closed || socket == null || socket.readyState != WebSocket.open) {
      return;
    }
    try {
      socket.add(jsonEncode(message));
    } catch (_) {
      // Un envío sobre un socket que se está cerrando termina en `onDone`.
    }
  }

  void _onDone() {
    if (_closed) return;
    final code = _socket?.closeCode;
    final error = switch (code) {
      4401 => ApiException(
        _serverError?.code ?? 'UNAUTHORIZED',
        'Tu sesión venció o fue revocada.',
        status: 401,
      ),
      4403 => const ApiException(
        'FORBIDDEN',
        'El servidor rechazó el canal en tiempo real.',
        status: 403,
      ),
      4409 => const ApiException(
        'INVALID_CURSOR',
        'Hay que volver a sincronizar las alertas.',
        status: 409,
      ),
      4429 => const ApiException(
        'STREAM_LIMIT',
        'Demasiadas conexiones abiertas con esta cuenta.',
        status: 429,
      ),
      _ => null,
    };
    if (error != null) {
      _fail(error, StackTrace.current);
    } else {
      unawaited(close());
    }
  }

  void _fail(Object error, StackTrace trace) {
    if (!_closed) _output.addError(error, trace);
    unawaited(close());
  }

  @override
  Future<void> close() => _closing ??= _close();

  Future<void> _close() async {
    _closed = true;
    _idle?.cancel();
    _clockSync?.cancel();
    await _opening;
    await _subscription?.cancel();
    try {
      await _socket?.close(1000).timeout(const Duration(seconds: 2));
    } catch (_) {
      // El socket puede estar ya cerrado por la red.
    }
    unawaited(_output.close());
  }
}

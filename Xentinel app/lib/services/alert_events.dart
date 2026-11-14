import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/api_config.dart';

class ServerEvent {
  const ServerEvent(this.type, this.data, this.id);
  final String type;
  final Map<String, dynamic> data;
  final String? id;
}

/// Transporte de eventos en tiempo real: WebSocket (preferido) o SSE (respaldo).
/// Ambos comparten cursor y formato, así el monitor puede cambiar de uno a otro
/// sin perder ni repetir cambios.
abstract interface class EventConnection {
  /// Nombre para diagnóstico y para la interfaz ("WebSocket", "SSE").
  String get transport;

  Stream<ServerEvent> connect(Uri uri, String token, String? cursor);

  /// Entrega un token renovado sin reconectar (sin efecto en SSE).
  void updateToken(String token);

  Future<void> close();
}

/// UTF-8 and line splitting are streaming: a network chunk is not an event.
Stream<ServerEvent> decodeServerEvents(Stream<List<int>> bytes) async* {
  var type = 'message';
  String? id;
  final data = <String>[];
  var size = 0;
  await for (final line
      in bytes.transform(utf8.decoder).transform(const LineSplitter())) {
    size += line.length;
    if (size > 65536) throw const FormatException('Evento demasiado grande');
    if (line.isEmpty) {
      if (data.isNotEmpty) {
        final decoded = jsonDecode(data.join('\n'));
        if (decoded is! Map<String, dynamic>) {
          throw const FormatException('Evento inválido');
        }
        yield ServerEvent(type, decoded, id);
      }
      type = 'message';
      id = null;
      data.clear();
      size = 0;
    } else if (!line.startsWith(':')) {
      final separator = line.indexOf(':');
      final field = separator < 0 ? line : line.substring(0, separator);
      var value = separator < 0 ? '' : line.substring(separator + 1);
      if (value.startsWith(' ')) value = value.substring(1);
      switch (field) {
        case 'event':
          type = value;
        case 'data':
          data.add(value);
        case 'id':
          if (RegExp(r'^\d{1,18}$').hasMatch(value)) id = value;
      }
    }
  }
}

/// Respaldo SSE (`GET /eventos`) para redes o proxies que bloquean WebSocket.
class AlertEventConnection implements EventConnection {
  AlertEventConnection({http.Client? client})
    : _client = client ?? http.Client();
  @override
  String get transport => 'SSE';
  final http.Client _client;
  final _abort = Completer<void>();
  late final _output = StreamController<ServerEvent>(onCancel: close);
  StreamSubscription<ServerEvent>? _subscription;
  Future<void>? _opening;
  Future<void>? _closing;
  bool _headersReceived = false;
  bool _closed = false;

  @override
  void updateToken(String token) {}

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
      final request =
          http.AbortableRequest('GET', uri, abortTrigger: _abort.future)
            ..followRedirects = false
            ..headers.addAll({
              'Accept': 'text/event-stream',
              'Authorization': 'Bearer $token',
              if (cursor != null) 'Last-Event-ID': cursor,
            });
      final response = await _client
          .send(request)
          .timeout(const Duration(seconds: 15));
      _headersReceived = true;
      if (_closed) {
        await response.stream.listen((_) {}, onError: (Object _) {}).cancel();
        return;
      }
      if (response.statusCode != 200) {
        await response.stream.listen((_) {}, onError: (Object _) {}).cancel();
        throw ApiException(
          'STREAM',
          'No se pudo abrir el canal de alertas.',
          status: response.statusCode,
        );
      }
      if (!(response.headers['content-type'] ?? '').startsWith(
        'text/event-stream',
      )) {
        await response.stream.listen((_) {}, onError: (Object _) {}).cancel();
        throw const FormatException('El servidor no envió eventos');
      }
      _subscription =
          decodeServerEvents(
            response.stream.timeout(const Duration(seconds: 40)),
          ).listen(
            (event) {
              if (!_closed) _output.add(event);
            },
            onError: (Object error, StackTrace trace) {
              if (!_closed) _output.addError(error, trace);
              unawaited(close());
            },
            onDone: () => unawaited(close()),
          );
    } catch (error, trace) {
      if (!_closed) _output.addError(error, trace);
      unawaited(close());
    }
  }

  @override
  Future<void> close() => _closing ??= _close();

  Future<void> _close() async {
    _closed = true;
    // Abort only before headers. Once streaming, cancel the owned subscription
    // and wait for it before closing the socket; injecting an abort error while
    // cancelling the listener can otherwise leak an asynchronous exception.
    if (!_headersReceived && !_abort.isCompleted) _abort.complete();
    await _opening;
    await _subscription?.cancel();
    _client.close();
    unawaited(_output.close());
  }
}

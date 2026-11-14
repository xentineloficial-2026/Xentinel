import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xentinel/core/api_config.dart';
import 'package:xentinel/core/server_clock.dart';
import 'package:xentinel/core/session.dart';
import 'package:xentinel/models/xentinel_models.dart';
import 'package:xentinel/providers/alerts_provider.dart';
import 'package:xentinel/repositories/alerts_repository.dart';
import 'package:xentinel/services/alert_events.dart';
import 'package:xentinel/services/api_client.dart';
import 'package:xentinel/services/network_status.dart';
import 'package:xentinel/services/realtime_socket.dart';

import 'support/fakes.dart';

const user = UserEntity(
  id: '7',
  name: 'María Rodríguez',
  documentId: '1007',
  role: UserRole.aprendiz,
  status: AccessStatus.permitido,
);

/// Servidor WebSocket real en 127.0.0.1 que imita `/api/v1/tiempo-real`.
class LocalRealtimeServer {
  late final HttpServer _server;
  final received = <Map<String, dynamic>>[];
  final sockets = <WebSocket>[];
  final _connected = StreamController<WebSocket>.broadcast();
  bool rejectUpgrade = false;

  Stream<WebSocket> get connected => _connected.stream;
  Uri get uri => Uri.parse('ws://127.0.0.1:${_server.port}/api/v1/tiempo-real');

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server.listen((request) async {
      if (rejectUpgrade || !WebSocketTransformer.isUpgradeRequest(request)) {
        request.response.statusCode = 404;
        await request.response.close();
        return;
      }
      final socket = await WebSocketTransformer.upgrade(request);
      sockets.add(socket);
      socket.listen((data) {
        received.add(jsonDecode(data as String) as Map<String, dynamic>);
      });
      _connected.add(socket);
    });
  }

  void send(WebSocket socket, Map<String, Object?> message) =>
      socket.add(jsonEncode(message));

  Future<void> stop() async {
    for (final socket in sockets) {
      await socket.close();
    }
    await _server.close(force: true);
    await _connected.close();
  }
}

/// Transporte simulado para observar el comportamiento del monitor.
class FakeConnection implements EventConnection {
  FakeConnection(this.transport);
  @override
  final String transport;
  final controller = StreamController<ServerEvent>();
  final tokens = <String>[];
  Uri? uri;
  String? cursor;
  bool closed = false;

  @override
  Stream<ServerEvent> connect(Uri uri, String token, String? cursor) {
    this.uri = uri;
    this.cursor = cursor;
    tokens.add(token);
    return controller.stream;
  }

  @override
  void updateToken(String token) => tokens.add(token);

  @override
  Future<void> close() async {
    closed = true;
    if (!controller.isClosed) unawaited(controller.close());
  }
}

void main() {
  group('WebSocketEventConnection', () {
    late LocalRealtimeServer server;
    setUp(() async {
      ServerClock.reset();
      server = LocalRealtimeServer();
      await server.start();
    });
    tearDown(() async {
      await server.stop();
      ServerClock.reset();
    });

    test('authenticates in the first message and maps server events', () async {
      final connection = WebSocketEventConnection();
      final events = <ServerEvent>[];
      final errors = <Object>[];
      final socketFuture = server.connected.first;
      connection
          .connect(server.uri, 'jwt-1', '42')
          .listen(events.add, onError: errors.add);
      final socket = await socketFuture;
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(server.received.first, {
        'tipo': 'auth',
        'token': 'jwt-1',
        'cursor': '42',
      });
      // El token nunca viaja en la URL.
      expect(server.uri.query, isEmpty);

      final serverMs = DateTime.now()
          .add(const Duration(minutes: 3))
          .millisecondsSinceEpoch;
      server.send(socket, {
        'tipo': 'listo',
        'cursor': '42',
        'servidor_ms': serverMs,
      });
      server.send(socket, {
        'tipo': 'change',
        'id': '43',
        'data': {'recurso': 'alertas_emergencia', 'id_evento': '43'},
      });
      server.send(socket, {'tipo': 'checkpoint', 'cursor': '43'});
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(events.map((e) => e.type), ['ready', 'change', 'checkpoint']);
      expect(events[1].id, '43');
      expect(events[1].data['recurso'], 'alertas_emergencia');
      expect(events[2].id, '43');
      // El reloj del servidor llega por el canal y corrige la hora local.
      expect(ServerClock.offset.inSeconds, inInclusiveRange(175, 185));

      connection.updateToken('jwt-2');
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(server.received.last, {'tipo': 'auth', 'token': 'jwt-2'});
      expect(errors, isEmpty);
      await connection.close();
    });

    test('a revoked session closes with 4401 and reports 401', () async {
      final connection = WebSocketEventConnection();
      final socketFuture = server.connected.first;
      final error = Completer<Object>();
      connection
          .connect(server.uri, 'jwt', null)
          .listen((_) {}, onError: error.complete);
      final socket = await socketFuture;
      server.send(socket, {'tipo': 'error', 'code': 'REVOKED_TOKEN'});
      await socket.close(4401);
      final failure = await error.future.timeout(const Duration(seconds: 5));
      expect(
        failure,
        isA<ApiException>().having((e) => e.status, 'status', 401),
      );
      expect((failure as ApiException).code, 'REVOKED_TOKEN');
    });

    test('a server or proxy without WebSocket is reported as such', () async {
      server.rejectUpgrade = true;
      final connection = WebSocketEventConnection();
      final error = Completer<Object>();
      connection
          .connect(server.uri, 'jwt', null)
          .listen((_) {}, onError: error.complete);
      final failure = await error.future.timeout(const Duration(seconds: 5));
      expect(
        failure,
        isA<ApiException>().having((e) => e.code, 'code', 'UPGRADE_REJECTED'),
      );
    });

    test('a silent connection (dead network) is detected and closed', () async {
      final connection = WebSocketEventConnection(
        idleTimeout: const Duration(milliseconds: 200),
      );
      final error = Completer<Object>();
      connection
          .connect(server.uri, 'jwt', null)
          .listen((_) {}, onError: error.complete);
      final failure = await error.future.timeout(const Duration(seconds: 5));
      expect(
        failure,
        isA<ApiException>().having((e) => e.code, 'code', 'TIMEOUT'),
      );
    });

    test('an unreachable server is a network error, not a crash', () async {
      final port = server.uri.port;
      await server.stop();
      final connection = WebSocketEventConnection();
      final error = Completer<Object>();
      connection
          .connect(Uri.parse('ws://127.0.0.1:$port/x'), 'jwt', null)
          .listen((_) {}, onError: error.complete);
      final failure = await error.future.timeout(const Duration(seconds: 5));
      expect(
        failure,
        isA<ApiException>().having((e) => e.code, 'code', 'NETWORK'),
      );
      server = LocalRealtimeServer();
      await server.start();
    });
  });

  group('AlertsMonitor transports', () {
    late SessionStore session;
    late ApiClient api;
    late int alertRequests;
    late FakeConnectivity connectivity;
    late NetworkStatus network;
    late List<FakeConnection> sockets;
    late List<FakeConnection> sse;

    setUp(() async {
      alertRequests = 0;
      session = SessionStore()..signIn(user, 'jwt-1', 900);
      api = ApiClient(
        session,
        baseUrl: 'https://api.example.test/api/v1',
        client: MockClient((request) async {
          alertRequests++;
          return http.Response(jsonEncode({'data': []}), 200);
        }),
      );
      connectivity = FakeConnectivity();
      network = NetworkStatus(connectivity);
      sockets = [];
      sse = [];
      await Future<void>.delayed(Duration.zero);
    });
    tearDown(() {
      api.close();
      network.dispose();
      session.dispose();
    });

    AlertsMonitor monitor() => AlertsMonitor(
      AlertsRepository(api),
      session,
      network: network,
      pollInterval: const Duration(minutes: 5),
      livePollInterval: const Duration(minutes: 5),
      realtimeUri: () => Uri.parse('wss://api.example.test/api/v1/tiempo-real'),
      webSocket: () {
        final connection = FakeConnection('WebSocket');
        sockets.add(connection);
        return connection;
      },
      sse: () {
        final connection = FakeConnection('SSE');
        sse.add(connection);
        return connection;
      },
    );

    test(
      'WebSocket is the primary channel and change events refresh alerts',
      () async {
        final alerts = monitor()..setActive(true);
        addTearDown(alerts.dispose);
        await Future<void>.delayed(Duration.zero);
        expect(sockets, hasLength(1));
        expect(
          sockets.single.uri.toString(),
          'wss://api.example.test/api/v1/tiempo-real',
        );
        expect(sse, isEmpty);
        final before = alertRequests;
        sockets.single.controller.add(const ServerEvent('ready', {}, '10'));
        sockets.single.controller.add(
          const ServerEvent('change', {'recurso': 'alertas_emergencia'}, '11'),
        );
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(alerts.connected, isTrue);
        expect(alerts.transport, 'WebSocket');
        expect(alerts.linkState, LinkState.live);
        expect(alertRequests, greaterThan(before));
      },
    );

    test(
      'renewed token reaches the open socket without reconnecting',
      () async {
        final alerts = monitor()..setActive(true);
        addTearDown(alerts.dispose);
        await Future<void>.delayed(Duration.zero);
        session.renew('jwt-2', 900);
        expect(sockets.single.tokens, ['jwt-1', 'jwt-2']);
        expect(sockets, hasLength(1));
        expect(sockets.single.closed, isFalse);
      },
    );

    test('blocked WebSocket falls back to SSE with the same cursor', () async {
      final alerts = monitor()..setActive(true);
      addTearDown(alerts.dispose);
      await Future<void>.delayed(Duration.zero);
      sockets.single.controller.add(const ServerEvent('ready', {}, '25'));
      await Future<void>.delayed(Duration.zero);
      sockets.single.controller.addError(
        const ApiException('UPGRADE_REJECTED', 'proxy', status: 400),
      );
      // Reintento con espera de ~1 s.
      await Future<void>.delayed(const Duration(milliseconds: 1700));
      expect(sse, hasLength(1));
      expect(sse.single.uri?.path, '/api/v1/eventos');
      expect(sse.single.cursor, '25');
    });

    test(
      'losing the network stops retries; recovering reconnects at once',
      () async {
        final alerts = monitor()..setActive(true);
        addTearDown(alerts.dispose);
        await Future<void>.delayed(Duration.zero);
        connectivity.set(false);
        await Future<void>.delayed(Duration.zero);
        expect(alerts.linkState, LinkState.offline);
        expect(sockets.single.closed, isTrue);
        final requestsWhileOffline = alertRequests;
        await Future<void>.delayed(const Duration(milliseconds: 1500));
        expect(sockets, hasLength(1), reason: 'sin red no se reintenta');
        expect(alertRequests, requestsWhileOffline);
        connectivity.set(true);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(sockets, hasLength(2));
        expect(alertRequests, greaterThan(requestsWhileOffline));
      },
    );

    test(
      'auth-expired from a channel opened before renewal reconnects',
      () async {
        final alerts = monitor()..setActive(true);
        addTearDown(alerts.dispose);
        await Future<void>.delayed(Duration.zero);
        session.renew('jwt-2', 900);
        sockets.single.controller.add(
          const ServerEvent('auth-expired', {}, null),
        );
        await Future<void>.delayed(Duration.zero);
        expect(
          session.token,
          'jwt-2',
          reason: 'la sesión renovada sigue vigente',
        );
        expect(sockets, hasLength(2));
        expect(sockets.last.tokens.first, 'jwt-2');
      },
    );
  });
}

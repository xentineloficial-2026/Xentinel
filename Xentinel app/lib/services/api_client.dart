import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../core/api_config.dart';
import '../core/server_clock.dart';
import '../core/session.dart';

class ApiClient {
  ApiClient(
    this.session, {
    http.Client? client,
    this.baseUrl,
    this.timeout = ApiConfig.requestTimeout,
  }) : _client = client ?? http.Client();
  final SessionStore session;
  final http.Client _client;

  /// Sin valor explícito se usa el servidor vigente de [ApiConfig].
  final String? baseUrl;
  final Duration timeout;
  Uri uri(String path) => ApiConfig.endpoint(path, base: baseUrl);

  Future<Object?> request(
    String path, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
  }) async {
    final token = session.token;
    if (authenticated && token == null) {
      throw const ApiException(
        'UNAUTHORIZED',
        'Inicia sesión para continuar.',
        status: 401,
      );
    }
    final abort = Completer<void>();
    final request =
        http.AbortableRequest(method, uri(path), abortTrigger: abort.future)
          ..followRedirects = false
          ..headers.addAll({
            'Accept': 'application/json',
            if (authenticated) 'Authorization': 'Bearer $token',
          });
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    try {
      final response = await (() async => http.Response.fromStream(
        await _client.send(request),
      ))().timeout(timeout);
      ServerClock.syncFromHeader(response.headers['date']);
      if (response.statusCode == 401 &&
          authenticated &&
          session.token == token) {
        session.expire();
      }
      Object? decoded;
      try {
        decoded = response.body.isEmpty
            ? null
            : jsonDecode(utf8.decode(response.bodyBytes));
      } on FormatException {
        throw ApiException(
          'INVALID_RESPONSE',
          'El servidor devolvió una respuesta inválida.',
          status: response.statusCode,
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final error = decoded is Map ? decoded['error'] : null;
        throw ApiException(
          error is Map ? '${error['code'] ?? 'HTTP_ERROR'}' : 'HTTP_ERROR',
          response.statusCode == 401
              ? 'Tu sesión venció o las credenciales son incorrectas.'
              : response.statusCode == 429
              ? 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.'
              : error is Map && error['message'] is String
              ? error['message'] as String
              : 'No se pudo completar la solicitud. Intenta nuevamente.',
          status: response.statusCode,
        );
      }
      if (response.statusCode == 204) return null;
      if (decoded is! Map || !decoded.containsKey('data')) {
        throw const ApiException(
          'INVALID_RESPONSE',
          'El servidor no es compatible con esta versión de Xentinel.',
        );
      }
      return decoded['data'];
    } on TimeoutException {
      throw const ApiException(
        'TIMEOUT',
        'El servidor tardó demasiado en responder. Revisa tu conexión.',
      );
    } on http.ClientException {
      throw const ApiException(
        'NETWORK',
        'No se pudo conectar con Xentinel. Revisa tu conexión a internet.',
      );
    } finally {
      if (!abort.isCompleted) abort.complete();
    }
  }

  void close() => _client.close();
}

final apiClientProvider = Provider<ApiClient>((ref) {
  final api = ApiClient(ref.read(sessionProvider));
  ref.onDispose(api.close);
  return api;
});

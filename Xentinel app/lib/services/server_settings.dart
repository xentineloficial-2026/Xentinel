import 'dart:async';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_config.dart';

/// Dirección del servidor en el dispositivo. No es un secreto: no se guardan
/// credenciales ni tokens aquí.
class ServerSettings {
  static const _key = 'xentinel_server_url';

  /// Un fallo del almacenamiento nunca impide abrir la app: queda el servidor compilado.
  static Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      ApiConfig.useBaseUrl(prefs.getString(_key));
    } catch (_) {}
  }

  static Future<void> save(String baseUrl) async {
    ApiConfig.useBaseUrl(baseUrl);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, baseUrl);
    } catch (_) {}
  }

  /// Devuelve null si responde la API de Xentinel; si no, el motivo para mostrarlo.
  /// `/eventos` sin token debe contestar 401 en JSON: confirma API sin iniciar sesión.
  static Future<String?> check(String baseUrl, {http.Client? client}) async {
    final Uri uri;
    try {
      uri = ApiConfig.endpoint('eventos', base: baseUrl);
    } on ApiException {
      return 'Esta versión de la app solo admite direcciones https://.';
    }
    final httpClient = client ?? http.Client();
    try {
      final request = http.Request('GET', uri)
        ..followRedirects = false
        ..headers['Accept'] = 'application/json';
      final response = await httpClient
          .send(request)
          .timeout(const Duration(seconds: 6));
      unawaited(response.stream.drain<void>().catchError((Object _) {}));
      final isJson = (response.headers['content-type'] ?? '').contains('json');
      if (response.statusCode == 401 && isJson) return null;
      if (response.statusCode >= 300 && response.statusCode < 400) {
        return 'El servidor pide iniciar sesión en el navegador. Si es un túnel, márcalo como público.';
      }
      return 'Ese servidor respondió, pero no parece ser Xentinel (${response.statusCode}).';
    } catch (_) {
      return 'No hay respuesta. Revisa la dirección, la red Wi-Fi y que el servidor esté encendido.';
    } finally {
      if (client == null) httpClient.close();
    }
  }
}

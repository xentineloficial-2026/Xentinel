import 'package:flutter/foundation.dart';

/// Dirección del servidor de Xentinel.
///
/// Por defecto la app usa la API de producción en Render, alcanzable por HTTPS/WSS en
/// el puerto 443 desde cualquier red (datos móviles, otra Wi‑Fi o la red de la sede):
/// ningún teléfono depende de la IP local de una computadora ni de abrir puertos.
/// `--dart-define=API_BASE_URL=...` la reemplaza en compilaciones de desarrollo.
class ApiConfig {
  static const productionBaseUrl = 'https://xentinel-api.onrender.com/api/v1';
  static const compiledBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: productionBaseUrl,
  );
  static const allowInsecureHttp = bool.fromEnvironment('ALLOW_INSECURE_HTTP');
  static const requestTimeout = Duration(seconds: 15);

  static String? _savedBaseUrl;

  /// Una compilación con servidor HTTPS es la versión definitiva: funciona en
  /// cualquier red sin configurar nada, y una IP vieja guardada en el teléfono
  /// nunca puede reemplazar a ese servidor.
  static bool get hasFixedServer =>
      compiledBaseUrl.startsWith('https://') && !allowInsecureHttp;

  /// Solo las compilaciones de desarrollo permiten escribir otro servidor (por
  /// ejemplo, el Backend de una computadora en la red local). Una versión de
  /// producción sin servidor HTTPS compilado también lo permite, pero solo acepta
  /// direcciones `https://`, nunca IP locales ni puertos HTTP.
  static bool get allowServerOverride => !hasFixedServer;

  /// El de compilación si es definitivo; si no, el guardado en el dispositivo.
  static String get baseUrl =>
      hasFixedServer ? compiledBaseUrl : (_savedBaseUrl ?? compiledBaseUrl);

  static void useBaseUrl(String? value) => _savedBaseUrl = value;

  /// Convierte `192.168.1.40:8000` o `https://host` en la URL completa de la API.
  static String? normalizeServer(String input) {
    var value = input.trim().replaceFirst(RegExp(r'/+$'), '');
    if (value.isEmpty) return null;
    if (!value.contains('://')) {
      // Un dominio público se asume HTTPS; solo una IP o `host:puerto` de
      // desarrollo se asume HTTP.
      final looksLocal = RegExp(
        r'^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?$',
      ).hasMatch(value);
      value = '${looksLocal ? 'http' : 'https'}://$value';
    }
    if (!value.endsWith('/api/v1')) value = '$value/api/v1';
    final uri = Uri.tryParse(value);
    return uri == null || !uri.hasAuthority || uri.host.isEmpty ? null : value;
  }

  static bool _allowedScheme(Uri uri) =>
      uri.scheme == 'https' ||
      (uri.scheme == 'http' && !kReleaseMode && allowInsecureHttp);

  static Uri endpoint(String path, {String? base}) {
    final root = base ?? baseUrl;
    final uri = Uri.tryParse(root);
    if (uri == null ||
        !uri.hasAuthority ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        !_allowedScheme(uri)) {
      throw const ApiException(
        'CONFIGURATION',
        'El servidor de Xentinel no está configurado. Contacta al administrador.',
      );
    }
    return Uri.parse('${root.replaceFirst(RegExp(r'/+$'), '')}/$path');
  }

  /// Canal en tiempo real: `wss://` sobre el mismo dominio y puerto que la API.
  static Uri realtimeEndpoint({String? base}) {
    final http = endpoint('tiempo-real', base: base);
    return http.replace(scheme: http.scheme == 'https' ? 'wss' : 'ws');
  }
}

class ApiException implements Exception {
  const ApiException(this.code, this.message, {this.status});
  final String code;
  final String message;
  final int? status;

  /// Sin respuesta del servidor: el resultado de una escritura es desconocido.
  bool get isConnectivity => code == 'NETWORK' || code == 'TIMEOUT';

  @override
  String toString() => message;
}

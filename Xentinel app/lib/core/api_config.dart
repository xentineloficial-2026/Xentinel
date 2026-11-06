import 'package:flutter/foundation.dart';

class ApiConfig {
  static const compiledBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const allowInsecureHttp = bool.fromEnvironment('ALLOW_INSECURE_HTTP');
  static const requestTimeout = Duration(seconds: 15);

  static String? _savedBaseUrl;

  /// Una compilación con servidor HTTPS es la versión definitiva: funciona en
  /// cualquier red sin configurar nada, y una IP vieja guardada en el teléfono
  /// nunca puede reemplazar a ese servidor.
  static bool get hasFixedServer =>
      compiledBaseUrl.startsWith('https://') && !allowInsecureHttp;

  /// El de compilación si es definitivo; si no, el guardado en el dispositivo.
  static String get baseUrl =>
      hasFixedServer ? compiledBaseUrl : (_savedBaseUrl ?? compiledBaseUrl);

  static void useBaseUrl(String? value) => _savedBaseUrl = value;

  /// Convierte `192.168.1.40:8000` o `https://host` en la URL completa de la API.
  static String? normalizeServer(String input) {
    var value = input.trim().replaceFirst(RegExp(r'/+$'), '');
    if (value.isEmpty) return null;
    if (!value.contains('://')) value = 'http://$value';
    if (!value.endsWith('/api/v1')) value = '$value/api/v1';
    final uri = Uri.tryParse(value);
    return uri == null || !uri.hasAuthority || uri.host.isEmpty ? null : value;
  }

  static Uri endpoint(String path, {String? base}) {
    final root = base ?? baseUrl;
    final uri = Uri.tryParse(root);
    if (uri == null ||
        !uri.hasAuthority ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        (uri.scheme != 'https' &&
            !(uri.scheme == 'http' && !kReleaseMode && allowInsecureHttp))) {
      throw const ApiException(
        'CONFIGURATION',
        'El servidor de Xentinel no está configurado. Contacta al administrador.',
      );
    }
    return Uri.parse('${root.replaceFirst(RegExp(r'/+$'), '')}/$path');
  }
}

class ApiException implements Exception {
  const ApiException(this.code, this.message, {this.status});
  final String code;
  final String message;
  final int? status;
  @override
  String toString() => message;
}

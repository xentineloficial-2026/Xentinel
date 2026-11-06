import 'api_config.dart';

/// Convierte cualquier error en un mensaje legible para el usuario.
String describeError(Object error) {
  if (error is ApiException) return error.message;
  if (error is FormatException) {
    return 'La respuesta del servidor no es válida. Intenta nuevamente.';
  }
  return 'No se pudo completar la operación. Revisa tu conexión e intenta de nuevo.';
}

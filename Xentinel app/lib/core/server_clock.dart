import 'dart:io' show HttpDate, HttpException;

/// Hora de referencia compartida: la del servidor.
///
/// El QR lleva una marca de tiempo que se genera en un teléfono y se valida en
/// otro. Si cada uno usara su propio reloj, una diferencia de un minuto entre
/// ambos bastaría para rechazar un carnet válido.
class ServerClock {
  ServerClock._();

  static Duration _offset = Duration.zero;

  /// Hora actual corregida con la última respuesta del servidor.
  static DateTime now() => DateTime.now().add(_offset);

  /// Ajusta la diferencia con la cabecera `Date` de una respuesta HTTP.
  /// Una cabecera ausente o inválida conserva el ajuste anterior.
  static void syncFromHeader(String? date, {DateTime? receivedAt}) {
    if (date == null) return;
    try {
      _offset = HttpDate.parse(date).difference(receivedAt ?? DateTime.now());
    } on FormatException {
      // El reloj es una mejora de precisión: nunca debe interrumpir una solicitud.
    } on HttpException {
      // Igual que arriba, para las variantes que lanza `HttpDate.parse`.
    }
  }

  /// Solo para pruebas.
  static void reset() => _offset = Duration.zero;
}

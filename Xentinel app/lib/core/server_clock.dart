import 'dart:io' show HttpDate, HttpException;

import 'package:shared_preferences/shared_preferences.dart';

/// Hora de referencia compartida: la del servidor.
///
/// El QR lleva una marca de tiempo que se genera en un teléfono y se valida en
/// otro (o en el servidor). Si cada uno usara su propio reloj, una diferencia de
/// un minuto entre ambos bastaría para rechazar un carnet válido. El ajuste se
/// guarda para que el carnet sin conexión use la última hora conocida del servidor.
class ServerClock {
  ServerClock._();

  static const _key = 'xentinel_server_clock_offset_ms';
  static Duration _offset = Duration.zero;
  static Duration? _bestRoundTrip;
  static Duration? _lastSaved;

  /// Hora actual corregida con la última respuesta del servidor.
  static DateTime now() => DateTime.now().add(_offset);

  static Duration get offset => _offset;

  /// Recupera el último ajuste conocido. Un fallo de almacenamiento conserva cero.
  static Future<void> load() async {
    try {
      final saved = (await SharedPreferences.getInstance()).getInt(_key);
      // Un ajuste mayor a un día no es un desfase de reloj sino un dato corrupto.
      if (saved != null && saved.abs() < 86400000) {
        _offset = Duration(milliseconds: saved);
      }
    } catch (_) {}
  }

  /// Ajusta la diferencia con la cabecera `Date` de una respuesta HTTP.
  /// Una cabecera ausente o inválida conserva el ajuste anterior.
  static void syncFromHeader(String? date, {DateTime? receivedAt}) {
    if (date == null) return;
    try {
      // `Date` tiene resolución de un segundo: solo corrige desfases mayores, para
      // no deshacer un ajuste preciso obtenido del canal en tiempo real.
      final measured = HttpDate.parse(
        date,
      ).difference(receivedAt ?? DateTime.now());
      if ((measured - _offset).inMilliseconds.abs() >= 1500 ||
          _bestRoundTrip == null) {
        _apply(measured);
      }
    } on FormatException {
      // El reloj es una mejora de precisión: nunca debe interrumpir una solicitud.
    } on HttpException {
      // Igual que arriba, para las variantes que lanza `HttpDate.parse`.
    }
  }

  /// Ajuste preciso a partir de `servidor_ms` (canal en tiempo real), corrigiendo la
  /// mitad del tiempo de ida y vuelta cuando se conoce.
  static void syncFromMillis(
    int serverMillis, {
    DateTime? sentAt,
    DateTime? receivedAt,
  }) {
    final received = receivedAt ?? DateTime.now();
    final roundTrip = sentAt == null ? null : received.difference(sentAt);
    if (roundTrip != null && roundTrip.isNegative) return;
    // Prefiere las mediciones con menor latencia; caducan si cambia mucho el ajuste.
    if (roundTrip != null &&
        _bestRoundTrip != null &&
        roundTrip > _bestRoundTrip! * 2 &&
        roundTrip > const Duration(milliseconds: 400)) {
      return;
    }
    final midpoint = roundTrip == null
        ? received
        : received.subtract(roundTrip ~/ 2);
    _apply(
      DateTime.fromMillisecondsSinceEpoch(serverMillis).difference(midpoint),
    );
    if (roundTrip != null &&
        (_bestRoundTrip == null || roundTrip < _bestRoundTrip!)) {
      _bestRoundTrip = roundTrip;
    }
  }

  static void _apply(Duration value) {
    _offset = value;
    if (_lastSaved == null ||
        (value - _lastSaved!).inMilliseconds.abs() >= 1000) {
      _lastSaved = value;
      SharedPreferences.getInstance()
          .then((prefs) => prefs.setInt(_key, value.inMilliseconds))
          .ignore();
    }
  }

  /// Solo para pruebas.
  static void reset() {
    _offset = Duration.zero;
    _bestRoundTrip = null;
    _lastSaved = null;
  }
}

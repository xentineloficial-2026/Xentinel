import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Formatos de QR que reconoce Xentinel.
enum QrKind {
  /// Carnet rotativo firmado `XN2:<id>:<paso>:<firma>`; lo verifica el servidor.
  signed,

  /// Carnet heredado de la app `XENTINEL:<id>:<timestamp>` (sin firma).
  legacyApp,

  /// Identificación de la web `{"sistema":"Xentinel","version":1,"id_usuarios":id}`.
  legacyWeb,
}

class ScannedCode {
  const ScannedCode({
    required this.kind,
    required this.userId,
    required this.raw,
    this.step,
    this.timestampMs,
  });
  final QrKind kind;
  final int userId;
  final String raw;

  /// Paso de 15 s del carnet firmado.
  final int? step;

  /// Marca de tiempo del carnet heredado de la app.
  final int? timestampMs;
}

/// Carnet QR firmado XN2. Debe coincidir exactamente con `credenciales.py` del
/// Backend: `firma = Base32(HMAC-SHA256(clave, "XN2:<id>:<paso>"))[0:20]`.
///
/// Solo usa dígitos, letras mayúsculas y `:`, que pertenecen al modo alfanumérico de
/// QR: el código ocupa una versión 3 (29×29 módulos) aun con corrección Q (25 %).
/// Módulos grandes y redundancia alta es lo que hace fiable leerlo de una pantalla
/// con otro teléfono (reflejos, moiré, enfoque cercano).
class XentinelQr {
  XentinelQr._();

  static const prefix = 'XN2';
  static const stepSeconds = 15;
  static const maxLength = 400;
  static final _signed = RegExp(
    r'^XN2:([1-9]\d{0,9}):(\d{1,12}):([A-Z2-7]{20})$',
  );
  static const _base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  static int stepAt(DateTime time, {int seconds = stepSeconds}) =>
      time.millisecondsSinceEpoch ~/ (seconds * 1000);

  /// Inicio del siguiente paso: el carnet se renueva justo en el borde.
  static DateTime nextStepAt(DateTime time, {int seconds = stepSeconds}) =>
      DateTime.fromMillisecondsSinceEpoch(
        (stepAt(time, seconds: seconds) + 1) * seconds * 1000,
      );

  static String sign(List<int> key, int userId, int step) {
    final mac = Hmac(sha256, key).convert(utf8.encode('$prefix:$userId:$step'));
    return base32(mac.bytes).substring(0, 20);
  }

  static String generate(List<int> key, int userId, int step) =>
      '$prefix:$userId:$step:${sign(key, userId, step)}';

  static String base32(List<int> bytes) {
    final out = StringBuffer();
    var buffer = 0;
    var bits = 0;
    for (final byte in bytes) {
      buffer = ((buffer << 8) | (byte & 0xff)) & 0xffff;
      bits += 8;
      while (bits >= 5) {
        out.write(_base32[(buffer >> (bits - 5)) & 31]);
        bits -= 5;
      }
    }
    if (bits > 0) out.write(_base32[(buffer << (5 - bits)) & 31]);
    return out.toString();
  }

  /// Clave Base64URL sin relleno, tal como la entrega el servidor.
  static Uint8List decodeKey(String encoded) =>
      base64Url.decode(base64Url.normalize(encoded));

  /// Reconoce el carnet firmado, el heredado de la app y la identificación web.
  static ScannedCode? parse(String payload) {
    final text = payload.trim();
    if (text.isEmpty || text.length > maxLength) return null;
    final signed = _signed.firstMatch(text);
    if (signed != null) {
      final id = int.parse(signed.group(1)!);
      if (id > 2147483647) return null;
      return ScannedCode(
        kind: QrKind.signed,
        userId: id,
        raw: text,
        step: int.parse(signed.group(2)!),
      );
    }
    if (text.startsWith('{')) {
      try {
        final data = jsonDecode(text);
        if (data is Map &&
            data['sistema'] == 'Xentinel' &&
            data['version'] == 1 &&
            data['id_usuarios'] is int) {
          final id = data['id_usuarios'] as int;
          if (id <= 0 || id > 2147483647) return null;
          return ScannedCode(kind: QrKind.legacyWeb, userId: id, raw: text);
        }
      } on FormatException {
        return null;
      }
      return null;
    }
    final parts = text.split(':');
    if (parts.length != 3 || parts[0] != 'XENTINEL') return null;
    final id = int.tryParse(parts[1]);
    final timestamp = int.tryParse(parts[2]);
    if (id == null || id <= 0 || id > 2147483647) return null;
    if (timestamp == null || timestamp <= 0) return null;
    return ScannedCode(
      kind: QrKind.legacyApp,
      userId: id,
      raw: text,
      timestampMs: timestamp,
    );
  }
}

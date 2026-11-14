import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:xentinel/core/qr_codes.dart';
import 'package:xentinel/screens/carnet_screen.dart';

void main() {
  // Vectores generados con `xentinel/credenciales.py` del Backend: si alguno
  // cambia, el servidor dejaría de aceptar los carnets de la app.
  final key = List<int>.generate(32, (i) => i);

  test('signed carnet matches the server implementation byte for byte', () {
    expect(
      XentinelQr.generate(key, 51, 119000000),
      'XN2:51:119000000:34LXQRURWYGRTV45BUWW',
    );
    expect(
      XentinelQr.generate(key, 2147483647, 0),
      'XN2:2147483647:0:CKLY4K6W4NT327M73VND',
    );
    expect(
      XentinelQr.decodeKey('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'),
      key,
    );
  });

  test('base32 follows RFC 4648 without padding', () {
    expect(XentinelQr.base32('foobar'.codeUnits), 'MZXW6YTBOI');
    expect(XentinelQr.base32('f'.codeUnits), 'MY');
    expect(XentinelQr.base32(const []), '');
  });

  test('steps rotate every 15 s on the server clock boundary', () {
    final time = DateTime.fromMillisecondsSinceEpoch(119000000 * 15000 + 14999);
    expect(XentinelQr.stepAt(time), 119000000);
    expect(
      XentinelQr.nextStepAt(time).millisecondsSinceEpoch,
      119000001 * 15000,
    );
  });

  test('parser recognizes the three formats and rejects lookalikes', () {
    final signed = XentinelQr.parse(' XN2:51:119000000:34LXQRURWYGRTV45BUWW ');
    expect(signed?.kind, QrKind.signed);
    expect(signed?.userId, 51);
    expect(signed?.step, 119000000);
    expect(
      XentinelQr.parse('XENTINEL:7:1790000000000')?.kind,
      QrKind.legacyApp,
    );
    expect(
      XentinelQr.parse(
        '{"sistema":"Xentinel","version":1,"id_usuarios":7}',
      )?.kind,
      QrKind.legacyWeb,
    );
    for (final invalid in [
      'XN2:0:1:34LXQRURWYGRTV45BUWW',
      'XN2:51:1:34lxqrurwygrtv45buww',
      'XN2:51:1:34LXQRURWYGRTV45BUW',
      'XN2:9999999999:1:34LXQRURWYGRTV45BUWW',
      'XENTINEL:7',
      'https://example.com',
      'A' * 401,
    ]) {
      expect(XentinelQr.parse(invalid), isNull, reason: invalid);
    }
  });

  test('carnet QR is a large, high-redundancy version 3 code', () {
    final qr = buildCarnetQr(XentinelQr.generate(key, 51, 119000000));
    expect(qr.typeNumber, 3, reason: '29×29 módulos');
    expect(qr.errorCorrectLevel, QrErrorCorrectLevel.Q);
    // Peor caso: identificador de 10 dígitos.
    expect(
      buildCarnetQr(XentinelQr.generate(key, 2147483647, 999999999)).typeNumber,
      lessThanOrEqualTo(4),
    );
    // Contenido no alfanumérico (identificación web) sigue funcionando.
    expect(
      buildCarnetQr(
        '{"sistema":"Xentinel","version":1,"id_usuarios":7}',
      ).errorCorrectLevel,
      QrErrorCorrectLevel.Q,
    );
  });
}

/// Semáforo de Xentinel, igual en la API y en la web: rojo (crítico o alto) y
/// amarillo (advertencia). El verde es normal y nunca se muestra como alarma.
enum Semaforo {
  rojo('Rojo', 'Críticas', 'Actúa ahora'),
  amarillo('Amarillo', 'Advertencias', 'Revisa pronto');

  const Semaforo(this.label, this.plural, this.guidance);
  final String label;
  final String plural;
  final String guidance;

  static Semaforo? fromApi(Object? value) => switch (value) {
    'rojo' => Semaforo.rojo,
    'amarillo' => Semaforo.amarillo,
    _ => null,
  };
}

/// Alarma por escaneo: un carnet QR vencido (amarillo) o que no es verídico (rojo).
/// Solo la reciben el personal de control y la administración.
class ScanAlarm {
  const ScanAlarm({
    required this.id,
    required this.semaforo,
    required this.title,
    required this.detail,
    required this.at,
    this.exit = false,
    this.holder,
    this.claimedId,
    this.scannedBy,
  });

  final int id;
  final Semaforo semaforo;
  final String title;
  final String detail;
  final DateTime at;

  /// El escaneo era de SALIDA (ENTRADA si es `false`).
  final bool exit;

  /// Titular comprobado por la firma (carnet auténtico pero vencido).
  final String? holder;

  /// Lo que el código dice ser, sin verificar.
  final int? claimedId;
  final String? scannedBy;

  /// Elemento de `GET /alarmas` con `origen: "qr"`.
  static ScanAlarm? fromApi(Object? data) {
    if (data is! Map || data['origen'] != 'qr') return null;
    final id = data['id_alarma'];
    final color = Semaforo.fromApi(data['semaforo']);
    final at = DateTime.tryParse('${data['fecha']}');
    if (id is! int || color == null || at == null) return null;
    return ScanAlarm(
      id: id,
      semaforo: color,
      title: data['titulo'] is String
          ? data['titulo'] as String
          : 'Carnet QR por revisar',
      detail: data['detalle'] is String ? data['detalle'] as String : '',
      at: at,
      exit: data['tipo_movimiento'] == 'SALIDA',
      holder: data['titular'] as String?,
      claimedId: data['id_reclamado'] is int
          ? data['id_reclamado'] as int
          : null,
      scannedBy: data['registrado_por'] as String?,
    );
  }
}

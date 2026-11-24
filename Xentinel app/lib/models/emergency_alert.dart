import 'scan_alarm.dart';

enum AlertSeverity { informativa, moderada, alta, critica }

class EmergencyAlert {
  const EmergencyAlert({
    required this.id,
    required this.type,
    required this.message,
    required this.severity,
    required this.startedAt,
    required this.source,
  });
  final int id;
  final String type;
  final String message;
  final AlertSeverity severity;
  final DateTime startedAt;
  final String source;

  String get fingerprint => '$id|$type|$message|${severity.name}|$source';

  /// Color del semáforo; `null` para la informativa (verde), que no es alarma.
  Semaforo? get semaforo => switch (severity) {
    AlertSeverity.critica || AlertSeverity.alta => Semaforo.rojo,
    AlertSeverity.moderada => Semaforo.amarillo,
    AlertSeverity.informativa => null,
  };

  /// Simulacro de la API de gestión de riesgos o publicado como simulacro.
  bool get isDrill =>
      source == 'PRUEBA' || type.toLowerCase().contains('simulacro');
  String get severityLabel => switch (severity) {
    AlertSeverity.informativa => 'INFORMATIVA',
    AlertSeverity.moderada => 'AMARILLA (MODERADA)',
    AlertSeverity.alta => 'ROJA (ALTA)',
    AlertSeverity.critica => 'ROJA (CRÍTICA)',
  };

  factory EmergencyAlert.fromApi(Map<String, dynamic> data) {
    final id = data['id_alerta'];
    final date = DateTime.tryParse('${data['fecha_inicio']}');
    if (id is! int ||
        id <= 0 ||
        data['tipo_alerta'] is! String ||
        date == null ||
        data['mensaje'] is! String ||
        data['activa'] is! bool) {
      throw const FormatException('Alerta inválida');
    }
    // Older alerts may not carry severity. Never silently downgrade an
    // unknown server severity to an informational message.
    final severity =
        AlertSeverity.values
            .where((v) => v.name == data['severidad'])
            .firstOrNull ??
        AlertSeverity.alta;
    return EmergencyAlert(
      id: id,
      type: data['tipo_alerta'] as String,
      message: data['mensaje'] as String,
      severity: severity,
      startedAt: date,
      source: data['fuente'] is String
          ? data['fuente'] as String
          : 'Centro de control Xentinel',
    );
  }
}

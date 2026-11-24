import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/emergency_alert.dart';
import '../models/scan_alarm.dart';
import '../services/api_client.dart';

class AlertsRepository {
  AlertsRepository(this.api);
  final ApiClient api;

  /// Alertas activas de riesgo en rojo o amarillo. La informativa (verde) es un
  /// evento normal: la API ya la omite y aquí tampoco se muestra.
  Future<List<EmergencyAlert>> fetchActive() async {
    final data = await api.request('alertas/activas');
    if (data is! List) throw const FormatException('Lista de alertas inválida');
    final alerts = <EmergencyAlert>[];
    for (final row in data) {
      if (row is! Map) throw const FormatException('Alerta inválida');
      final alert = EmergencyAlert.fromApi(Map<String, dynamic>.from(row));
      if (row['activa'] == true && alert.semaforo != null) alerts.add(alert);
    }
    alerts.sort((a, b) {
      final severity = b.severity.index.compareTo(a.severity.index);
      return severity != 0 ? severity : b.startedAt.compareTo(a.startedAt);
    });
    return List.unmodifiable(alerts);
  }

  /// Alarmas de escaneo pendientes (carnets QR vencidos o que no son verídicos).
  Future<List<ScanAlarm>> fetchScanAlarms() async {
    final data = await api.request('alarmas');
    if (data is! List) throw const FormatException('Lista de alarmas inválida');
    final alarms = data.map(ScanAlarm.fromApi).whereType<ScanAlarm>().toList()
      ..sort((a, b) {
        final color = a.semaforo.index.compareTo(b.semaforo.index);
        return color != 0 ? color : b.at.compareTo(a.at);
      });
    return List.unmodifiable(alarms);
  }

  /// Marca la alarma como revisada: sale de pendientes y conserva su historial.
  Future<void> attendScanAlarm(int id) =>
      api.request('alarmas/qr/$id/atender', method: 'PATCH');
}

final alertsRepositoryProvider = Provider<AlertsRepository>(
  (ref) => AlertsRepository(ref.watch(apiClientProvider)),
);

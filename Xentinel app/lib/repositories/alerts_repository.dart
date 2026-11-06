import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/emergency_alert.dart';
import '../services/api_client.dart';

class AlertsRepository {
  AlertsRepository(this.api);
  final ApiClient api;

  Future<List<EmergencyAlert>> fetchActive() async {
    final data = await api.request('alertas/activas');
    if (data is! List) throw const FormatException('Lista de alertas inválida');
    final alerts = <EmergencyAlert>[];
    for (final row in data) {
      if (row is! Map) throw const FormatException('Alerta inválida');
      final alert = EmergencyAlert.fromApi(Map<String, dynamic>.from(row));
      if (row['activa'] == true) alerts.add(alert);
    }
    alerts.sort((a, b) {
      final severity = b.severity.index.compareTo(a.severity.index);
      return severity != 0 ? severity : b.startedAt.compareTo(a.startedAt);
    });
    return List.unmodifiable(alerts);
  }
}

final alertsRepositoryProvider = Provider<AlertsRepository>(
  (ref) => AlertsRepository(ref.watch(apiClientProvider)),
);

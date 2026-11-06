import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../components/emergency_card.dart';
import '../components/xentinel_brand.dart';
import '../core/theme.dart';
import '../providers/alerts_provider.dart';

class AlertsScreen extends ConsumerWidget {
  const AlertsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final monitor = ref.watch(alertsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Alertas de emergencia'),
        actions: [
          IconButton(
            tooltip: 'Actualizar alertas',
            onPressed: monitor.loading ? null : monitor.refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: monitor.refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Tu seguridad, primero',
              style: Theme.of(context).textTheme.headlineLarge,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(
                  Icons.circle,
                  size: 8,
                  color: monitor.connected
                      ? XentinelTheme.success
                      : XentinelTheme.steel,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    monitor.connected
                        ? 'Conectado a las alertas en tiempo real'
                        : 'Consultando actualizaciones del centro de control',
                    style: const TextStyle(color: XentinelTheme.steel),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            if (monitor.error != null) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: XentinelTheme.surface,
                  borderRadius: BorderRadius.circular(XentinelTheme.radiusM),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.wifi_off, color: XentinelTheme.warning),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        '${monitor.error}\nNo podemos confirmar el estado actual de las emergencias.',
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],
            if (monitor.loading && monitor.lastUpdated == null)
              const Center(child: CircularProgressIndicator()),
            if (!monitor.loading &&
                monitor.lastUpdated != null &&
                monitor.error == null &&
                monitor.alerts.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Column(
                  children: [
                    XentinelLogo(size: 64),
                    SizedBox(height: 20),
                    Text(
                      'No hay alertas activas',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    SizedBox(height: 6),
                    Text(
                      'Según la última consulta al centro de control.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: XentinelTheme.steel),
                    ),
                  ],
                ),
              ),
            for (final alert in monitor.alerts)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: EmergencyCard(alert: alert),
              ),
            if (monitor.lastUpdated case final DateTime time)
              Text(
                'Última consulta: ${TimeOfDay.fromDateTime(time).format(context)}',
                style: XentinelTheme.mono,
              ),
            const SizedBox(height: 24),
            const Text(
              'Mantén la app abierta para recibir actualizaciones. Sigue las indicaciones del personal de emergencia.',
              style: TextStyle(color: XentinelTheme.steel, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}

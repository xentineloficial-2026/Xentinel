import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../components/emergency_card.dart';
import '../components/xentinel_brand.dart';
import '../core/theme.dart';
import '../providers/alerts_provider.dart';
import '../services/seismic_alerts.dart';

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
            if (SeismicAlerts.available) ...[
              const _SeismicPermissions(),
              const SizedBox(height: 20),
            ],
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

/// Permisos opcionales para que la alerta sísmica encienda la pantalla y suene
/// aunque el teléfono esté en No molestar.
class _SeismicPermissions extends StatefulWidget {
  const _SeismicPermissions();
  @override
  State<_SeismicPermissions> createState() => _SeismicPermissionsState();
}

class _SeismicPermissionsState extends State<_SeismicPermissions> {
  bool? _dnd;

  @override
  void initState() {
    super.initState();
    SeismicAlerts.hasDndAccess().then((value) {
      if (mounted) setState(() => _dnd = value);
    });
  }

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: XentinelTheme.surface,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: XentinelTheme.border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Alertas sísmicas en este teléfono',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
        ),
        const SizedBox(height: 6),
        const Text(
          'Recibes los sismos cercanos aunque Xentinel esté cerrado. Para que la alerta '
          'encienda la pantalla y suene en No molestar, concede estos permisos.',
          style: TextStyle(color: XentinelTheme.steel, height: 1.4),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: SeismicAlerts.requestFullScreen,
              icon: const Icon(Icons.fullscreen),
              label: const Text('Pantalla completa'),
            ),
            OutlinedButton.icon(
              onPressed: _dnd == true
                  ? null
                  : () async {
                      final granted = await SeismicAlerts.requestDndAccess();
                      if (mounted) setState(() => _dnd = granted);
                    },
              icon: Icon(
                _dnd == true ? Icons.check : Icons.do_not_disturb_on_outlined,
              ),
              label: Text(
                _dnd == true ? 'Suena en No molestar' : 'Sonar en No molestar',
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

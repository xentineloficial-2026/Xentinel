import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../components/emergency_card.dart';
import '../components/semaforo.dart';
import '../components/xentinel_brand.dart';
import '../core/errors.dart';
import '../core/theme.dart';
import '../models/scan_alarm.dart';
import '../providers/alerts_provider.dart';

/// Alarmas: solo lo que pide atención, en rojo o amarillo. Riesgos críticos para
/// todos y, para el personal de control, los carnets QR vencidos o no verídicos.
class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({super.key});
  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> {
  /// Color elegido en el semáforo; `null` muestra todas.
  Semaforo? _filter;
  final _attending = <int>{};

  Future<void> _attend(AlertsMonitor monitor, ScanAlarm alarm) async {
    setState(() => _attending.add(alarm.id));
    try {
      await monitor.attendScan(alarm);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('«${alarm.title}» quedó marcada como revisada.'),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(describeError(error))));
      }
    } finally {
      if (mounted) setState(() => _attending.remove(alarm.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final monitor = ref.watch(alertsProvider);
    final risks = monitor.alerts
        .where((alert) => _filter == null || alert.semaforo == _filter)
        .toList();
    final scans = monitor.scanAlarms
        .where((alarm) => _filter == null || alarm.semaforo == _filter)
        .toList();
    final empty = monitor.alerts.isEmpty && monitor.scanAlarms.isEmpty;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Alarmas'),
        actions: [
          IconButton(
            tooltip: 'Actualizar alarmas',
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
                        ? 'Conectado a las alarmas en tiempo real'
                        : 'Consultando actualizaciones del centro de control',
                    style: const TextStyle(color: XentinelTheme.steel),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _SemaforoFilter(
              red: monitor.countOf(Semaforo.rojo),
              yellow: monitor.countOf(Semaforo.amarillo),
              selected: _filter,
              onSelect: (color) =>
                  setState(() => _filter = _filter == color ? null : color),
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
                        '${monitor.error}\nNo podemos confirmar el estado actual de las alarmas.',
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
                empty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Column(
                  children: [
                    XentinelLogo(size: 56),
                    SizedBox(height: 20),
                    Text(
                      'No hay alarmas activas',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    SizedBox(height: 6),
                    Text(
                      'Nada en rojo ni en amarillo, según la última consulta.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: XentinelTheme.steel),
                    ),
                  ],
                ),
              ),
            if (!empty && risks.isEmpty && scans.isEmpty && _filter != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  'No hay alarmas en ${_filter!.label.toLowerCase()}. '
                  'Toca de nuevo la luz para ver todas.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: XentinelTheme.steel),
                ),
              ),
            for (final alert in risks)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: EmergencyCard(alert: alert),
              ),
            for (final alarm in scans)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _ScanAlarmCard(
                  alarm: alarm,
                  busy: _attending.contains(alarm.id),
                  onAttend: () => _attend(monitor, alarm),
                ),
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

/// El semáforo cuenta y filtra: tocar una luz muestra solo ese color.
class _SemaforoFilter extends StatelessWidget {
  const _SemaforoFilter({
    required this.red,
    required this.yellow,
    required this.selected,
    required this.onSelect,
  });
  final int red;
  final int yellow;
  final Semaforo? selected;
  final ValueChanged<Semaforo> onSelect;

  @override
  Widget build(BuildContext context) {
    Widget row(Semaforo color, int count) => Semantics(
      button: true,
      selected: selected == color,
      child: InkWell(
        borderRadius: BorderRadius.circular(XentinelTheme.radiusM),
        onTap: () => onSelect(color),
        child: Container(
          // Alto mínimo, no fijo: con letra grande la fila crece en vez de desbordarse.
          constraints: const BoxConstraints(minHeight: 50),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: selected == color ? XentinelTheme.raised : null,
            borderRadius: BorderRadius.circular(XentinelTheme.radiusM),
            border: Border.all(
              color: selected == color
                  ? XentinelTheme.slate
                  : Colors.transparent,
            ),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 34,
                child: Text(
                  '$count',
                  style: const TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w700,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      color.plural,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      color.guidance,
                      style: const TextStyle(
                        fontSize: 13,
                        color: XentinelTheme.steel,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: XentinelTheme.surface,
        borderRadius: BorderRadius.circular(XentinelTheme.radiusL),
        border: Border.all(color: XentinelTheme.border),
      ),
      child: Row(
        children: [
          SemaforoLamps(red: red, yellow: yellow, lamp: 26),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              children: [
                row(Semaforo.rojo, red),
                const SizedBox(height: 6),
                row(Semaforo.amarillo, yellow),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Carnet QR por revisar: barra del color del semáforo, qué pasó y qué hacer.
class _ScanAlarmCard extends StatelessWidget {
  const _ScanAlarmCard({
    required this.alarm,
    required this.busy,
    required this.onAttend,
  });
  final ScanAlarm alarm;
  final bool busy;
  final VoidCallback onAttend;

  @override
  Widget build(BuildContext context) {
    final color = semaforoColor(alarm.semaforo);
    final at = alarm.at.toLocal();
    final time =
        '${at.day}/${at.month} · ${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
    final facts = <(String, String)>[
      ('Movimiento', alarm.exit ? 'Salida' : 'Entrada'),
      if (alarm.holder != null)
        ('Titular', alarm.holder!)
      else if (alarm.claimedId != null)
        ('El código dice ser', 'ID ${alarm.claimedId}'),
      if (alarm.scannedBy != null) ('Escaneó', alarm.scannedBy!),
    ];
    // Esquinas por recorte: Flutter no admite bordes redondeados de varios colores.
    return ClipRRect(
      borderRadius: BorderRadius.circular(XentinelTheme.radiusM),
      child: Container(
        decoration: BoxDecoration(
          color: XentinelTheme.surface,
          border: Border(left: BorderSide(color: color, width: 6)),
        ),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.qr_code_2, color: color, size: 22),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    alarm.title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    alarm.semaforo.label,
                    style: TextStyle(
                      color: semaforoForeground(alarm.semaforo),
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(time, style: XentinelTheme.mono),
            const SizedBox(height: 10),
            Text(alarm.detail, style: const TextStyle(height: 1.4)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 22,
              runSpacing: 8,
              children: [
                for (final (label, value) in facts)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: const TextStyle(
                          fontSize: 12,
                          color: XentinelTheme.steel,
                        ),
                      ),
                      Text(
                        value,
                        style: const TextStyle(fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: busy ? null : onAttend,
              child: Text(busy ? 'Guardando…' : 'Marcar como revisada'),
            ),
          ],
        ),
      ),
    );
  }
}

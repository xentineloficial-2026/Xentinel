import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/router.dart';
import '../core/session.dart';
import '../models/emergency_alert.dart';
import '../providers/alerts_provider.dart';
import '../services/feedback_service.dart';
import 'emergency_card.dart';
import 'emergency_takeover.dart';

/// Lives above the navigator so an emergency is visible on every signed-in screen.
class AlertsHost extends ConsumerStatefulWidget {
  const AlertsHost({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<AlertsHost> createState() => _AlertsHostState();
}

class _AlertsHostState extends ConsumerState<AlertsHost>
    with WidgetsBindingObserver {
  final _announced = <String>{};
  // Alertas que la persona ya atendió; si el mensaje cambia, vuelve a interrumpir.
  final _acknowledged = <String>{};
  // Se reinician al cambiar la persona, no al renovar su token.
  String? _lastUser;
  bool get _foreground =>
      WidgetsBinding.instance.lifecycleState == null ||
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) =>
      ref.read(alertsProvider).setActive(state == AppLifecycleState.resumed);
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _openAlerts() {
    final router = ref.read(routerProvider);
    if (router.routeInformationProvider.value.uri.path != '/alerts') {
      router.push('/alerts');
    }
  }

  /// La alerta más grave no atendida. Las informativas nunca interrumpen.
  EmergencyAlert? _takeoverFor(List<EmergencyAlert> alerts) {
    final pending =
        alerts
            .where(
              (a) =>
                  a.severity != AlertSeverity.informativa &&
                  !_acknowledged.contains(a.fingerprint),
            )
            .toList()
          ..sort((a, b) => b.severity.index.compareTo(a.severity.index));
    return pending.firstOrNull;
  }

  @override
  Widget build(BuildContext context) {
    final token = ref.watch(sessionProvider.select((session) => session.token));
    final userId = ref.watch(
      sessionProvider.select((session) => session.user?.id),
    );
    if (_lastUser != userId) {
      _announced.clear();
      _acknowledged.clear();
      _lastUser = userId;
    }
    final monitor = ref.watch(alertsProvider);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && identical(monitor, ref.read(alertsProvider))) {
        monitor.setActive(token != null && _foreground);
      }
    });
    ref.listen(alertsProvider, (_, next) {
      if (!_foreground || token == null) return;
      final fingerprints = next.alerts.map((a) => a.fingerprint).toSet();
      final hasNew = fingerprints.difference(_announced).isNotEmpty;
      _announced
        ..clear()
        ..addAll(fingerprints);
      if (hasNew) unawaited(ref.read(feedbackServiceProvider).emergency());
    });
    final alert = monitor.alerts.firstOrNull;
    final takeover = token == null ? null : _takeoverFor(monitor.alerts);
    final bandForeground = alert == null
        ? Colors.white
        : severityForeground(alert.severity);
    return Stack(
      children: [
        Positioned.fill(
          child: Column(
            children: [
              if (token != null && alert != null)
                Material(
                  color: severityColor(alert.severity),
                  child: SafeArea(
                    bottom: false,
                    child: Semantics(
                      liveRegion: true,
                      label: 'Alerta ${alert.severityLabel}: ${alert.type}',
                      child: InkWell(
                        onTap: _openAlerts,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 10,
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.warning_amber_rounded,
                                color: bandForeground,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  '${alert.type} · ${alert.severityLabel}\n${monitor.error == null ? 'Ver indicaciones' : 'Sin conexión · última alerta recibida'}',
                                  maxLines: 3,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: bandForeground,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              Icon(Icons.chevron_right, color: bandForeground),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              Expanded(child: widget.child),
            ],
          ),
        ),
        if (takeover != null)
          Positioned.fill(
            child: EmergencyTakeover(
              key: ValueKey(takeover.fingerprint),
              alert: takeover,
              onAcknowledge: () =>
                  setState(() => _acknowledged.add(takeover.fingerprint)),
              onDetails: () {
                setState(() => _acknowledged.add(takeover.fingerprint));
                _openAlerts();
              },
            ),
          ),
      ],
    );
  }
}

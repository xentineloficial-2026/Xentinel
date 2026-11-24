import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../components/semaforo.dart';
import '../components/xentinel_brand.dart';
import '../components/xentinel_motion.dart';
import '../core/greetings.dart';
import '../core/router.dart';
import '../core/theme.dart';
import '../models/scan_alarm.dart';
import '../providers/alerts_provider.dart';
import '../providers/auth_provider.dart';
import '../providers/carnet_provider.dart';

/// Inicio: un solo lugar para llegar a todo, sin barra inferior que repita los
/// mismos accesos. La acción principal depende del rol: el personal de control
/// escanea; las demás personas muestran su carnet.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Cerrar sesión?'),
        content: const Text(
          'Tu carnet deja de mostrarse en este teléfono hasta que vuelvas a ingresar.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Cerrar sesión'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(authControllerProvider.notifier).logout();
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final monitor = ref.watch(alertsProvider);
    if (user == null) return const Scaffold();
    final scanner = canScan(user.role);

    final carnet = _ActionTile(
      icon: Icons.qr_code_2,
      title: 'Mi carnet digital',
      subtitle: 'Muéstralo en el punto de control',
      primary: !scanner,
      onTap: () => context.push('/carnet'),
    );
    final scan = _ActionTile(
      icon: Icons.qr_code_scanner,
      title: 'Escáner de acceso',
      subtitle: 'Registra entradas y salidas',
      primary: true,
      onTap: () => context.push('/scanner'),
    );

    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: FacetBackdrop()),
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 28),
              children: [
                Row(
                  children: [
                    const XentinelLogo(size: 24, color: XentinelTheme.text),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Xentinel',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w600,
                              letterSpacing: -0.3,
                            ),
                          ),
                          Text(
                            user.role.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: XentinelTheme.steel,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Cerrar sesión',
                      onPressed: () => _confirmLogout(context, ref),
                      icon: const Icon(
                        Icons.logout_rounded,
                        color: XentinelTheme.steel,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 36),
                Entrance(
                  child: Text(
                    greetingFor(user.name, DateTime.now()),
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                ),
                const SizedBox(height: 10),
                Entrance(
                  delay: 0.08,
                  child: Text(
                    scanner
                        ? 'El punto de control y las alarmas de tu sede, a un toque.'
                        : 'Tu carnet y las alarmas de tu sede, siempre a mano.',
                    style: const TextStyle(
                      color: XentinelTheme.steel,
                      fontSize: 16,
                    ),
                  ),
                ),
                const SizedBox(height: 28),
                Entrance(delay: 0.16, child: scanner ? scan : carnet),
                if (scanner) ...[
                  const SizedBox(height: 10),
                  Entrance(delay: 0.22, child: carnet),
                ],
                const SizedBox(height: 10),
                Entrance(
                  delay: scanner ? 0.28 : 0.22,
                  child: _AlarmsTile(
                    red: monitor.countOf(Semaforo.rojo),
                    yellow: monitor.countOf(Semaforo.amarillo),
                    offline: monitor.error != null,
                    onTap: () => context.push('/alerts'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Acceso a las alarmas: el semáforo dice de un vistazo si hay algo que atender.
class _AlarmsTile extends StatelessWidget {
  const _AlarmsTile({
    required this.red,
    required this.yellow,
    required this.offline,
    required this.onTap,
  });
  final int red;
  final int yellow;
  final bool offline;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final total = red + yellow;
    final title = offline
        ? 'Alarmas sin conexión'
        : total == 0
        ? 'Alarmas'
        : total == 1
        ? '1 alarma activa'
        : '$total alarmas activas';
    final subtitle = offline
        ? 'No podemos confirmar el estado actual'
        : total == 0
        ? 'Sin novedades en rojo ni en amarillo'
        : [
            if (red > 0) '$red en rojo',
            if (yellow > 0) '$yellow en amarillo',
          ].join(' y ');
    return GlassPanel(
      padding: EdgeInsets.zero,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                SemaforoLamps(red: red, yellow: yellow, lamp: 14),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.2,
                        ),
                      ),
                      Text(
                        subtitle,
                        style: TextStyle(
                          color: offline
                              ? XentinelTheme.warning
                              : XentinelTheme.steel,
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.chevron_right, color: XentinelTheme.steel),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.primary = false,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final foreground = primary ? XentinelTheme.ink : XentinelTheme.text;
    final muted = primary ? XentinelTheme.slate : XentinelTheme.steel;
    final content = InkWell(
      onTap: onTap,
      child: Padding(
        padding: EdgeInsets.all(primary ? 20 : 16),
        child: Row(
          children: [
            Icon(icon, size: primary ? 40 : 26, color: foreground),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: foreground,
                      fontSize: primary ? 20 : 17,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.2,
                    ),
                  ),
                  Text(subtitle, style: TextStyle(color: muted, fontSize: 14)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(Icons.chevron_right, color: muted),
          ],
        ),
      ),
    );
    // La acción principal es sólida; las demás, vidrio sobre las facetas.
    return primary
        ? Material(
            color: XentinelTheme.mist,
            borderRadius: BorderRadius.circular(XentinelTheme.radiusL),
            clipBehavior: Clip.antiAlias,
            child: content,
          )
        : GlassPanel(
            padding: EdgeInsets.zero,
            child: Material(color: Colors.transparent, child: content),
          );
  }
}

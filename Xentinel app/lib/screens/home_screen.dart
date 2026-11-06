import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../components/xentinel_brand.dart';
import '../components/xentinel_motion.dart';
import '../core/router.dart';
import '../core/theme.dart';
import '../core/greetings.dart';
import '../providers/auth_provider.dart';
import '../providers/carnet_provider.dart';
import '../providers/alerts_provider.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final alerts = ref.watch(alertsProvider);
    if (user == null) return const SizedBox.shrink();
    final scanner = canScan(user.role);

    return Scaffold(
      extendBody: true,
      body: Stack(
        children: [
          const Positioned.fill(child: FacetBackdrop()),
          SafeArea(
            bottom: false,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 120),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const XentinelLogo(size: 28),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Xentinel',
                          style: TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.3,
                          ),
                        ),
                      ),
                      Flexible(
                        child: Text(
                          user.role.label,
                          textAlign: TextAlign.end,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: XentinelTheme.steel),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  const Center(child: Shield3D(size: 112)),
                  const SizedBox(height: 22),
                  Text(
                    greetingFor(user.name, DateTime.now()),
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Tu carnet, tus accesos y las alertas de tu sede, siempre a mano.',
                    style: TextStyle(color: XentinelTheme.steel, fontSize: 16),
                  ),
                  const SizedBox(height: 28),
                  _ActionTile(
                    icon: Icons.qr_code_2,
                    title: 'Mi carnet digital',
                    subtitle: 'Muéstralo en el punto de control',
                    primary: true,
                    onTap: () => context.push('/carnet'),
                  ),
                  if (scanner) ...[
                    const SizedBox(height: 10),
                    _ActionTile(
                      icon: Icons.qr_code_scanner,
                      title: 'Escáner de acceso',
                      subtitle: 'Registra entradas y salidas',
                      onTap: () => context.push('/scanner'),
                    ),
                  ],
                  const SizedBox(height: 10),
                  _ActionTile(
                    icon: Icons.warning_amber_rounded,
                    iconColor: alerts.alerts.isNotEmpty
                        ? XentinelTheme.alarm
                        : alerts.error != null
                        ? XentinelTheme.warning
                        : XentinelTheme.steel,
                    title: alerts.error != null
                        ? 'Alertas · sin conexión'
                        : alerts.alerts.isNotEmpty
                        ? 'Alertas activas: ${alerts.alerts.length}'
                        : 'Alertas de emergencia',
                    subtitle: alerts.error != null
                        ? 'No podemos confirmar el estado actual'
                        : alerts.alerts.isNotEmpty
                        ? 'Revisa las indicaciones'
                        : 'Sin novedades por ahora',
                    onTap: () => context.push('/alerts'),
                  ),
                  const SizedBox(height: 20),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () =>
                          ref.read(authControllerProvider.notifier).logout(),
                      icon: const Icon(
                        Icons.logout,
                        size: 18,
                        color: XentinelTheme.steel,
                      ),
                      label: const Text(
                        'Cerrar sesión',
                        style: TextStyle(color: XentinelTheme.steel),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: _GlassDock(
        items: [
          const _DockItem(Icons.home_rounded, 'Inicio'),
          const _DockItem(Icons.qr_code_2, 'Carnet', route: '/carnet'),
          if (scanner)
            const _DockItem(
              Icons.qr_code_scanner,
              'Escanear',
              route: '/scanner',
            ),
          const _DockItem(
            Icons.notifications_none_rounded,
            'Alertas',
            route: '/alerts',
          ),
        ],
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
    this.iconColor,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool primary;
  final Color? iconColor;

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
            Icon(icon, size: primary ? 40 : 26, color: iconColor ?? foreground),
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

class _DockItem {
  const _DockItem(this.icon, this.label, {this.route});
  final IconData icon;
  final String label;

  /// Ruta que abre; la pestaña sin ruta es la pantalla actual.
  final String? route;
}

/// Barra inferior flotante. El contenido pasa por detrás, por eso lleva vidrio;
/// el indicador se desliza a la pestaña tocada y vuelve al regresar.
class _GlassDock extends StatefulWidget {
  const _GlassDock({required this.items});
  final List<_DockItem> items;

  @override
  State<_GlassDock> createState() => _GlassDockState();
}

class _GlassDockState extends State<_GlassDock> {
  int _selected = 0;

  Future<void> _open(int index) async {
    final route = widget.items[index].route;
    if (route == null) return;
    setState(() => _selected = index);
    await context.push(route);
    if (mounted) setState(() => _selected = 0);
  }

  @override
  Widget build(BuildContext context) {
    final count = widget.items.length;
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 0, 16, 14),
      child: GlassPanel(
        padding: const EdgeInsets.all(6),
        radius: 22,
        child: Stack(
          children: [
            Positioned.fill(
              child: AnimatedAlign(
                duration: const Duration(milliseconds: 320),
                curve: Curves.easeOutCubic,
                alignment: Alignment(
                  count == 1 ? 0 : -1 + 2 * _selected / (count - 1),
                  0,
                ),
                child: FractionallySizedBox(
                  widthFactor: 1 / count,
                  heightFactor: 1,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: XentinelTheme.border,
                      borderRadius: BorderRadius.circular(17),
                    ),
                  ),
                ),
              ),
            ),
            Row(
              children: [
                for (var i = 0; i < count; i++)
                  Expanded(
                    child: Semantics(
                      button: true,
                      selected: i == _selected,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(17),
                        onTap: () => _open(i),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(minHeight: 56),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              vertical: 6,
                              horizontal: 2,
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  widget.items[i].icon,
                                  size: 24,
                                  color: i == _selected
                                      ? XentinelTheme.text
                                      : XentinelTheme.steel,
                                ),
                                const SizedBox(height: 2),
                                MediaQuery.withClampedTextScaling(
                                  maxScaleFactor: 1.1,
                                  child: Text(
                                    widget.items[i].label,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 12,
                                      height: 1.2,
                                      fontWeight: FontWeight.w500,
                                      color: i == _selected
                                          ? XentinelTheme.text
                                          : XentinelTheme.steel,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

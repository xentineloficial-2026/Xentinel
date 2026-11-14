import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../models/xentinel_models.dart';
import '../providers/carnet_provider.dart';
import '../screens/carnet_screen.dart';
import '../screens/home_screen.dart';
import '../screens/login_screen.dart';
import '../screens/scanner_screen.dart';
import 'route_observer.dart';
import '../screens/alerts_screen.dart';
import '../screens/forgot_password_screen.dart';

/// Solo ADMINISTRADOR y GUARDIA pueden usar el escáner.
bool canScan(UserRole role) =>
    role == UserRole.administrador || role == UserRole.guardia;

CustomTransitionPage<void> _page(GoRouterState state, Widget child) =>
    CustomTransitionPage<void>(
      key: state.pageKey,
      child: child,
      transitionDuration: const Duration(milliseconds: 220),
      reverseTransitionDuration: const Duration(milliseconds: 180),
      transitionsBuilder: (context, animation, secondary, child) {
        if (MediaQuery.disableAnimationsOf(context)) return child;
        final curve = CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutCubic,
        );
        return FadeTransition(
          opacity: curve,
          child: SlideTransition(
            position: Tween(
              begin: const Offset(0, 0.025),
              end: Offset.zero,
            ).animate(curve),
            child: child,
          ),
        );
      },
    );

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen<UserEntity?>(currentUserProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    observers: [scannerRouteObserver],
    initialLocation: '/login',
    refreshListenable: refresh,
    errorBuilder: (context, state) => Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.explore_outlined, size: 56),
                const SizedBox(height: 20),
                const Text(
                  'Esta pantalla ya no está disponible.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => context.go('/home'),
                  child: const Text('Volver al inicio'),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
    redirect: (context, state) {
      final user = ref.read(currentUserProvider);
      final location = state.matchedLocation;

      // El carnet sin conexión es accesible con o sin sesión (tras biometría).
      if (location == '/carnet-offline') return null;
      final publicRoute =
          location == '/login' || location == '/forgot-password';
      if (user == null) return publicRoute ? null : '/login';
      if (publicRoute) return '/home';
      if (location == '/scanner' && !canScan(user.role)) return '/home';
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        pageBuilder: (_, state) => _page(state, const LoginScreen()),
      ),
      GoRoute(
        path: '/home',
        pageBuilder: (_, state) => _page(state, const HomeScreen()),
      ),
      GoRoute(
        path: '/carnet',
        pageBuilder: (_, state) => _page(state, const CarnetScreen()),
      ),
      GoRoute(
        path: '/carnet-offline',
        pageBuilder: (_, state) =>
            _page(state, const CarnetScreen(offline: true)),
      ),
      GoRoute(
        path: '/scanner',
        pageBuilder: (_, state) => _page(state, const ScannerScreen()),
      ),
      // Emergency information appears immediately; no animation delays it.
      GoRoute(
        path: '/alerts',
        pageBuilder: (_, state) => NoTransitionPage<void>(
          key: state.pageKey,
          child: const AlertsScreen(),
        ),
      ),
      GoRoute(
        path: '/forgot-password',
        pageBuilder: (_, state) => _page(state, const ForgotPasswordScreen()),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

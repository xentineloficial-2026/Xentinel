import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/router.dart';
import 'core/theme.dart';
import 'components/alerts_host.dart';

class XentinelApp extends ConsumerWidget {
  const XentinelApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Xentinel',
      debugShowCheckedModeBanner: false,
      theme: XentinelTheme.dark(),
      darkTheme: XentinelTheme.dark(),
      themeMode: ThemeMode.dark, // Estrictamente oscuro
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) =>
          AlertsHost(child: child ?? const SizedBox.shrink()),
    );
  }
}

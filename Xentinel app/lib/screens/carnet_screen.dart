import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../components/xentinel_brand.dart';
import '../core/theme.dart';
import '../models/xentinel_models.dart';
import '../providers/carnet_provider.dart';

class CarnetScreen extends ConsumerStatefulWidget {
  const CarnetScreen({super.key});

  @override
  ConsumerState<CarnetScreen> createState() => _CarnetScreenState();
}

class _CarnetScreenState extends ConsumerState<CarnetScreen> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    // Solo refresca la cuenta regresiva visual (el QR lo regenera el provider).
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Color _statusColor(AccessStatus s) => switch (s) {
    AccessStatus.permitido => XentinelTheme.success,
    AccessStatus.pendiente => XentinelTheme.warning,
    AccessStatus.denegado => XentinelTheme.danger,
    AccessStatus.visitante => XentinelTheme.steel,
  };

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final carnet = ref.watch(carnetProvider);
    if (user == null || !carnet.hasQr) return const Scaffold();

    final total = CarnetNotifier.refreshInterval.inSeconds;
    final elapsed = DateTime.now().difference(carnet.generatedAt!).inSeconds;
    final remaining = (total - elapsed).clamp(0, total);

    return Scaffold(
      appBar: AppBar(title: const Text('Carnet digital')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: XentinelTheme.surface,
                borderRadius: BorderRadius.circular(XentinelTheme.radiusL),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      const XentinelLogo(size: 26),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Xentinel',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: _statusColor(
                            user.status,
                          ).withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          user.status.dbValue,
                          style: TextStyle(
                            color: _statusColor(user.status),
                            fontWeight: FontWeight.w500,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(
                        XentinelTheme.radiusM,
                      ),
                    ),
                    child: LayoutBuilder(
                      builder: (context, constraints) => QrImageView(
                        data: carnet.qrPayload,
                        version: QrVersions.auto,
                        size: constraints.maxWidth.clamp(0, 230).toDouble(),
                        backgroundColor: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: 230,
                    child: LinearProgressIndicator(
                      value: remaining / total,
                      minHeight: 4,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Se actualiza en ${remaining}s',
                    style: XentinelTheme.mono,
                  ),
                  const SizedBox(height: 20),
                  Text(
                    user.name,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    user.role.label,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: XentinelTheme.steel),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Doc. ${user.documentId}',
                    textAlign: TextAlign.center,
                    style: XentinelTheme.mono,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

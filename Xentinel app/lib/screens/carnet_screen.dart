import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../components/xentinel_brand.dart';
import '../core/theme.dart';
import '../models/xentinel_models.dart';
import '../providers/carnet_provider.dart';
import '../services/credential_store.dart';
import '../services/network_status.dart';
import '../services/screen_brightness_service.dart';

/// Construye el QR del carnet para leerlo con la cámara de otro teléfono.
///
/// - Modo alfanumérico cuando el contenido lo permite (carnet firmado y heredado):
///   menos módulos para el mismo texto, cada módulo se ve más grande.
/// - Corrección de errores Q (25 %): tolera reflejos, moiré y dedos en la pantalla.
/// - Zona de silencio amplia y módulos negros puros sobre blanco puro.
QrCode buildCarnetQr(String data) {
  const level = QrErrorCorrectLevel.Q;
  final alphanumeric = RegExp(r'^[0-9A-Z $%*+\-./:]+$').hasMatch(data);
  if (alphanumeric) {
    for (var version = 1; version <= 10; version++) {
      try {
        final code = QrCode(version, level)..addAlphaNumeric(data);
        // Construir la matriz confirma que el contenido cabe en esta versión.
        QrImage(code);
        return code;
      } on InputTooLongException {
        continue;
      }
    }
  }
  return QrCode.fromData(data: data, errorCorrectLevel: level);
}

class CarnetScreen extends ConsumerStatefulWidget {
  const CarnetScreen({super.key, this.offline = false});

  /// Carnet desde la credencial guardada, sin sesión ni conexión.
  final bool offline;

  @override
  ConsumerState<CarnetScreen> createState() => _CarnetScreenState();
}

class _CarnetScreenState extends ConsumerState<CarnetScreen>
    with WidgetsBindingObserver {
  late final BrightnessControl _brightness;
  String? _qrData;
  QrCode? _qr;

  QrCode _qrFor(String data) {
    if (data != _qrData || _qr == null) {
      _qrData = data;
      _qr = buildCarnetQr(data);
    }
    return _qr!;
  }

  @override
  void initState() {
    super.initState();
    _brightness = ref.read(brightnessControlProvider);
    WidgetsBinding.instance.addObserver(this);
    unawaited(_brightness.maximize());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_brightness.maximize());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_brightness.restore());
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
    final CarnetState carnet;
    final String name;
    final String role;
    final String document;
    final AccessStatus status;
    if (widget.offline) {
      carnet = ref.watch(offlineCarnetProvider);
      final credential = ref.watch(
        credentialStoreProvider.select((store) => store.current),
      );
      if (credential == null || !carnet.hasQr) {
        return Scaffold(
          appBar: AppBar(title: const Text('Carnet digital')),
          body: const Center(
            child: Padding(
              padding: EdgeInsets.all(28),
              child: Text(
                'No hay un carnet guardado en este teléfono. Inicia sesión con conexión una vez para usarlo sin internet.',
                textAlign: TextAlign.center,
              ),
            ),
          ),
        );
      }
      name = credential.name;
      role = credential.role.label;
      document = credential.documentId;
      status = credential.status;
    } else {
      final user = ref.watch(currentUserProvider);
      carnet = ref.watch(carnetProvider);
      if (user == null || !carnet.hasQr) return const Scaffold();
      name = user.name;
      role = user.role.label;
      document = user.documentId;
      status = user.status;
    }
    final online = ref.watch(networkStatusProvider.select((n) => n.online));

    return Scaffold(
      appBar: AppBar(title: const Text('Carnet digital')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Container(
                padding: const EdgeInsets.all(20),
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
                            color: _statusColor(status).withValues(alpha: 0.14),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            status.dbValue,
                            style: TextStyle(
                              color: _statusColor(status),
                              fontWeight: FontWeight.w500,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        // Lo más grande posible: módulos grandes se leen desde más
                        // lejos y con menos enfoque.
                        final side = math.min(constraints.maxWidth, 320.0);
                        return Semantics(
                          label: 'Código QR de acceso de $name',
                          image: true,
                          child: Container(
                            width: side,
                            height: side,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(
                                XentinelTheme.radiusM,
                              ),
                            ),
                            child: QrImageView.withQr(
                              qr: _qrFor(carnet.qrPayload),
                              size: side,
                              padding: EdgeInsets.all(side * 0.07),
                              backgroundColor: Colors.white,
                              gapless: true,
                              semanticsLabel: 'Código QR del carnet',
                              eyeStyle: const QrEyeStyle(
                                eyeShape: QrEyeShape.square,
                                color: Colors.black,
                              ),
                              dataModuleStyle: const QrDataModuleStyle(
                                dataModuleShape: QrDataModuleShape.square,
                                color: Colors.black,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                    const SizedBox(height: 14),
                    _Countdown(refreshAt: carnet.refreshAt!),
                    const SizedBox(height: 18),
                    Text(
                      name,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      role,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: XentinelTheme.steel),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Doc. $document',
                      textAlign: TextAlign.center,
                      style: XentinelTheme.mono,
                    ),
                    const SizedBox(height: 16),
                    _Hint(
                      icon: carnet.signed
                          ? Icons.verified_user_outlined
                          : Icons.info_outline,
                      text: carnet.signed
                          ? online
                                ? 'Carnet firmado. También funciona sin internet.'
                                : 'Sin conexión: tu carnet firmado sigue funcionando.'
                          : 'Carnet sin firma: actualiza el servidor para usarlo sin conexión.',
                    ),
                    const SizedBox(height: 8),
                    const _Hint(
                      icon: Icons.phone_android,
                      text:
                          'Sostén el teléfono quieto, de frente y a unos 20 cm de la cámara.',
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Solo esta parte se actualiza cada segundo; el QR se redibuja cada 15 s.
class _Countdown extends StatefulWidget {
  const _Countdown({required this.refreshAt});
  final DateTime refreshAt;

  @override
  State<_Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<_Countdown> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final total = CarnetNotifier.refreshInterval.inMilliseconds;
    final left = widget.refreshAt
        .difference(DateTime.now())
        .inMilliseconds
        .clamp(0, total);
    return Column(
      children: [
        SizedBox(
          width: 230,
          child: LinearProgressIndicator(
            value: left / total,
            minHeight: 4,
            borderRadius: BorderRadius.circular(4),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Se actualiza en ${(left / 1000).ceil()}s',
          style: XentinelTheme.mono,
        ),
      ],
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 18, color: XentinelTheme.steel),
      const SizedBox(width: 8),
      Expanded(
        child: Text(
          text,
          style: const TextStyle(color: XentinelTheme.steel, fontSize: 13),
        ),
      ),
    ],
  );
}

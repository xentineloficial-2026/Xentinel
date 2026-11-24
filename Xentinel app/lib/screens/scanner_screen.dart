import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../components/xentinel_brand.dart';
import '../components/xentinel_motion.dart';
import '../core/errors.dart';
import '../core/theme.dart';
import '../models/xentinel_models.dart';
import '../repositories/access_repository.dart';
import '../services/feedback_service.dart';
import '../services/camera_session.dart';
import '../services/network_status.dart';
import '../core/route_observer.dart';

class ScannerScreen extends ConsumerStatefulWidget {
  const ScannerScreen({super.key});

  @override
  ConsumerState<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends ConsumerState<ScannerScreen>
    with WidgetsBindingObserver, RouteAware {
  static const Duration _resultDuration = Duration(milliseconds: 2500);
  static const Duration _grantedDuration = Duration(milliseconds: 4000);

  /// El carnet rota cada 15 s: tras un resultado definitivo, la misma persona en la
  /// misma dirección no se vuelve a procesar durante unos segundos aunque cambie el
  /// código (evita "Movimiento fuera de orden" si el teléfono sigue frente a la cámara).
  static const Duration _samePersonCooldown = Duration(seconds: 6);

  final _driver = MobileScannerDriver();
  late final CameraSession _camera;
  StreamSubscription<BarcodeCapture>? _barcodes;
  ModalRoute<void>? _route;

  bool _busy = false;
  bool _exitMode = false;
  AccessScanResult? _result;
  Timer? _resetTimer;
  String? _lastConfirmedPayload;
  final _recentPeople = <String, DateTime>{};
  double _zoomAtScaleStart = 0;

  @override
  void initState() {
    super.initState();
    _camera = CameraSession(
      driver: _driver,
      permissions: ref.read(cameraPermissionsProvider),
    );
    WidgetsBinding.instance.addObserver(this);
    _barcodes = _driver.controller.barcodes.listen(
      _onDetect,
      onError: (Object error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'No se pudo leer el QR. Aleja un poco el teléfono y mantenlo quieto.',
              ),
            ),
          );
        }
      },
    );
    unawaited(
      _camera.setActive(
        WidgetsBinding.instance.lifecycleState == null ||
            WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed,
      ),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of<void>(context);
    if (_route != route) {
      scannerRouteObserver.unsubscribe(this);
      _route = route;
      if (route != null) scannerRouteObserver.subscribe(this, route);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) =>
      unawaited(_camera.setActive(state == AppLifecycleState.resumed));

  @override
  void didPushNext() => unawaited(_camera.setVisible(false));
  @override
  void didPopNext() => unawaited(_camera.setVisible(true));

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    scannerRouteObserver.unsubscribe(this);
    _resetTimer?.cancel();
    unawaited(_barcodes?.cancel());
    _camera.dispose();
    super.dispose();
  }

  /// Entre varios códigos en el cuadro, el de Xentinel; si no hay, el primero.
  static String? _pickPayload(BarcodeCapture capture) {
    final values = capture.barcodes
        .map((b) => b.rawValue)
        .whereType<String>()
        .where((v) => v.isNotEmpty)
        .toList();
    return values
            .where((v) => AccessRepository.userIdOf(v) != null)
            .firstOrNull ??
        values.firstOrNull;
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_busy || !_camera.canScan) return;
    final raw = _pickPayload(capture);
    if (raw == null) return;
    final scanKey = '$raw:$_exitMode';
    if (scanKey == _lastConfirmedPayload) return;
    final person = AccessRepository.userIdOf(raw);
    final personKey = '$person:$_exitMode';
    final now = DateTime.now();
    _recentPeople.removeWhere(
      (_, at) => now.difference(at) > _samePersonCooldown,
    );
    if (person != null && _recentPeople.containsKey(personKey)) return;

    setState(() => _busy = true);
    final isExit = _exitMode;
    AccessScanResult result;
    try {
      result = await ref
          .read(accessRepositoryProvider)
          .processScanPayload(payload: raw, isExitMode: isExit);
    } catch (e) {
      result = Unconfirmed(reason: describeError(e));
    }
    if (!mounted) return;
    if (result is! Unconfirmed) {
      _lastConfirmedPayload = scanKey;
      if (person != null) _recentPeople[personKey] = DateTime.now();
    }

    setState(() => _result = result);
    if (_camera.canScan) {
      unawaited(ref.read(feedbackServiceProvider).play(result));
    }

    // Con datos en pantalla, el celador necesita un poco más de tiempo para leerlos.
    final duration = result is Granted ? _grantedDuration : _resultDuration;
    _resetTimer = Timer(duration, () {
      if (!mounted) return;
      setState(() {
        _result = null;
        _busy = false;
      });
    });
  }

  IconData _iconFor(AccessScanResult r) => switch (r) {
    Granted(isExit: false) => Icons.login_rounded,
    Granted(isExit: true) => Icons.logout_rounded,
    Alert() => Icons.warning_amber_rounded,
    NotRegistered() => Icons.person_search,
    Denied() => Icons.block,
    VisitorAccess() => Icons.person_outline,
    Unconfirmed() => Icons.cloud_off,
  };

  Future<void> _setZoom(double value) async {
    try {
      await _driver.controller.setZoomScale(value.clamp(0.0, 1.0));
    } catch (_) {
      // Cámara sin zoom o detenida: se ignora.
    }
  }

  Future<void> _openSettings() async {
    final opened = await _camera.openSettings();
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Abre Ajustes > Xentinel > Cámara para habilitar el permiso.',
          ),
        ),
      );
    }
  }

  Widget _cameraStatus() {
    final phase = _camera.phase;
    final text = switch (phase) {
      CameraPhase.checking => 'Verificando permiso de cámara…',
      CameraPhase.starting => 'Iniciando cámara…',
      CameraPhase.denied =>
        'Permite el acceso a la cámara para escanear carnets.',
      CameraPhase.blocked =>
        'El permiso de cámara está desactivado. Habilítalo en Ajustes.',
      CameraPhase.restricted =>
        'La cámara está restringida por la configuración del dispositivo.',
      CameraPhase.unavailable =>
        'No hay una cámara compatible disponible en este dispositivo.',
      CameraPhase.failed =>
        'No se pudo iniciar la cámara. Cierra otras apps que la estén usando y reintenta. Si continúa, vuelve a abrir el escáner.',
      CameraPhase.paused => 'Cámara en pausa.',
      CameraPhase.ready => '',
    };
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (phase == CameraPhase.checking || phase == CameraPhase.starting)
              const CircularProgressIndicator()
            else
              const Icon(
                Icons.camera_alt_outlined,
                size: 54,
                color: XentinelTheme.steel,
              ),
            const SizedBox(height: 20),
            Text(text, textAlign: TextAlign.center),
            const SizedBox(height: 20),
            if (phase == CameraPhase.denied)
              FilledButton(
                onPressed: _camera.requestAccess,
                child: const Text('Permitir cámara'),
              ),
            if (phase == CameraPhase.blocked)
              FilledButton(
                onPressed: _openSettings,
                child: const Text('Abrir Ajustes'),
              ),
            if (phase == CameraPhase.failed || phase == CameraPhase.unavailable)
              FilledButton(
                onPressed: _camera.retry,
                child: const Text('Reintentar'),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final online = ref.watch(networkStatusProvider.select((n) => n.online));

    return AnimatedBuilder(
      animation: _camera,
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          title: const Text('Escáner de acceso'),
          actions: [
            ValueListenableBuilder<MobileScannerState>(
              valueListenable: _driver.controller,
              builder: (context, state, _) => IconButton(
                tooltip: 'Linterna',
                icon: Icon(
                  state.torchState == TorchState.on
                      ? Icons.flash_on
                      : Icons.flash_off,
                ),
                onPressed:
                    _camera.canScan &&
                        state.torchState != TorchState.unavailable
                    ? () async {
                        try {
                          await _driver.controller.toggleTorch();
                        } catch (_) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'La linterna no está disponible.',
                                ),
                              ),
                            );
                          }
                        }
                      }
                    : null,
              ),
            ),
          ],
        ),
        body: Stack(
          children: [
            if (_camera.previewMounted)
              Positioned.fill(
                // Pellizcar para acercar: con zoom el teléfono puede quedar a una
                // distancia en la que la cámara sí enfoca la otra pantalla.
                child: GestureDetector(
                  onScaleStart: (_) =>
                      _zoomAtScaleStart = _driver.controller.value.zoomScale,
                  onScaleUpdate: (details) {
                    if (details.pointerCount < 2) return;
                    unawaited(
                      _setZoom(_zoomAtScaleStart + (details.scale - 1) * 0.5),
                    );
                  },
                  // Keep the mounted preview stable during pause/resume. Only the
                  // session owns camera operations; the widget never auto-starts it.
                  child: MobileScanner(
                    controller: _driver.controller,
                    useAppLifecycleState: false,
                    tapToFocus: true,
                    errorBuilder: (_, __) => _cameraStatus(),
                  ),
                ),
              ),
            // Marco guía: oscurece alrededor para que el ojo vaya directo al código.
            if (_camera.canScan) const Positioned.fill(child: _ScanFrame()),
            if (_camera.canScan)
              Positioned(
                left: 16,
                right: 16,
                top: 12,
                child: IgnorePointer(child: _ScannerHint(online: online)),
              ),
            // Zoom y selector entrada / salida
            if (_camera.canScan)
              Positioned(
                left: 16,
                right: 16,
                bottom: 16,
                child: SafeArea(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ValueListenableBuilder<MobileScannerState>(
                        valueListenable: _driver.controller,
                        builder: (context, state, _) => GlassPanel(
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.zoom_out,
                                size: 20,
                                color: XentinelTheme.steel,
                              ),
                              Expanded(
                                child: Slider(
                                  value: state.zoomScale.clamp(0.0, 1.0),
                                  onChanged: (value) =>
                                      unawaited(_setZoom(value)),
                                  semanticFormatterCallback: (value) =>
                                      'Zoom ${(value * 100).round()} %',
                                ),
                              ),
                              const Icon(
                                Icons.zoom_in,
                                size: 20,
                                color: XentinelTheme.steel,
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      GlassPanel(
                        padding: const EdgeInsets.all(6),
                        child: SegmentedButton<bool>(
                          showSelectedIcon: false,
                          segments: const [
                            ButtonSegment(
                              value: false,
                              label: Text('ENTRADA'),
                              icon: Icon(Icons.login),
                            ),
                            ButtonSegment(
                              value: true,
                              label: Text('SALIDA'),
                              icon: Icon(Icons.logout),
                            ),
                          ],
                          selected: {_exitMode},
                          onSelectionChanged: _busy
                              ? null
                              : (s) => setState(() => _exitMode = s.first),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            if (_camera.canScan && _busy && result == null)
              const Positioned.fill(
                child: ColoredBox(
                  color: Color(0xB306141B),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text('Validando acceso…'),
                      ],
                    ),
                  ),
                ),
              ),
            // Resultado (semáforo)
            if (_camera.canScan && result != null)
              Positioned.fill(
                child: TweenAnimationBuilder<double>(
                  key: ValueKey(result),
                  tween: Tween(begin: 0.94, end: 1),
                  duration: const Duration(milliseconds: 220),
                  curve: Curves.easeOutBack,
                  builder: (context, scale, child) =>
                      Transform.scale(scale: scale, child: child),
                  child: _ResultOverlay(result: result, icon: _iconFor(result)),
                ),
              ),
            if (!_camera.canScan)
              Positioned.fill(
                child: ColoredBox(
                  color: XentinelTheme.ink,
                  child: _cameraStatus(),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Indicaciones de lectura y estado de la conexión.
class _ScannerHint extends StatelessWidget {
  const _ScannerHint({required this.online});
  final bool online;

  @override
  Widget build(BuildContext context) {
    final text = online
        ? 'Carnet a 20–30 cm. Toca para enfocar y pellizca para acercar.'
        : 'Sin conexión: el escáner necesita internet para validar carnets.';
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          Icon(
            online ? Icons.center_focus_strong : Icons.cloud_off,
            size: 18,
            color: online ? XentinelTheme.mist : XentinelTheme.warning,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 13, color: XentinelTheme.text),
            ),
          ),
        ],
      ),
    );
  }
}

/// Marco guía con una línea que recorre el área de lectura.
class _ScanFrame extends StatefulWidget {
  const _ScanFrame();
  @override
  State<_ScanFrame> createState() => _ScanFrameState();
}

class _ScanFrameState extends State<_ScanFrame>
    with SingleTickerProviderStateMixin {
  late final _line = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (motionEnabled(context) && !_line.isAnimating) {
      _line.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _line.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Stack(
      alignment: Alignment.center,
      children: [
        const Positioned.fill(child: CustomPaint(painter: _ScanFramePainter())),
        if (motionEnabled(context))
          AnimatedBuilder(
            animation: _line,
            builder: (context, _) => Transform.translate(
              offset: Offset(
                0,
                (Curves.easeInOut.transform(_line.value) - 0.5) *
                    (_ScanFramePainter._side - 44),
              ),
              child: Container(
                width: _ScanFramePainter._side - 36,
                height: 2,
                decoration: BoxDecoration(
                  color: XentinelTheme.text,
                  boxShadow: [
                    BoxShadow(
                      color: XentinelTheme.mist.withValues(alpha: 0.6),
                      blurRadius: 14,
                      spreadRadius: 1,
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

class _ScanFramePainter extends CustomPainter {
  const _ScanFramePainter();
  static const _side = 256.0;
  static const _radius = 20.0;
  static const _arm = 44.0;

  @override
  void paint(Canvas canvas, Size size) {
    final frame = Rect.fromCenter(
      center: size.center(Offset.zero),
      width: _side,
      height: _side,
    );
    final rrect = RRect.fromRectAndRadius(
      frame,
      const Radius.circular(_radius),
    );
    canvas.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRect(Offset.zero & size),
        Path()..addRRect(rrect),
      ),
      Paint()..color = const Color(0x9906141B),
    );
    final corners = Path()
      // Superior izquierda
      ..moveTo(frame.left, frame.top + _arm)
      ..lineTo(frame.left, frame.top + _radius)
      ..arcToPoint(
        Offset(frame.left + _radius, frame.top),
        radius: const Radius.circular(_radius),
      )
      ..lineTo(frame.left + _arm, frame.top)
      // Superior derecha
      ..moveTo(frame.right - _arm, frame.top)
      ..lineTo(frame.right - _radius, frame.top)
      ..arcToPoint(
        Offset(frame.right, frame.top + _radius),
        radius: const Radius.circular(_radius),
      )
      ..lineTo(frame.right, frame.top + _arm)
      // Inferior derecha
      ..moveTo(frame.right, frame.bottom - _arm)
      ..lineTo(frame.right, frame.bottom - _radius)
      ..arcToPoint(
        Offset(frame.right - _radius, frame.bottom),
        radius: const Radius.circular(_radius),
      )
      ..lineTo(frame.right - _arm, frame.bottom)
      // Inferior izquierda
      ..moveTo(frame.left + _arm, frame.bottom)
      ..lineTo(frame.left + _radius, frame.bottom)
      ..arcToPoint(
        Offset(frame.left, frame.bottom - _radius),
        radius: const Radius.circular(_radius),
      )
      ..lineTo(frame.left, frame.bottom - _arm);
    canvas.drawPath(
      corners,
      Paint()
        ..color = XentinelTheme.text
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(_ScanFramePainter oldDelegate) => false;
}

class _ResultOverlay extends StatelessWidget {
  const _ResultOverlay({required this.result, required this.icon});

  final AccessScanResult result;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final bg = result.color;
    final fg = ThemeData.estimateBrightnessForColor(bg) == Brightness.light
        ? Colors.black
        : Colors.white;
    final user = result.user;
    final reason = switch (result) {
      Denied(:final reason) => reason,
      Alert(:final reason) => reason,
      Unconfirmed(:final reason) => reason,
      _ => null,
    };

    return Container(
      color: bg,
      padding: const EdgeInsets.all(32),
      child: Center(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 110, color: fg),
              const SizedBox(height: 20),
              Text(
                result.message,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 34,
                  height: 1.05,
                  letterSpacing: -0.6,
                  fontWeight: FontWeight.w800,
                  color: fg,
                ),
              ),
              if (user != null) ...[
                const SizedBox(height: 28),
                Text(
                  user.name,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: fg,
                  ),
                ),
                Text(
                  user.role.dbValue,
                  style: TextStyle(color: fg.withValues(alpha: 0.8)),
                ),
              ],
              if (result case Granted(:final person?)) ...[
                const SizedBox(height: 24),
                Text(
                  person.name,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
                const SizedBox(height: 10),
                for (final line in [
                  if (person.document.isNotEmpty) person.document,
                  if (person.ficha != null) 'Ficha ${person.ficha}',
                  if (person.aula != null) 'Aula: ${person.aula}',
                ])
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      line,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 17, color: fg),
                    ),
                  ),
              ],
              if (result case Denied(:final person?)) ...[
                const SizedBox(height: 18),
                Text(
                  person.name,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ],
              if (reason != null) ...[
                const SizedBox(height: 14),
                Text(
                  reason,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 19,
                    height: 1.3,
                    fontWeight: FontWeight.w500,
                    color: fg,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

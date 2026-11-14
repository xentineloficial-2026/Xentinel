import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';

enum CameraPhase {
  checking,
  denied,
  blocked,
  restricted,
  starting,
  ready,
  paused,
  unavailable,
  failed,
}

abstract interface class CameraPermissions {
  Future<PermissionStatus> check();
  Future<PermissionStatus> request();
  Future<bool> openSettings();
}

class DeviceCameraPermissions implements CameraPermissions {
  @override
  Future<PermissionStatus> check() => Permission.camera.status;
  @override
  Future<PermissionStatus> request() => Permission.camera.request();
  @override
  Future<bool> openSettings() => openAppSettings();
}

final cameraPermissionsProvider = Provider<CameraPermissions>(
  (_) => DeviceCameraPermissions(),
);

abstract interface class CameraDriver {
  Future<void> start();
  Future<void> stop();
  Future<void> dispose();
}

/// Cámara configurada para leer el carnet en la pantalla de otro teléfono.
///
/// - 1280×720 en Android: suficiente detalle para un QR de 29×29 módulos a 20–40 cm
///   y análisis rápido incluso en teléfonos modestos (1080p satura el decodificador
///   y aumenta la latencia; 640×480 pierde módulos con moiré).
/// - Zoom automático de ML Kit (Android): si el código se ve pequeño, acerca la
///   imagen; así la persona puede alejar el teléfono más allá de la distancia
///   mínima de enfoque, que es la causa principal de lecturas fallidas
///   de pantalla a pantalla.
/// - Solo formato QR y 250 ms entre resultados repetidos: menos trabajo por cuadro.
class MobileScannerDriver implements CameraDriver {
  final controller = MobileScannerController(
    autoStart: false,
    formats: const [BarcodeFormat.qrCode],
    detectionSpeed: DetectionSpeed.normal,
    detectionTimeoutMs: 250,
    cameraResolution: const Size(1280, 720),
    autoZoom: true,
    facing: CameraFacing.back,
  );

  @override
  Future<void> start() async {
    // Let the permission-gated preview mount before starting its controller.
    await WidgetsBinding.instance.endOfFrame;
    await controller.start();
    // Native initialization failures are also reported through controller.value.
    final error = controller.value.error;
    if (error != null) throw error;
    if (!controller.value.isRunning) throw StateError('Camera did not start');
  }

  @override
  Future<void> stop() => controller.stop();

  @override
  Future<void> dispose() => controller.dispose();
}

/// A single native queue also protects rapid pop/push between scanner routes:
/// an old controller must finish releasing the camera before a new one starts.
class CameraSession extends ChangeNotifier {
  CameraSession({required this.driver, required this.permissions});

  final CameraDriver driver;
  final CameraPermissions permissions;
  static Future<void>? _nativeQueue;
  @visibleForTesting
  static Future<void> waitForIdle() => _nativeQueue ?? Future<void>.value();

  static Future<void> _schedule(Future<void> Function() action) {
    final previous = _nativeQueue;
    final work = previous == null
        ? Future<void>.microtask(action)
        : previous.then((_) => action());
    _nativeQueue = work;
    // Release the completed chain; only pending native work owns the queue.
    unawaited(
      work.then((_) {
        if (identical(_nativeQueue, work)) _nativeQueue = null;
      }),
    );
    return work;
  }

  CameraPhase phase = CameraPhase.checking;
  bool _active = false;
  bool _visible = true;
  bool _closed = false;
  bool _requestPermission = false;
  bool _running = false;
  bool previewMounted = false;
  Timer? _startWatchdog;

  bool get canScan =>
      !_closed && _active && _visible && phase == CameraPhase.ready;

  Future<void> setActive(bool value) {
    _active = value;
    return _enqueue(_sync);
  }

  Future<void> setVisible(bool value) {
    _visible = value;
    return _enqueue(_sync);
  }

  Future<void> requestAccess() {
    _requestPermission = true;
    return _enqueue(_sync);
  }

  Future<void> retry() => _enqueue(() async {
    await driver.stop();
    _running = false;
    await _sync();
  });

  Future<bool> openSettings() => permissions.openSettings();

  Future<void> _enqueue(Future<void> Function() action) {
    return _schedule(() async {
      if (_closed) return;
      try {
        await action();
      } catch (error) {
        _fail(error);
      }
    });
  }

  void _setPhase(CameraPhase next) {
    if (_closed || phase == next) return;
    phase = next;
    notifyListeners();
  }

  Future<void> _sync() async {
    if (_closed) return;
    if (!_active || !_visible) {
      await driver.stop();
      _running = false;
      _setPhase(CameraPhase.paused);
      return;
    }
    if (_running) return;
    _setPhase(CameraPhase.checking);
    var permission = await permissions.check();
    if (_closed || !_active || !_visible) return;
    if (_requestPermission) {
      _requestPermission = false;
      if (permission.isDenied) permission = await permissions.request();
    }
    if (_closed) return;
    if (!permission.isGranted) {
      _setPhase(
        permission.isPermanentlyDenied
            ? CameraPhase.blocked
            : permission.isRestricted
            ? CameraPhase.restricted
            : CameraPhase.denied,
      );
      return;
    }
    // The system permission sheet can itself move the app to inactive.
    if (!_active || !_visible) {
      _setPhase(CameraPhase.paused);
      return;
    }
    previewMounted = true;
    _setPhase(CameraPhase.starting);
    _startWatchdog = Timer(
      const Duration(seconds: 15),
      () => _setPhase(CameraPhase.failed),
    );
    try {
      await driver.start();
      _running = true;
    } finally {
      _startWatchdog?.cancel();
    }
    if (_closed || !_active || !_visible) {
      await driver.stop();
      _running = false;
      _setPhase(CameraPhase.paused);
      return;
    }
    _setPhase(CameraPhase.ready);
  }

  void _fail(Object error) {
    _startWatchdog?.cancel();
    _running = false;
    if (error is MobileScannerException) {
      _setPhase(switch (error.errorCode) {
        MobileScannerErrorCode.permissionDenied => CameraPhase.blocked,
        MobileScannerErrorCode.unsupported => CameraPhase.unavailable,
        _ => CameraPhase.failed,
      });
    } else {
      _setPhase(CameraPhase.failed);
    }
  }

  @override
  void dispose() {
    if (_closed) return;
    _closed = true;
    _startWatchdog?.cancel();
    unawaited(
      _schedule(() async {
        try {
          try {
            await driver.stop();
          } finally {
            await driver.dispose();
          }
        } catch (_) {
          /* A failed release must not poison the next route. */
        }
      }),
    );
    super.dispose();
  }
}

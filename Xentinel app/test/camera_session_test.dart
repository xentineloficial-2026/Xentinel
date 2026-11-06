import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:xentinel/services/camera_session.dart';

class FakePermissions implements CameraPermissions {
  PermissionStatus status = PermissionStatus.denied;
  PermissionStatus requested = PermissionStatus.granted;
  int requests = 0;
  @override
  Future<PermissionStatus> check() async => status;
  @override
  Future<PermissionStatus> request() async {
    requests++;
    return status = requested;
  }

  @override
  Future<bool> openSettings() async => true;
}

class FakeDriver implements CameraDriver {
  final calls = <String>[];
  Completer<void>? pendingStart;
  Object? failure;
  @override
  Future<void> start() async {
    calls.add('start');
    await pendingStart?.future;
    if (failure != null) throw failure!;
  }

  @override
  Future<void> stop() async {
    calls.add('stop');
  }

  @override
  Future<void> dispose() async {
    calls.add('dispose');
  }
}

void main() {
  late FakeDriver driver;
  late FakePermissions permissions;
  late CameraSession session;
  setUp(() {
    driver = FakeDriver();
    permissions = FakePermissions();
    session = CameraSession(driver: driver, permissions: permissions);
  });
  tearDown(() async {
    session.dispose();
    await Future<void>.delayed(Duration.zero);
  });

  test(
    'never initializes before explicit permission; handles permanent denial',
    () async {
      await session.setActive(true);
      expect(session.phase, CameraPhase.denied);
      expect(driver.calls, isEmpty);
      expect(permissions.requests, 0);
      permissions.requested = PermissionStatus.permanentlyDenied;
      await session.requestAccess();
      expect(session.phase, CameraPhase.blocked);
      expect(driver.calls, isEmpty);
      await session.requestAccess();
      expect(permissions.requests, 1);
    },
  );

  test(
    'returns from Settings, starts, pauses, rechecks revoked permission',
    () async {
      await session.setActive(true);
      permissions.status = PermissionStatus.granted;
      await session.setActive(true);
      expect(session.canScan, isTrue);
      await session.setActive(false);
      expect(session.canScan, isFalse);
      permissions.status = PermissionStatus.permanentlyDenied;
      await session.setActive(true);
      expect(session.phase, CameraPhase.blocked);
      expect(driver.calls.where((c) => c == 'start'), hasLength(1));
    },
  );

  test('serializes a pause arriving during native initialization', () async {
    permissions.status = PermissionStatus.granted;
    driver.pendingStart = Completer<void>();
    final starting = session.setActive(true);
    await Future<void>.delayed(Duration.zero);
    final stopping = session.setActive(false);
    expect(driver.calls, ['start']);
    driver.pendingStart!.complete();
    await Future.wait([starting, stopping]);
    expect(session.phase, CameraPhase.paused);
    expect(
      driver.calls.indexOf('stop'),
      greaterThan(driver.calls.indexOf('start')),
    );
  });

  test('repeated resumes cannot start camera twice', () async {
    permissions.status = PermissionStatus.granted;
    await Future.wait([
      session.setActive(true),
      session.setActive(true),
      session.setActive(true),
    ]);
    expect(driver.calls, ['start']);
    await session.setVisible(false);
    expect(session.canScan, isFalse);
    await session.setVisible(true);
    expect(driver.calls.where((c) => c == 'start'), hasLength(2));
  });

  test('unavailable camera is reported and retry recovers', () async {
    permissions.status = PermissionStatus.granted;
    driver.failure = const MobileScannerException(
      errorCode: MobileScannerErrorCode.unsupported,
    );
    await session.setActive(true);
    expect(session.phase, CameraPhase.unavailable);
    driver.failure = null;
    await session.retry();
    expect(session.phase, CameraPhase.ready);
  });

  test(
    'rapid route replacement releases the old camera before starting new one',
    () async {
      permissions.status = PermissionStatus.granted;
      driver.pendingStart = Completer<void>();
      final first = session.setActive(true);
      await Future<void>.delayed(Duration.zero);
      session.dispose();
      final nextDriver = FakeDriver();
      final next = CameraSession(driver: nextDriver, permissions: permissions);
      final second = next.setActive(true);
      expect(nextDriver.calls, isEmpty);
      driver.pendingStart!.complete();
      await Future.wait([first, second]);
      expect(driver.calls.last, 'dispose');
      expect(nextDriver.calls, ['start']);
      next.dispose();
      await Future<void>.delayed(Duration.zero);
    },
  );
}

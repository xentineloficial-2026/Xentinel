import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:xentinel/app.dart';
import 'package:xentinel/core/router.dart';
import 'package:xentinel/core/session.dart';
import 'package:xentinel/models/xentinel_models.dart';
import 'package:xentinel/providers/alerts_provider.dart';
import 'package:xentinel/repositories/alerts_repository.dart';
import 'package:xentinel/services/api_client.dart';
import 'package:xentinel/services/camera_session.dart';
import 'package:xentinel/screens/carnet_screen.dart';
import 'package:xentinel/screens/alerts_screen.dart';
import 'package:xentinel/screens/scanner_screen.dart';

class TestPermissions implements CameraPermissions {
  PermissionStatus status = PermissionStatus.denied;
  @override
  Future<PermissionStatus> check() async => status;
  @override
  Future<PermissionStatus> request() async => status = PermissionStatus.granted;
  @override
  Future<bool> openSettings() async => true;
}

/// Exercises the real scanner widget/controller without a physical camera.
class TestCameraPlatform extends MobileScannerPlatform {
  int starts = 0;
  int stops = 0;
  int disposals = 0;
  @override
  Stream<BarcodeCapture?> get barcodesStream => const Stream.empty();
  @override
  Stream<TorchState> get torchStateStream => const Stream.empty();
  @override
  Stream<double> get zoomScaleStateStream => const Stream.empty();
  @override
  Widget buildCameraView() =>
      const ColoredBox(key: Key('native-preview'), color: Colors.grey);
  @override
  Future<MobileScannerViewAttributes> start(StartOptions options) async {
    starts++;
    return const MobileScannerViewAttributes(
      cameraDirection: CameraFacing.back,
      currentTorchMode: TorchState.unavailable,
      size: Size(640, 480),
      initialDeviceOrientation: DeviceOrientation.portraitUp,
    );
  }

  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<void> dispose() async {
    disposals++;
  }

  @override
  Future<void> updateScanWindow(Rect? window) async {}
}

void main() {
  late ProviderContainer container;
  late SessionStore session;
  late TestPermissions permissions;
  late TestCameraPlatform platform;
  late MobileScannerPlatform originalPlatform;
  bool disposed = false;
  final requests = <http.Request>[];

  setUp(() {
    disposed = false;
    requests.clear();
    session = SessionStore();
    permissions = TestPermissions();
    originalPlatform = MobileScannerPlatform.instance;
    platform = TestCameraPlatform();
    MobileScannerPlatform.instance = platform;
    final api = ApiClient(
      session,
      baseUrl: 'https://api.example.test/api/v1',
      client: MockClient((request) async {
        requests.add(request);
        if (request.url.path.endsWith('/auth/logout')) {
          return http.Response('', 204);
        }
        return http.Response(
          jsonEncode({
            'data': request.url.path.endsWith('/alertas/activas') ? [] : {},
          }),
          200,
        );
      }),
    );
    container = ProviderContainer(
      overrides: [
        sessionProvider.overrideWith((_) => session),
        apiClientProvider.overrideWithValue(api),
        cameraPermissionsProvider.overrideWithValue(permissions),
        alertsProvider.overrideWith((ref) {
          ref.watch(sessionProvider.select((session) => session.token));
          return AlertsMonitor(
            AlertsRepository(api),
            session,
            enableEvents: false,
          );
        }),
      ],
    );
    addTearDown(api.close);
  });
  tearDown(() {
    if (!disposed) container.dispose();
    MobileScannerPlatform.instance = originalPlatform;
  });

  void signIn([UserRole role = UserRole.guardia]) => session.signIn(
    UserEntity(
      id: '7',
      name: 'María Rodríguez',
      documentId: '1007',
      role: role,
      status: AccessStatus.permitido,
    ),
    'test-token',
    900,
  );

  Future<void> mount(WidgetTester tester) async {
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const XentinelApp(),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
    disposed = true;
    await tester.pumpAndSettle();
    await CameraSession.waitForIdle();
  }

  testWidgets('public recovery link submits email and returns to login', (
    tester,
  ) async {
    await mount(tester);
    expect(find.text('Nos alegra tenerte aquí'), findsOneWidget);
    await tester.ensureVisible(find.text('¿Olvidaste tu contraseña?'));
    await tester.tap(find.text('¿Olvidaste tu contraseña?'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'maria@example.test');
    await tester.tap(find.text('Enviar enlace'));
    await tester.pumpAndSettle();
    expect(find.text('Revisa tu correo'), findsOneWidget);
    expect(requests.single.url.path, '/api/v1/auth/olvide-contrasena');
    await tester.tap(find.text('Volver al inicio de sesión'));
    await tester.pumpAndSettle();
    expect(
      container.read(routerProvider).routeInformationProvider.value.uri.path,
      '/login',
    );
    await unmount(tester);
  });

  testWidgets(
    'auth and role guards protect deep links; expiration returns to login',
    (tester) async {
      await mount(tester);
      final router = container.read(routerProvider);
      router.go('/scanner');
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/login');
      signIn(UserRole.aprendiz);
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/home');
      expect(find.textContaining('María'), findsOneWidget);
      expect(find.text('Escáner de acceso'), findsNothing);
      router.go('/scanner');
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/home');
      session.expire();
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/login');
      expect(find.text('Tu sesión venció. Vuelve a ingresar.'), findsOneWidget);
      await unmount(tester);
    },
  );

  testWidgets(
    'every signed-in destination opens and returns; unknown route recovers',
    (tester) async {
      signIn();
      await mount(tester);
      final router = container.read(routerProvider);
      for (final destination in {
        '/carnet': CarnetScreen,
        '/alerts': AlertsScreen,
        '/scanner': ScannerScreen,
      }.entries) {
        router.push(destination.key);
        await tester.pumpAndSettle();
        expect(find.byType(destination.value), findsOneWidget);
        expect(tester.takeException(), isNull);
        expect(router.canPop(), isTrue);
        router.pop();
        await tester.pumpAndSettle();
        expect(router.routeInformationProvider.value.uri.path, '/home');
      }
      router.go('/ruta-inexistente');
      await tester.pumpAndSettle();
      expect(find.text('Esta pantalla ya no está disponible.'), findsOneWidget);
      await tester.tap(find.text('Volver al inicio'));
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/home');
      await tester.ensureVisible(find.text('Cerrar sesión'));
      await tester.tap(find.text('Cerrar sesión'));
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/login');
      expect(requests.any((r) => r.url.path.endsWith('/auth/logout')), isTrue);
      await unmount(tester);
    },
  );

  testWidgets(
    'preview starts only after permission; route cover and app pause release camera',
    (tester) async {
      signIn();
      await mount(tester);
      final router = container.read(routerProvider);
      router.push('/scanner');
      await tester.pumpAndSettle();
      expect(platform.starts, 0);
      expect(find.byType(MobileScanner), findsNothing);
      await tester.tap(find.text('Permitir cámara'));
      await tester.pumpAndSettle();
      expect(platform.starts, 1);
      expect(find.byKey(const Key('native-preview')), findsOneWidget);
      router.push('/alerts');
      await tester.pumpAndSettle();
      expect(platform.stops, 1);
      router.pop();
      await tester.pumpAndSettle();
      expect(platform.starts, 2);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pumpAndSettle();
      expect(platform.stops, 2);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(platform.starts, 3);
      router.pop();
      await tester.pumpAndSettle();
      expect(platform.disposals, 1);
      await unmount(tester);
    },
  );

  testWidgets(
    'small phone and enlarged text keep every screen free of overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 1.4;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await mount(tester);
      final router = container.read(routerProvider);
      for (final route in ['/login', '/forgot-password']) {
        router.go(route);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: route);
      }
      signIn();
      await tester.pumpAndSettle();
      for (final route in ['/home', '/carnet', '/alerts', '/scanner']) {
        router.go(route);
        // A first-query progress indicator may animate while route callbacks run.
        for (var frame = 0; frame < 10; frame++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(tester.takeException(), isNull, reason: route);
      }
      await unmount(tester);
    },
  );
}

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
import 'package:xentinel/services/biometric_service.dart';
import 'package:xentinel/services/credential_store.dart';
import 'package:xentinel/services/network_status.dart';
import 'package:xentinel/services/screen_brightness_service.dart';
import 'package:qr_flutter/qr_flutter.dart';

import 'support/fakes.dart';

class ApprovingBiometrics extends BiometricService {
  int calls = 0;
  @override
  Future<bool> authenticate() async {
    calls++;
    return true;
  }
}

QrCredential credentialFor7() => QrCredential(
  userId: 7,
  name: 'María Rodríguez',
  documentId: '1007',
  role: UserRole.aprendiz,
  status: AccessStatus.permitido,
  key: Uint8List.fromList(List.filled(32, 5)),
  stepSeconds: 15,
  issuedAt: DateTime.now(),
);

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
  late FakeBrightness brightness;
  late ApprovingBiometrics biometrics;
  late FakeConnectivity connectivity;
  bool disposed = false;
  final requests = <http.Request>[];
  // Alarmas de escaneo que devuelve el servidor simulado.
  var scanAlarms = <Object>[];

  setUp(() {
    disposed = false;
    requests.clear();
    scanAlarms = [];
    session = SessionStore();
    permissions = TestPermissions();
    brightness = FakeBrightness();
    biometrics = ApprovingBiometrics();
    connectivity = FakeConnectivity();
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
        if (request.url.path.endsWith('/alarmas')) {
          // UTF-8 como el servidor: los textos llevan tildes.
          return http.Response(
            jsonEncode({'data': scanAlarms}),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response(
          jsonEncode({
            'data':
                request.url.path.endsWith('/alertas/activas') ||
                    request.url.path.endsWith('/alarmas')
                ? []
                : {},
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
        connectivitySourceProvider.overrideWithValue(connectivity),
        secureStoreProvider.overrideWithValue(MemorySecureStore()),
        brightnessControlProvider.overrideWithValue(brightness),
        biometricServiceProvider.overrideWithValue(biometrics),
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

  testWidgets('public recovery sends a code, verifies it and sets a password', (
    tester,
  ) async {
    await mount(tester);
    expect(find.text('Nos alegra tenerte aquí'), findsOneWidget);
    await tester.ensureVisible(find.text('¿Olvidaste tu contraseña?'));
    await tester.tap(find.text('¿Olvidaste tu contraseña?'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'maria@example.test');
    await tester.tap(find.text('Enviar código'));
    await tester.pumpAndSettle();
    expect(find.text('Escribe tu código'), findsOneWidget);
    // Solo dígitos y como máximo seis.
    await tester.enterText(find.byType(TextFormField), '48a29150');
    await tester.tap(find.text('Verificar código'));
    await tester.pumpAndSettle();
    expect(find.text('Crea tu nueva contraseña'), findsOneWidget);
    await tester.enterText(
      find.byType(TextFormField).at(0),
      'Nueva-Clave-2026',
    );
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'Nueva-Clave-2026',
    );
    await tester.tap(find.text('Guardar contraseña'));
    await tester.pumpAndSettle();
    expect(find.text('Contraseña actualizada'), findsOneWidget);
    expect(requests.map((request) => request.url.path), [
      '/api/v1/auth/olvide-contrasena',
      '/api/v1/auth/validar-recuperacion',
      '/api/v1/auth/restablecer-contrasena',
    ]);
    expect(jsonDecode(requests[1].body), {
      'correo': 'maria@example.test',
      'codigo': '482915',
    });
    expect(jsonDecode(requests[2].body)['contrasena'], 'Nueva-Clave-2026');
    await tester.tap(find.text('Iniciar sesión'));
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
      // Sin barra inferior: los accesos viven una sola vez en el inicio, y el
      // escáner es la acción principal del personal de control.
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.text('Inicio'), findsNothing);
      expect(find.text('Escáner de acceso'), findsOneWidget);
      expect(find.text('Mi carnet digital'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('Escáner de acceso')).dy,
        lessThan(tester.getTopLeft(find.text('Mi carnet digital')).dy),
      );
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
      // Cerrar sesión pide confirmación: un toque accidental no saca a nadie.
      await tester.tap(find.byTooltip('Cerrar sesión'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/home');
      await tester.tap(find.byTooltip('Cerrar sesión'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Cerrar sesión'));
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/login');
      expect(requests.any((r) => r.url.path.endsWith('/auth/logout')), isTrue);
      // El servidor revoca el carnet al cerrar sesión: no queda guardado.
      expect(container.read(credentialStoreProvider).current, isNull);
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
    'signed carnet shows a large Q-level code at full brightness and restores it',
    (tester) async {
      signIn();
      await mount(tester);
      await container.read(credentialStoreProvider).save(credentialFor7());
      final router = container.read(routerProvider);
      router.push('/carnet');
      await tester.pumpAndSettle();
      expect(brightness.maximized, 1);
      final view = tester.widget<QrImageView>(find.byType(QrImageView));
      expect(view.gapless, isTrue);
      expect(view.backgroundColor, Colors.white);
      expect(tester.getSize(find.byType(QrImageView)).width, greaterThan(250));
      expect(find.textContaining('Carnet firmado'), findsOneWidget);
      router.pop();
      await tester.pumpAndSettle();
      expect(brightness.restored, 1);
      await unmount(tester);
    },
  );

  testWidgets(
    'QR works only online: no offline carnet, and the carnet waits for a connection',
    (tester) async {
      await mount(tester);
      expect(find.textContaining('sin conexión'), findsNothing);
      final router = container.read(routerProvider);
      signIn(UserRole.aprendiz);
      await tester.pumpAndSettle();
      router.go('/carnet-offline');
      await tester.pumpAndSettle();
      expect(find.text('Esta pantalla ya no está disponible.'), findsOneWidget);
      router.go('/home');
      await tester.pumpAndSettle();
      await container.read(credentialStoreProvider).save(credentialFor7());
      connectivity.set(false);
      router.push('/carnet');
      await tester.pumpAndSettle();
      expect(find.text('Sin conexión'), findsOneWidget);
      expect(find.byType(QrImageView), findsNothing);
      connectivity.set(true);
      await tester.pumpAndSettle();
      expect(find.byType(QrImageView), findsOneWidget);
      expect(find.text('Sin conexión'), findsNothing);
      await unmount(tester);
    },
  );

  testWidgets(
    'guards see QR alarms on the semáforo and can mark them as reviewed',
    (tester) async {
      scanAlarms = [
        {
          'id': 'qr-5',
          'origen': 'qr',
          'semaforo': 'rojo',
          'titulo': 'Carnet QR no verídico',
          'detalle': 'La firma no corresponde a ningún carnet vigente.',
          'fecha': DateTime.now().toUtc().toIso8601String(),
          'id_alarma': 5,
          'tipo_movimiento': 'ENTRADA',
          'id_reclamado': 7,
          'titular': null,
          'registrado_por': 'Andrés García',
        },
      ];
      signIn();
      await mount(tester);
      expect(find.text('1 alarma activa'), findsOneWidget);
      expect(find.text('1 en rojo'), findsOneWidget);
      await tester.tap(find.text('1 alarma activa'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertsScreen), findsOneWidget);
      expect(find.text('Carnet QR no verídico'), findsOneWidget);
      expect(find.text('ID 7'), findsOneWidget);
      scanAlarms = [];
      await tester.ensureVisible(find.text('Marcar como revisada'));
      await tester.tap(find.text('Marcar como revisada'));
      await tester.pumpAndSettle();
      expect(
        requests.any(
          (r) =>
              r.method == 'PATCH' &&
              r.url.path.endsWith('/alarmas/qr/5/atender'),
        ),
        isTrue,
      );
      expect(find.text('Carnet QR no verídico'), findsNothing);
      await unmount(tester);
    },
  );

  testWidgets('scanner without network says it needs internet', (tester) async {
    signIn();
    permissions.status = PermissionStatus.granted;
    await mount(tester);
    connectivity.set(false);
    container.read(routerProvider).push('/scanner');
    await tester.pumpAndSettle();
    expect(find.textContaining('el escáner necesita internet'), findsOneWidget);
    expect(find.byTooltip('Registros sin conexión'), findsNothing);
    await unmount(tester);
  });

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
      await container.read(credentialStoreProvider).save(credentialFor7());
      permissions.status = PermissionStatus.granted;
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

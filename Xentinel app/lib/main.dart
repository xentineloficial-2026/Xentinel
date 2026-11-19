import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/server_clock.dart';
import 'services/seismic_alerts.dart';
import 'services/server_settings.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // En producción un error de dibujo muestra un aviso sobrio en vez de la pantalla
  // de depuración; el detalle técnico nunca se enseña a la persona.
  if (kReleaseMode) {
    ErrorWidget.builder = (_) => const Material(
      color: Color(0xFF06141B),
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'No se pudo mostrar esta sección. Vuelve atrás e intenta de nuevo.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFFEDF0EF)),
          ),
        ),
      ),
    );
  }
  await Future.wait([
    ServerSettings.load(),
    ServerClock.load(),
    SeismicAlerts.initializeFirebase(),
  ]);
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light);
  runApp(const ProviderScope(child: XentinelApp()));
}

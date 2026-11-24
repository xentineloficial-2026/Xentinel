import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/qr_codes.dart';
import '../core/server_clock.dart';
import '../core/session.dart';
import '../models/xentinel_models.dart';
import '../services/credential_store.dart';

/// Usuario de la sesión REST; cambia tras el login, logout o vencimiento del JWT.
final currentUserProvider = Provider<UserEntity?>(
  (ref) => ref.watch(sessionProvider).user,
);

/// Estado del carnet digital.
class CarnetState {
  const CarnetState({
    required this.qrPayload,
    required this.generatedAt,
    required this.refreshAt,
    this.signed = false,
  });

  const CarnetState.empty()
    : qrPayload = '',
      generatedAt = null,
      refreshAt = null,
      signed = false;

  /// Contenido del QR: `XN2:<id>:<paso>:<firma>` (firmado) o el formato heredado
  /// `XENTINEL:<id>:<timestamp>` si el servidor aún no emite carnets firmados.
  final String qrPayload;

  /// Hora local en que se generó y en que se renovará (cuenta regresiva).
  final DateTime? generatedAt;
  final DateTime? refreshAt;

  /// Firmado con la clave del titular: el servidor verifica que es auténtico.
  final bool signed;

  bool get hasQr => qrPayload.isNotEmpty;
}

/// Genera el carnet y lo renueva en el borde de cada paso de 15 s según la hora
/// del servidor, así el código que se muestra siempre es el vigente para el lector.
/// Solo existe mientras una pantalla muestra el carnet: sin pantalla no hay temporizador.
abstract class _RotatingCarnet extends AutoDisposeNotifier<CarnetState> {
  static const Duration refreshInterval = Duration(
    seconds: XentinelQr.stepSeconds,
  );
  Timer? _timer;

  CarnetState _start(String Function(DateTime serverNow) code, bool signed) {
    _timer?.cancel();
    final serverNow = ServerClock.now();
    final untilNext = signed
        ? XentinelQr.nextStepAt(serverNow).difference(serverNow)
        : refreshInterval;
    final localNow = DateTime.now();
    // Un margen mínimo evita generar dos veces el mismo paso por redondeo.
    final wait = untilNext + const Duration(milliseconds: 40);
    _timer = Timer(wait, () => state = _start(code, signed));
    return CarnetState(
      qrPayload: code(serverNow),
      generatedAt: localNow,
      refreshAt: localNow.add(untilNext),
      signed: signed,
    );
  }

  void _stop() {
    _timer?.cancel();
    _timer = null;
  }
}

/// Carnet del titular de la sesión.
class CarnetNotifier extends _RotatingCarnet {
  static const Duration refreshInterval = _RotatingCarnet.refreshInterval;

  @override
  CarnetState build() {
    // Se reconstruye (y reinicia el temporizador) si cambia el usuario o la clave.
    final user = ref.watch(currentUserProvider);
    final credential = ref.watch(
      credentialStoreProvider.select((store) => store.current),
    );
    ref.onDispose(_stop);
    _stop();
    if (user == null) return const CarnetState.empty();
    if (credential != null && '${credential.userId}' == user.id) {
      return _start(credential.codeAt, true);
    }
    // Servidor sin carnet firmado (o clave aún no descargada): formato heredado.
    return _start(
      (serverNow) => 'XENTINEL:${user.id}:${serverNow.millisecondsSinceEpoch}',
      false,
    );
  }
}

final carnetProvider =
    NotifierProvider.autoDispose<CarnetNotifier, CarnetState>(
      CarnetNotifier.new,
    );

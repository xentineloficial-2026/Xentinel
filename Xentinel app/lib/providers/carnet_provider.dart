import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/xentinel_models.dart';
import '../core/server_clock.dart';
import '../core/session.dart';

/// Usuario de la sesión REST; cambia tras el login, logout o vencimiento del JWT.
final currentUserProvider = Provider<UserEntity?>(
  (ref) => ref.watch(sessionProvider).user,
);

/// Estado del carnet digital.
class CarnetState {
  const CarnetState({required this.qrPayload, required this.generatedAt});

  const CarnetState.empty() : qrPayload = '', generatedAt = null;

  /// Contenido del QR: `XENTINEL:<id>:<timestamp>`.
  final String qrPayload;
  final DateTime? generatedAt;

  bool get hasQr => qrPayload.isNotEmpty;
}

/// Renueva el QR cada 15 segundos. El formato heredado no es una firma digital.
class CarnetNotifier extends Notifier<CarnetState> {
  static const Duration refreshInterval = Duration(seconds: 15);

  Timer? _timer;

  @override
  CarnetState build() {
    // Se reconstruye (y reinicia el timer) si cambia el usuario.
    final user = ref.watch(currentUserProvider);
    ref.onDispose(_cancelTimer);
    _cancelTimer();

    if (user == null) return const CarnetState.empty();

    _timer = Timer.periodic(refreshInterval, (_) => state = _generate(user));
    return _generate(user);
  }

  CarnetState _generate(UserEntity user) {
    // La marca del QR usa la hora del servidor para validarse en otro teléfono;
    // la cuenta regresiva de la pantalla sigue con el reloj local.
    final timestamp = ServerClock.now().millisecondsSinceEpoch;
    return CarnetState(
      qrPayload: 'XENTINEL:${user.id}:$timestamp',
      generatedAt: DateTime.now(),
    );
  }

  void _cancelTimer() {
    _timer?.cancel();
    _timer = null;
  }
}

final carnetProvider = NotifierProvider<CarnetNotifier, CarnetState>(
  CarnetNotifier.new,
);

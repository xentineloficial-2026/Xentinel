import 'package:audioplayers/audioplayers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:vibration/vibration.dart';

import '../models/xentinel_models.dart';

/// Vibración + sonido según el resultado del escaneo.
class FeedbackService {
  FeedbackService() {
    // Sonidos cortos: modo de baja latencia (SoundPool en Android) para que el
    // celador escuche el resultado en el mismo instante en que aparece.
    _player.setPlayerMode(PlayerMode.lowLatency).catchError((Object _) {});
    _player.setReleaseMode(ReleaseMode.stop).catchError((Object _) {});
  }

  final AudioPlayer _player = AudioPlayer();

  Future<void> emergency() async {
    try {
      await Vibration.vibrate(pattern: [0, 300, 150, 300]);
    } catch (_) {}
    try {
      await _player.stop();
      await _player.play(AssetSource('sounds/warn.wav'));
    } catch (_) {}
  }

  Future<void> play(AccessScanResult result) async {
    final (sound, pattern) = switch (result) {
      Granted() => ('sounds/ok.wav', <int>[0, 150]),
      Alert() => ('sounds/warn.wav', <int>[0, 200, 100, 200]),
      NotRegistered() => ('sounds/warn.wav', <int>[0, 200, 100, 200]),
      Denied() => ('sounds/error.wav', <int>[0, 500]),
      VisitorAccess() => ('sounds/ok.wav', <int>[0, 100, 80, 100]),
      Unconfirmed() => ('sounds/warn.wav', <int>[0, 200, 100, 200]),
      QueuedOffline() => ('sounds/ok.wav', <int>[0, 120, 90, 120, 90, 120]),
    };

    try {
      await Vibration.vibrate(pattern: pattern);
    } catch (_) {}
    try {
      await _player.stop();
      await _player.play(AssetSource(sound));
    } catch (_) {}
  }

  void dispose() => _player.dispose();
}

final feedbackServiceProvider = Provider<FeedbackService>((ref) {
  final service = FeedbackService();
  ref.onDispose(service.dispose);
  return service;
});

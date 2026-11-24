import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_config.dart';
import '../core/session.dart';
import '../repositories/auth_repository.dart';
import 'credential_store.dart';

/// Trabajo de mantenimiento mientras la app está abierta:
///
/// - Renueva el JWT al 75 % de su vigencia (el celador no pierde la sesión ni el
///   canal en tiempo real cada 15 minutos).
/// - Descarga la clave del carnet QR firmado del titular de la sesión. La clave vive
///   solo en memoria: el carnet existe mientras hay sesión y lo valida el servidor.
///
/// Todo es "mejor esfuerzo": un fallo de red se reintenta y nunca interrumpe la UI.
class BackgroundSync with WidgetsBindingObserver {
  BackgroundSync({
    required this.session,
    required this.auth,
    required this.credentials,
  });

  final SessionStore session;
  final AuthRepository auth;
  final CredentialStore credentials;

  Timer? _renewTimer;
  String? _scheduledToken;
  String? _credentialFor;
  bool _started = false;
  bool _closed = false;

  void start() {
    if (_started) return;
    _started = true;
    WidgetsBinding.instance.addObserver(this);
    session.addListener(_onSession);
    _onSession();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    final expiresAt = session.expiresAt;
    // Al volver del fondo con el token por vencer, renovarlo de inmediato.
    if (session.token != null &&
        expiresAt != null &&
        expiresAt.difference(DateTime.now()) < const Duration(minutes: 3)) {
      _renew(session.token!);
    }
    final user = session.user;
    if (user != null && '${credentials.current?.userId}' != user.id) {
      refreshCredential();
    }
  }

  void _onSession() {
    if (_closed) return;
    final token = session.token;
    if (token == null) {
      _renewTimer?.cancel();
      _scheduledToken = null;
      _credentialFor = null;
      return;
    }
    if (token != _scheduledToken) {
      _scheduledToken = token;
      _scheduleRenewal(token);
    }
    final user = session.user;
    if (user != null && _credentialFor != user.id) {
      _credentialFor = user.id;
      refreshCredential();
    }
  }

  void _scheduleRenewal(String token) {
    _renewTimer?.cancel();
    final issued = session.issuedAt;
    final expires = session.expiresAt;
    if (issued == null || expires == null) return;
    final lifetime = expires.difference(issued);
    var due = issued.add(lifetime * 3 ~/ 4).difference(DateTime.now());
    if (due < const Duration(seconds: 5)) due = const Duration(seconds: 5);
    _renewTimer = Timer(due, () => _renew(token));
  }

  Future<void> _renew(String token) async {
    if (_closed || session.token != token) return;
    try {
      final renewed = await auth.renew();
      if (session.token == token && renewed.user.id == session.user?.id) {
        session.renew(renewed.token, renewed.expiresIn);
      }
    } on ApiException catch (error) {
      // 401: la sesión venció o alcanzó su duración máxima (ApiClient la cierra).
      // 404: servidor sin renovación; la sesión vence normalmente.
      if (error.status == 401 || error.status == 404) return;
      _retryRenewal(token);
    } catch (_) {
      _retryRenewal(token);
    }
  }

  void _retryRenewal(String token) {
    if (_closed || session.token != token) return;
    final expires = session.expiresAt;
    if (expires == null) return;
    final left = expires.difference(DateTime.now());
    if (left < const Duration(seconds: 10)) return;
    final wait = left ~/ 3 < const Duration(seconds: 30)
        ? left ~/ 3
        : const Duration(seconds: 30);
    _renewTimer?.cancel();
    _renewTimer = Timer(wait, () => _renew(token));
  }

  /// Descarga la clave del carnet firmado del titular de la sesión.
  Future<void> refreshCredential() async {
    final user = session.user;
    if (_closed || user == null) return;
    try {
      final data = await auth.qrCredential();
      final credential = QrCredential.fromApi(data, user, DateTime.now());
      if (credential != null && session.user?.id == user.id) {
        await credentials.save(credential);
      }
    } on ApiException catch (error) {
      // Servidor anterior sin carnet firmado: se usa el formato heredado.
      if (error.status == 404 &&
          credentials.current?.userId.toString() == user.id) {
        await credentials.clear();
      }
      if (error.isConnectivity) _credentialFor = null;
    } catch (_) {
      _credentialFor = null;
    }
  }

  void dispose() {
    _closed = true;
    if (_started) WidgetsBinding.instance.removeObserver(this);
    session.removeListener(_onSession);
    _renewTimer?.cancel();
  }
}

final backgroundSyncProvider = Provider<BackgroundSync>((ref) {
  final sync = BackgroundSync(
    session: ref.read(sessionProvider),
    auth: ref.read(authRepositoryProvider),
    credentials: ref.read(credentialStoreProvider),
  )..start();
  ref.onDispose(sync.dispose);
  return sync;
});

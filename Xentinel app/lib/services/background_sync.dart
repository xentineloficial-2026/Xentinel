import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_config.dart';
import '../core/session.dart';
import '../repositories/access_repository.dart';
import '../repositories/auth_repository.dart';
import 'access_outbox.dart';
import 'credential_store.dart';
import 'network_status.dart';

/// Trabajo de mantenimiento mientras la app está abierta:
///
/// - Renueva el JWT al 75 % de su vigencia (el celador no pierde la sesión ni el
///   canal en tiempo real cada 15 minutos).
/// - Mantiene al día la credencial del carnet QR para usarlo sin conexión.
/// - Envía la cola de accesos sin conexión al recuperar la red, al volver la app
///   al frente y cada 30 s mientras queden pendientes.
///
/// Todo es "mejor esfuerzo": un fallo de red se reintenta y nunca interrumpe la UI.
class BackgroundSync with WidgetsBindingObserver {
  BackgroundSync({
    required this.session,
    required this.auth,
    required this.access,
    required this.outbox,
    required this.credentials,
    this.network,
    this.flushInterval = const Duration(seconds: 30),
  });

  final SessionStore session;
  final AuthRepository auth;
  final AccessRepository access;
  final AccessOutbox outbox;
  final CredentialStore credentials;
  final NetworkStatus? network;
  final Duration flushInterval;

  Timer? _renewTimer;
  Timer? _flushTimer;
  String? _scheduledToken;
  String? _credentialFor;
  StreamSubscription<void>? _restored;
  bool _started = false;
  bool _closed = false;

  void start() {
    if (_started) return;
    _started = true;
    WidgetsBinding.instance.addObserver(this);
    session.addListener(_onSession);
    outbox.addListener(_scheduleFlush);
    _restored = network?.restored.listen((_) => flush());
    _onSession();
    _scheduleFlush();
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
    // Mantiene vigente el carnet sin conexión (se oculta tras 30 días sin renovar).
    final user = session.user;
    final credential = credentials.current;
    if (user != null &&
        (credential == null ||
            '${credential.userId}' != user.id ||
            DateTime.now().difference(credential.issuedAt) >
                const Duration(days: 1))) {
      refreshCredential();
    }
    flush();
  }

  void _onSession() {
    if (_closed) return;
    final token = session.token;
    if (token == null) {
      _renewTimer?.cancel();
      _scheduledToken = null;
      _credentialFor = null;
      _scheduleFlush();
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
      flush();
    }
    _scheduleFlush();
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

  void _scheduleFlush() {
    if (_closed) return;
    final operator = session.user?.id;
    final hasPending =
        operator != null && outbox.pendingFor(operator).isNotEmpty;
    if (!hasPending) {
      _flushTimer?.cancel();
      _flushTimer = null;
      return;
    }
    _flushTimer ??= Timer.periodic(flushInterval, (_) => flush());
  }

  /// Envía la cola ahora si hay sesión y red.
  Future<int> flush() async {
    if (_closed || session.token == null || network?.online == false) return 0;
    return access.syncPending();
  }

  void dispose() {
    _closed = true;
    if (_started) WidgetsBinding.instance.removeObserver(this);
    session.removeListener(_onSession);
    outbox.removeListener(_scheduleFlush);
    _restored?.cancel();
    _renewTimer?.cancel();
    _flushTimer?.cancel();
  }
}

final backgroundSyncProvider = Provider<BackgroundSync>((ref) {
  final sync = BackgroundSync(
    session: ref.read(sessionProvider),
    auth: ref.read(authRepositoryProvider),
    access: ref.read(accessRepositoryProvider),
    outbox: ref.read(accessOutboxProvider),
    credentials: ref.read(credentialStoreProvider),
    network: ref.read(networkStatusProvider),
  )..start();
  ref.onDispose(sync.dispose);
  return sync;
});

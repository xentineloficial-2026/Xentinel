import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/xentinel_models.dart';

/// Tokens stay in memory. Passwords and JWTs are never written to preferences.
///
/// El JWT dura poco (15 min por defecto); `SessionRenewer` lo renueva en segundo
/// plano antes de que venza, así el celador no pierde la sesión ni el canal en
/// tiempo real mientras trabaja.
class SessionStore extends ChangeNotifier {
  UserEntity? user;
  String? token;
  String? message;
  DateTime? expiresAt;
  DateTime? issuedAt;
  Timer? _expiry;

  void signIn(UserEntity value, String accessToken, int expiresIn) {
    user = value;
    message = null;
    _setToken(accessToken, expiresIn);
    notifyListeners();
  }

  /// Reemplaza el token de la misma persona sin reiniciar la sesión en la app.
  void renew(String accessToken, int expiresIn, {UserEntity? updatedUser}) {
    if (user == null) return;
    if (updatedUser != null && updatedUser.id == user!.id) user = updatedUser;
    _setToken(accessToken, expiresIn);
    notifyListeners();
  }

  void _setToken(String accessToken, int expiresIn) {
    _expiry?.cancel();
    token = accessToken;
    issuedAt = DateTime.now();
    expiresAt = issuedAt!.add(Duration(seconds: expiresIn));
    _expiry = Timer(Duration(seconds: expiresIn), expire);
  }

  void expire() => clear(message: 'Tu sesión venció. Vuelve a ingresar.');

  void clear({String? message}) {
    _expiry?.cancel();
    user = null;
    token = null;
    expiresAt = null;
    issuedAt = null;
    this.message = message;
    notifyListeners();
  }

  @override
  void dispose() {
    _expiry?.cancel();
    super.dispose();
  }
}

final sessionProvider = ChangeNotifierProvider<SessionStore>(
  (_) => SessionStore(),
);

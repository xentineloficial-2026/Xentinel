import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/xentinel_models.dart';

/// Tokens stay in memory. Passwords and JWTs are never written to preferences.
class SessionStore extends ChangeNotifier {
  UserEntity? user;
  String? token;
  String? message;
  Timer? _expiry;

  void signIn(UserEntity value, String accessToken, int expiresIn) {
    _expiry?.cancel();
    user = value;
    token = accessToken;
    message = null;
    _expiry = Timer(Duration(seconds: expiresIn), expire);
    notifyListeners();
  }

  void expire() => clear(message: 'Tu sesión venció. Vuelve a ingresar.');

  void clear({String? message}) {
    _expiry?.cancel();
    user = null;
    token = null;
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

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Movimiento escaneado sin conexión, pendiente de enviar al servidor.
///
/// Conserva su `request_id`: si la primera solicitud llegó al servidor pero se
/// perdió la respuesta, el reenvío devuelve el mismo registro y nunca lo duplica.
class PendingAccess {
  const PendingAccess({
    required this.requestId,
    required this.operatorId,
    required this.userId,
    required this.type,
    required this.scannedAt,
    this.signedCode,
    this.attempts = 0,
  });

  final String requestId;

  /// Celador que escaneó: solo su sesión puede enviarlo (el servidor lo exige).
  final String operatorId;
  final int userId;

  /// `ENTRADA` o `SALIDA`.
  final String type;

  /// Hora del servidor (corregida) en el momento del escaneo.
  final DateTime scannedAt;

  /// Carnet firmado XN2: el servidor verifica la firma al sincronizar.
  final String? signedCode;
  final int attempts;

  PendingAccess withAttempt() => PendingAccess(
    requestId: requestId,
    operatorId: operatorId,
    userId: userId,
    type: type,
    scannedAt: scannedAt,
    signedCode: signedCode,
    attempts: attempts + 1,
  );

  /// Cuerpo de `POST /ingresos`. `escaneado_en` solo se envía al sincronizar: en
  /// línea manda la hora del servidor.
  Map<String, Object> body({required bool includeScanTime}) => {
    if (signedCode != null) 'codigo_qr': signedCode! else 'id_usuarios': userId,
    'tipo': type,
    'metodo': 'QR',
    'request_id': requestId,
    if (includeScanTime) 'escaneado_en': scannedAt.toUtc().toIso8601String(),
  };

  Map<String, Object?> toJson() => {
    'request_id': requestId,
    'operador': operatorId,
    'id_usuarios': userId,
    'tipo': type,
    'escaneado_en': scannedAt.toUtc().toIso8601String(),
    'codigo_qr': signedCode,
    'intentos': attempts,
  };

  static PendingAccess? fromJson(Object? json) {
    if (json is! Map) return null;
    try {
      return PendingAccess(
        requestId: json['request_id'] as String,
        operatorId: json['operador'] as String,
        userId: json['id_usuarios'] as int,
        type: json['tipo'] as String,
        scannedAt: DateTime.parse(json['escaneado_en'] as String),
        signedCode: json['codigo_qr'] as String?,
        attempts: json['intentos'] as int? ?? 0,
      );
    } catch (_) {
      return null;
    }
  }
}

/// Resultado de sincronizar que el celador debe conocer: el servidor no aceptó un
/// movimiento que se dejó pasar sin conexión, o lo registró como denegado.
class SyncIssue {
  const SyncIssue({
    required this.userId,
    required this.type,
    required this.reason,
    required this.scannedAt,
    this.name,
  });
  final int userId;
  final String type;
  final String reason;
  final DateTime scannedAt;
  final String? name;

  Map<String, Object?> toJson() => {
    'id_usuarios': userId,
    'tipo': type,
    'motivo': reason,
    'escaneado_en': scannedAt.toUtc().toIso8601String(),
    'nombre': name,
  };

  static SyncIssue? fromJson(Object? json) {
    if (json is! Map) return null;
    try {
      return SyncIssue(
        userId: json['id_usuarios'] as int,
        type: json['tipo'] as String,
        reason: json['motivo'] as String,
        scannedAt: DateTime.parse(json['escaneado_en'] as String),
        name: json['nombre'] as String?,
      );
    } catch (_) {
      return null;
    }
  }
}

abstract interface class OutboxPersistence {
  Future<String?> read();
  Future<void> write(String value);
}

class PreferencesOutboxPersistence implements OutboxPersistence {
  const PreferencesOutboxPersistence();
  static const _key = 'xentinel_outbox_v1';
  @override
  Future<String?> read() async =>
      (await SharedPreferences.getInstance()).getString(_key);
  @override
  Future<void> write(String value) async =>
      (await SharedPreferences.getInstance()).setString(_key, value);
}

/// Cola persistente de accesos registrados sin conexión.
///
/// Sobrevive a cierres de la app y reinicios del teléfono. Los movimientos de más
/// de 72 h ya no se pueden sincronizar (el servidor los rechaza) y pasan a la lista
/// de incidencias para que el celador los registre manualmente.
class AccessOutbox extends ChangeNotifier {
  AccessOutbox(this._persistence, {DateTime Function()? now})
    : _now = now ?? DateTime.now;

  static const maxPending = 500;
  static const maxIssues = 30;
  static const maxAge = Duration(hours: 72);
  static const maxAttempts = 8;

  final OutboxPersistence _persistence;
  final DateTime Function() _now;
  final List<PendingAccess> _pending = [];
  final List<SyncIssue> _issues = [];
  Future<void>? _loading;
  Future<void> _writing = Future.value();

  List<PendingAccess> get pending => List.unmodifiable(_pending);
  List<SyncIssue> get issues => List.unmodifiable(_issues);

  List<PendingAccess> pendingFor(String operatorId) =>
      _pending.where((p) => p.operatorId == operatorId).toList();

  Future<void> load() => _loading ??= _load();

  Future<void> _load() async {
    try {
      final raw = await _persistence.read();
      if (raw != null) {
        final data = jsonDecode(raw);
        if (data is Map) {
          for (final item in (data['pendientes'] as List? ?? const [])) {
            final entry = PendingAccess.fromJson(item);
            if (entry != null &&
                !_pending.any((p) => p.requestId == entry.requestId)) {
              _pending.add(entry);
            }
          }
          for (final item in (data['incidencias'] as List? ?? const [])) {
            final issue = SyncIssue.fromJson(item);
            if (issue != null) _issues.add(issue);
          }
        }
      }
    } catch (_) {
      // Una cola ilegible no debe impedir abrir el escáner.
    }
    _expireOld();
    notifyListeners();
  }

  /// Escaneo de la misma persona y dirección en los últimos 2 minutos: el carnet
  /// rota cada 15 s, pero es el mismo paso por la portería.
  PendingAccess? findRecent(String operatorId, int userId, String type) {
    final limit = _now().subtract(const Duration(minutes: 2));
    for (final entry in _pending.reversed) {
      if (entry.operatorId == operatorId &&
          entry.userId == userId &&
          entry.type == type &&
          entry.scannedAt.isAfter(limit)) {
        return entry;
      }
    }
    return null;
  }

  bool contains(String requestId) =>
      _pending.any((p) => p.requestId == requestId);

  Future<bool> add(PendingAccess entry) async {
    await load();
    if (contains(entry.requestId)) return false;
    if (_pending.length >= maxPending) return false;
    _pending.add(entry);
    notifyListeners();
    await _persist();
    return true;
  }

  Future<void> complete(String requestId, {SyncIssue? issue}) async {
    _pending.removeWhere((p) => p.requestId == requestId);
    if (issue != null) _addIssue(issue);
    notifyListeners();
    await _persist();
  }

  Future<void> markAttempt(String requestId) async {
    final index = _pending.indexWhere((p) => p.requestId == requestId);
    if (index < 0) return;
    final entry = _pending[index].withAttempt();
    if (entry.attempts >= maxAttempts) {
      _pending.removeAt(index);
      _addIssue(
        SyncIssue(
          userId: entry.userId,
          type: entry.type,
          scannedAt: entry.scannedAt,
          reason:
              'El servidor no respondió tras varios intentos. Regístralo manualmente.',
        ),
      );
    } else {
      _pending[index] = entry;
    }
    notifyListeners();
    await _persist();
  }

  Future<void> clearIssues() async {
    _issues.clear();
    notifyListeners();
    await _persist();
  }

  void _addIssue(SyncIssue issue) {
    _issues.insert(0, issue);
    if (_issues.length > maxIssues) {
      _issues.removeRange(maxIssues, _issues.length);
    }
  }

  void _expireOld() {
    final limit = _now().subtract(maxAge);
    final expired = _pending.where((p) => p.scannedAt.isBefore(limit)).toList();
    for (final entry in expired) {
      _pending.remove(entry);
      _addIssue(
        SyncIssue(
          userId: entry.userId,
          type: entry.type,
          scannedAt: entry.scannedAt,
          reason:
              'Pasaron más de 72 horas sin conexión. Regístralo manualmente.',
        ),
      );
    }
    if (expired.isNotEmpty) _persist();
  }

  Future<void> _persist() {
    final snapshot = jsonEncode({
      'pendientes': _pending.map((p) => p.toJson()).toList(),
      'incidencias': _issues.map((i) => i.toJson()).toList(),
    });
    // Escrituras en orden: la última siempre refleja el estado más reciente.
    return _writing = _writing
        .then((_) => _persistence.write(snapshot))
        .catchError((Object _) {});
  }
}

final outboxPersistenceProvider = Provider<OutboxPersistence>(
  (_) => const PreferencesOutboxPersistence(),
);

final accessOutboxProvider = ChangeNotifierProvider<AccessOutbox>((ref) {
  final outbox = AccessOutbox(ref.watch(outboxPersistenceProvider));
  outbox.load();
  return outbox;
});

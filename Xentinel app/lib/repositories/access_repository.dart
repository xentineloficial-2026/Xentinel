import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../core/api_config.dart';
import '../core/server_clock.dart';
import '../models/xentinel_models.dart';
import '../services/api_client.dart';

class AccessRepository {
  AccessRepository(this._api, {DateTime Function()? now})
    : _now = now ?? ServerClock.now;
  final ApiClient _api;
  final DateTime Function() _now;
  static const maxQrAge = Duration(seconds: 45);
  String? _lastOperation;
  String? _requestId;

  Future<AccessScanResult> processScanPayload({
    required String payload,
    required bool isExitMode,
  }) async {
    final scanned = _parseQr(payload);
    if (scanned == null) {
      return const Denied(reason: 'Este código no es un carnet de Xentinel.');
    }
    final (id, timestamp) = scanned;
    if (timestamp != null &&
        (_now().millisecondsSinceEpoch - timestamp).abs() >
            maxQrAge.inMilliseconds) {
      return const Denied(
        reason: 'QR vencido. Solicita que actualicen el carnet.',
      );
    }
    final type = isExitMode ? 'SALIDA' : 'ENTRADA';
    final operation = '$id:$timestamp:$type';
    // Retain the idempotency key after an uncertain network result. A repeated
    // scan cannot register the same operation twice if the response was lost.
    if (_lastOperation != operation) {
      _lastOperation = operation;
      _requestId = const Uuid().v4();
    }
    try {
      final data = await _api.request(
        'ingresos',
        method: 'POST',
        body: {
          'id_usuarios': id,
          'tipo': type,
          'metodo': 'QR',
          'request_id': _requestId,
        },
      );
      if (data is! Map || data['id_usuarios'] != id || data['tipo'] != type) {
        throw const ApiException(
          'INVALID_RESPONSE',
          'No se pudo confirmar el registro. Verifica el historial antes de repetirlo.',
        );
      }
      // El QR de la web no cambia: otra lectura confirmada es otro movimiento,
      // no un reintento, y necesita su propia clave de idempotencia.
      if (timestamp == null) _lastOperation = null;
      return switch (data['estado']) {
        'Permitido' => Granted(person: ScannedPerson.fromApi(data['persona'])),
        'Visitante' => const VisitorAccess(),
        'Denegado' => Denied(
          user: null,
          reason:
              'Esta persona está inactiva o retirada. Consulta con administración.',
          person: ScannedPerson.fromApi(data['persona']),
        ),
        _ => throw const ApiException(
          'INVALID_RESPONSE',
          'El servidor devolvió un estado de acceso desconocido.',
        ),
      };
    } on ApiException catch (error) {
      if (error.code == 'ACCESS_SEQUENCE') {
        return Alert(
          reason: isExitMode
              ? 'No tiene una entrada registrada. Cambia a ENTRADA y escanea de nuevo.'
              : 'Ya tiene una entrada registrada. Cambia a SALIDA y escanea de nuevo.',
        );
      }
      if (error.code == 'NOT_FOUND') return const NotRegistered();
      rethrow;
    }
  }

  /// Carnet de la app (`XENTINEL:id:timestamp`) o credencial de la web
  /// (`{"sistema":"Xentinel","version":1,"id_usuarios":id}`, sin timestamp).
  static (int, int?)? _parseQr(String payload) {
    final text = payload.trim();
    if (text.length > 400) return null;
    int? id;
    int? timestamp;
    if (text.startsWith('{')) {
      try {
        final data = jsonDecode(text);
        if (data is Map &&
            data['sistema'] == 'Xentinel' &&
            data['version'] == 1 &&
            data['id_usuarios'] is int) {
          id = data['id_usuarios'] as int;
        }
      } on FormatException {
        return null;
      }
    } else {
      final parts = text.split(':');
      if (parts.length != 3 || parts[0] != 'XENTINEL') return null;
      id = int.tryParse(parts[1]);
      timestamp = int.tryParse(parts[2]);
      if (timestamp == null || timestamp <= 0) return null;
    }
    if (id == null || id <= 0 || id > 2147483647) return null;
    return (id, timestamp);
  }
}

final accessRepositoryProvider = Provider<AccessRepository>(
  (ref) => AccessRepository(ref.watch(apiClientProvider)),
);

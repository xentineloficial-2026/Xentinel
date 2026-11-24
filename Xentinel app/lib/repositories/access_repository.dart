import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../core/api_config.dart';
import '../core/qr_codes.dart';
import '../core/server_clock.dart';
import '../models/xentinel_models.dart';
import '../services/api_client.dart';
import '../services/network_status.dart';

/// Validación de carnets en el punto de control. Funciona solo en línea: cada
/// lectura la confirma el servidor, que también guarda las alarmas de carnets
/// vencidos o que no son verídicos.
class AccessRepository {
  AccessRepository(this._api, {DateTime Function()? now, this.network})
    : _now = now ?? ServerClock.now;
  final ApiClient _api;
  final DateTime Function() _now;

  /// Sin red conocida no se espera el tiempo de espera de la solicitud.
  final NetworkStatus? network;

  /// Ventana del carnet heredado de la app (sin firma), que solo se puede validar aquí.
  static const maxQrAge = Duration(seconds: 45);

  /// Texto máximo que se reporta de un código ajeno (el servidor solo guarda su huella).
  static const maxReportedLength = 2048;

  static const offlineReason =
      'Sin conexión. El escáner necesita internet para validar el carnet: revisa '
      'el Wi‑Fi o los datos móviles y vuelve a escanear.';

  String? _lastOperation;
  String? _requestId;

  /// Identificador del carnet, para evitar lecturas repetidas de la misma persona.
  static int? userIdOf(String payload) => XentinelQr.parse(payload)?.userId;

  Future<AccessScanResult> processScanPayload({
    required String payload,
    required bool isExitMode,
  }) async {
    final type = isExitMode ? 'SALIDA' : 'ENTRADA';
    final scanned = XentinelQr.parse(payload);
    if (scanned == null) {
      // Un código que no es de Xentinel también es una alarma (roja) para control.
      _reportAlarm('QR_INVALIDO', payload, type);
      return const Denied(reason: 'Este código no es un carnet de Xentinel.');
    }
    // El carnet firmado lo valida el servidor con su propia hora (y registra la
    // alarma si venció). El heredado no lleva firma: su vigencia se mide aquí.
    if (scanned.kind == QrKind.legacyApp &&
        (_now().millisecondsSinceEpoch - scanned.timestampMs!).abs() >
            maxQrAge.inMilliseconds) {
      _reportAlarm('QR_VENCIDO', payload, type);
      return const Denied(
        reason: 'QR vencido. Pide que actualicen el carnet en la app.',
      );
    }
    if (network?.online == false) {
      return const Unconfirmed(reason: offlineReason);
    }
    final id = scanned.userId;
    final operation = '$id:${scanned.step ?? scanned.timestampMs}:$type';
    // Conserva la clave de idempotencia tras un resultado de red incierto: repetir
    // la lectura nunca registra dos veces el mismo movimiento.
    if (_lastOperation != operation) {
      _lastOperation = operation;
      _requestId = const Uuid().v4();
    }
    try {
      final data = await _api.request(
        'ingresos',
        method: 'POST',
        body: {
          if (scanned.kind == QrKind.signed)
            'codigo_qr': scanned.raw
          else
            'id_usuarios': id,
          'tipo': type,
          'metodo': 'QR',
          'request_id': _requestId!,
        },
      );
      final result = _resultFrom(data, id, type);
      // El QR de la web no cambia: otra lectura confirmada es otro movimiento,
      // no un reintento, y necesita su propia clave de idempotencia.
      if (scanned.kind == QrKind.legacyWeb) _lastOperation = null;
      return result;
    } on ApiException catch (error) {
      final mapped = _mapError(error, isExitMode);
      if (mapped != null) return mapped;
      if (error.isConnectivity) {
        return const Unconfirmed(
          reason:
              'No hubo respuesta del servidor. Revisa la conexión y vuelve a '
              'escanear: el mismo carnet no se registra dos veces.',
        );
      }
      rethrow;
    }
  }

  /// Avisa al servidor de un código rechazado aquí, sin esperar ni bloquear la lectura.
  void _reportAlarm(String reason, String payload, String type) {
    if (network?.online == false) return;
    final content = payload.length > maxReportedLength
        ? payload.substring(0, maxReportedLength)
        : payload;
    _api
        .request(
          'alarmas/qr',
          method: 'POST',
          body: {'motivo': reason, 'contenido': content, 'tipo': type},
        )
        .then((_) {}, onError: (Object _) {});
  }

  static AccessScanResult _resultFrom(Object? data, int id, String type) {
    if (data is! Map || data['id_usuarios'] != id || data['tipo'] != type) {
      throw const ApiException(
        'INVALID_RESPONSE',
        'No se pudo confirmar el registro. Verifica el historial antes de repetirlo.',
      );
    }
    return switch (data['estado']) {
      'Permitido' => Granted(
        person: ScannedPerson.fromApi(data['persona']),
        isExit: type == 'SALIDA',
      ),
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
  }

  static AccessScanResult? _mapError(ApiException error, bool isExitMode) {
    return switch (error.code) {
      'ACCESS_SEQUENCE' => Alert(
        reason: isExitMode
            ? 'No tiene una entrada registrada. Cambia a ENTRADA y escanea de nuevo.'
            : 'Ya tiene una entrada registrada. Cambia a SALIDA y escanea de nuevo.',
      ),
      'NOT_FOUND' => const NotRegistered(),
      'INVALID_QR' => const Denied(
        reason:
            'Carnet no válido o revocado. Verifica el documento de identidad: '
            'quedó registrada una alarma roja.',
      ),
      'QR_EXPIRED' => const Denied(
        reason:
            'QR vencido. Pide que actualicen el carnet en la app y escanea de nuevo.',
      ),
      'QR_UNSIGNED' => const Denied(
        reason:
            'Este punto exige el carnet firmado. La persona debe actualizar la app de Xentinel.',
      ),
      _ => null,
    };
  }
}

final accessRepositoryProvider = Provider<AccessRepository>(
  (ref) => AccessRepository(
    ref.watch(apiClientProvider),
    // `read`: la red cambia a menudo y el repositorio conserva la clave de
    // idempotencia del último escaneo; no debe recrearse por eso.
    network: ref.read(networkStatusProvider),
  ),
);

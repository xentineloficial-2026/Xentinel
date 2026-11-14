import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../core/api_config.dart';
import '../core/qr_codes.dart';
import '../core/server_clock.dart';
import '../core/session.dart';
import '../models/xentinel_models.dart';
import '../services/access_outbox.dart';
import '../services/api_client.dart';
import '../services/network_status.dart';

class AccessRepository {
  AccessRepository(
    this._api, {
    DateTime Function()? now,
    this.outbox,
    this.session,
    this.network,
  }) : _now = now ?? ServerClock.now;
  final ApiClient _api;
  final DateTime Function() _now;

  /// Con cola, un escaneo sin conexión se guarda y se envía después; sin cola
  /// (pruebas o servidores antiguos) se informa como no confirmado.
  final AccessOutbox? outbox;
  final SessionStore? session;
  final NetworkStatus? network;

  /// Ventana del carnet heredado (sin firma), validada en el lector.
  static const maxQrAge = Duration(seconds: 45);

  /// Margen local del carnet firmado. El servidor aplica la ventana exacta (±45 s)
  /// con su propia hora; aquí solo se descartan capturas claramente viejas.
  static const maxSignedSkewSteps = 8;
  String? _lastOperation;
  String? _requestId;
  DateTime? _scannedAt;
  bool _syncing = false;

  /// Identificador del carnet, para evitar lecturas repetidas de la misma persona.
  static int? userIdOf(String payload) => XentinelQr.parse(payload)?.userId;

  Future<AccessScanResult> processScanPayload({
    required String payload,
    required bool isExitMode,
  }) async {
    final scanned = XentinelQr.parse(payload);
    if (scanned == null) {
      return const Denied(reason: 'Este código no es un carnet de Xentinel.');
    }
    final now = _now();
    final expired = switch (scanned.kind) {
      QrKind.legacyApp =>
        (now.millisecondsSinceEpoch - scanned.timestampMs!).abs() >
            maxQrAge.inMilliseconds,
      QrKind.signed =>
        (XentinelQr.stepAt(now) - scanned.step!).abs() > maxSignedSkewSteps,
      QrKind.legacyWeb => false,
    };
    if (expired) {
      return const Denied(
        reason: 'QR vencido. Solicita que actualicen el carnet.',
      );
    }
    final id = scanned.userId;
    final type = isExitMode ? 'SALIDA' : 'ENTRADA';
    final operation = '$id:${scanned.step ?? scanned.timestampMs}:$type';
    // Retain the idempotency key after an uncertain network result. A repeated
    // scan cannot register the same operation twice if the response was lost.
    if (_lastOperation != operation) {
      _lastOperation = operation;
      _requestId = const Uuid().v4();
      _scannedAt = now;
    }
    final pending = PendingAccess(
      requestId: _requestId!,
      operatorId: session?.user?.id ?? '',
      userId: id,
      type: type,
      scannedAt: _scannedAt!,
      signedCode: scanned.kind == QrKind.signed ? scanned.raw : null,
    );
    // Sin red conocida no se espera el tiempo de espera de la solicitud.
    if (outbox != null && network?.online == false) return _queue(pending);
    try {
      final data = await _api.request(
        'ingresos',
        method: 'POST',
        body: pending.body(includeScanTime: false),
      );
      final result = _resultFrom(data, id, type);
      // El QR de la web no cambia: otra lectura confirmada es otro movimiento,
      // no un reintento, y necesita su propia clave de idempotencia.
      if (scanned.kind == QrKind.legacyWeb) _lastOperation = null;
      // Hay conexión: buen momento para vaciar la cola.
      if (outbox != null) syncPending().ignore();
      return result;
    } on ApiException catch (error) {
      final mapped = _mapError(error, isExitMode);
      if (mapped != null) return mapped;
      if (outbox != null && _isTransient(error)) return _queue(pending);
      rethrow;
    }
  }

  static bool _isTransient(ApiException error) =>
      error.isConnectivity || const {502, 503, 504}.contains(error.status);

  Future<AccessScanResult> _queue(PendingAccess pending) async {
    final queue = outbox!;
    await queue.load();
    final previous =
        queue.contains(pending.requestId) ||
        queue.findRecent(pending.operatorId, pending.userId, pending.type) !=
            null;
    if (previous) return QueuedOffline(userId: pending.userId, repeated: true);
    if (pending.operatorId.isEmpty || !await queue.add(pending)) {
      return const Unconfirmed(
        reason:
            'Sin conexión y sin espacio para guardar el registro. Regístralo manualmente.',
      );
    }
    // El siguiente paso de la misma persona es otro movimiento.
    _lastOperation = null;
    return QueuedOffline(userId: pending.userId);
  }

  static AccessScanResult _resultFrom(Object? data, int id, String type) {
    if (data is! Map || data['id_usuarios'] != id || data['tipo'] != type) {
      throw const ApiException(
        'INVALID_RESPONSE',
        'No se pudo confirmar el registro. Verifica el historial antes de repetirlo.',
      );
    }
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
            'Carnet no válido o revocado. Pide a la persona que vuelva a iniciar sesión en Xentinel.',
      ),
      'QR_EXPIRED' => const Denied(
        reason: 'QR vencido. Solicita que actualicen el carnet.',
      ),
      'QR_UNSIGNED' => const Denied(
        reason:
            'Este punto exige el carnet firmado. La persona debe actualizar la app de Xentinel.',
      ),
      _ => null,
    };
  }

  static String _syncReason(ApiException error) => switch (error.code) {
    'ACCESS_SEQUENCE' =>
      'Movimiento fuera de orden: ya había otro registro. Revisa el historial.',
    'NOT_FOUND' => 'Usuario no registrado en Xentinel.',
    'INVALID_QR' => 'Carnet no válido o revocado: no se registró.',
    'QR_EXPIRED' => 'El carnet estaba vencido al escanearlo: no se registró.',
    'QR_UNSIGNED' => 'El punto exige carnet firmado: no se registró.',
    'INVALID_SCAN_TIME' =>
      'La hora del teléfono no era válida. Regístralo manualmente.',
    'IDEMPOTENCY_CONFLICT' => 'Registro duplicado con otra operación.',
    _ => error.message,
  };

  /// Envía los accesos guardados sin conexión del celador de la sesión actual.
  /// Devuelve cuántos quedaron sincronizados.
  Future<int> syncPending() async {
    final queue = outbox;
    final operator = session?.user?.id;
    if (queue == null || operator == null || session?.token == null) return 0;
    if (_syncing) return 0;
    _syncing = true;
    var sent = 0;
    try {
      await queue.load();
      for (final entry in queue.pendingFor(operator)) {
        if (session?.user?.id != operator) break;
        try {
          final data = await _api.request(
            'ingresos',
            method: 'POST',
            body: entry.body(includeScanTime: true),
          );
          final result = _resultFrom(data, entry.userId, entry.type);
          await queue.complete(
            entry.requestId,
            issue: result is Denied
                ? SyncIssue(
                    userId: entry.userId,
                    type: entry.type,
                    scannedAt: entry.scannedAt,
                    name: result.person?.name,
                    reason:
                        'Registrado como DENEGADO: la persona está inactiva o retirada.',
                  )
                : null,
          );
          sent++;
        } on ApiException catch (error) {
          // Sin red, sesión vencida o servidor ocupado: se reintenta después.
          if (_isTransient(error) ||
              error.status == 401 ||
              error.status == 429 ||
              (error.status ?? 0) >= 500 ||
              error.code == 'CONFIGURATION') {
            if (!error.isConnectivity && error.status != 401) {
              await queue.markAttempt(entry.requestId);
            }
            break;
          }
          if (error.code == 'INVALID_RESPONSE') {
            await queue.markAttempt(entry.requestId);
            continue;
          }
          await queue.complete(
            entry.requestId,
            issue: SyncIssue(
              userId: entry.userId,
              type: entry.type,
              scannedAt: entry.scannedAt,
              reason: _syncReason(error),
            ),
          );
        }
      }
    } finally {
      _syncing = false;
    }
    return sent;
  }
}

final accessRepositoryProvider = Provider<AccessRepository>(
  (ref) => AccessRepository(
    ref.watch(apiClientProvider),
    // `read`: la cola y la red cambian a menudo y el repositorio conserva la clave
    // de idempotencia del último escaneo; no debe recrearse por eso.
    outbox: ref.read(accessOutboxProvider),
    session: ref.read(sessionProvider),
    network: ref.read(networkStatusProvider),
  ),
);

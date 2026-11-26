import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/router.dart';

/// Alerta sísmica que el servidor envía por Firebase Cloud Messaging (solo datos).
class SeismicAlert {
  const SeismicAlert({
    required this.alertId,
    required this.magnitude,
    required this.place,
    required this.severity,
    required this.message,
    this.depthKm,
    this.distanceKm,
    this.occurredAt,
  });

  final String alertId;
  final double magnitude;
  final String place;
  final String severity;
  final String message;
  final double? depthKm;
  final double? distanceKm;
  final DateTime? occurredAt;

  String get title => 'Sismo M${magnitude.toStringAsFixed(1)} · $place';

  String get summary => distanceKm == null
      ? 'Agáchate, cúbrete y sujétate.'
      : 'A ${distanceKm!.round()} km de la sede. Agáchate, cúbrete y sujétate.';

  int get notificationId => int.tryParse(alertId) ?? place.hashCode;

  static SeismicAlert? fromData(Map<String, dynamic> data) {
    if (data['tipo'] != 'SISMO') return null;
    final magnitude = double.tryParse('${data['magnitud']}');
    final place = data['lugar'];
    if (magnitude == null || place is! String || place.isEmpty) return null;
    return SeismicAlert(
      alertId: '${data['id_alerta'] ?? ''}',
      magnitude: magnitude,
      place: place,
      severity: '${data['severidad'] ?? 'alta'}',
      message: '${data['mensaje'] ?? ''}',
      depthKm: double.tryParse('${data['profundidad']}'),
      distanceKm: double.tryParse('${data['distancia_km']}'),
      occurredAt: DateTime.tryParse('${data['timestamp']}')?.toLocal(),
    );
  }

  static SeismicAlert? fromPayload(String? payload) {
    if (payload == null) return null;
    try {
      final data = jsonDecode(payload);
      return data is Map<String, dynamic> ? fromData(data) : null;
    } on FormatException {
      return null;
    }
  }

  Map<String, String> toData() => {
    'tipo': 'SISMO',
    'id_alerta': alertId,
    'magnitud': magnitude.toStringAsFixed(1),
    'lugar': place,
    'severidad': severity,
    'mensaje': message,
    if (depthKm != null) 'profundidad': depthKm!.toStringAsFixed(0),
    if (distanceKm != null) 'distancia_km': distanceKm!.toStringAsFixed(0),
    if (occurredAt != null) 'timestamp': occurredAt!.toUtc().toIso8601String(),
  };
}

/// Alertas sísmicas push: tema `alertas_sismo`, canal crítico y pantalla completa.
///
/// Firebase se configura con `android/app/google-services.json`; sin ese archivo
/// [available] queda en `false` y la app funciona igual (las alertas siguen llegando
/// con la app abierta por el canal en tiempo real).
class SeismicAlerts {
  SeismicAlerts({required this.onAlert});

  static const topic = 'alertas_sismo';
  static const channelId = 'canal_sismos_critico';
  static bool available = false;
  static final _plugin = FlutterLocalNotificationsPlugin();

  final void Function(SeismicAlert alert) onAlert;
  StreamSubscription<RemoteMessage>? _foreground;

  static AndroidFlutterLocalNotificationsPlugin? get _android => _plugin
      .resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >();

  /// Inicializa Firebase y el manejador en segundo plano antes de `runApp`.
  static Future<bool> initializeFirebase() async {
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(seismicBackgroundHandler);
      available = true;
    } catch (_) {
      available = false;
    }
    return available;
  }

  /// Canal de sonido y categoría de alarma: pasa el modo No molestar habitual
  /// (alarmas permitidas) sin pedir acceso especial al sistema.
  static Future<AndroidNotificationChannel> _channel() async =>
      AndroidNotificationChannel(
        channelId,
        'Alertas sísmicas',
        description: 'Sismos cercanos a la sede, con sirena.',
        importance: Importance.max,
        sound: const RawResourceAndroidNotificationSound('alerta_sismo'),
        vibrationPattern: Int64List.fromList([0, 600, 200, 600, 200, 600]),
        enableLights: true,
        ledColor: const Color(0xFFC4231A),
        audioAttributesUsage: AudioAttributesUsage.alarm,
      );

  static Future<void> _prepare({
    DidReceiveNotificationResponseCallback? onTap,
  }) async {
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('ic_notificacion'),
      ),
      onDidReceiveNotificationResponse: onTap,
    );
    await _android?.createNotificationChannel(await _channel());
  }

  static Future<void> prepareInBackground() => _prepare();

  static Future<void> showNotification(SeismicAlert alert) async {
    final channel = await _channel();
    await _plugin.show(
      id: alert.notificationId,
      title: alert.title,
      body: alert.summary,
      payload: jsonEncode(alert.toData()),
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          channel.id,
          channel.name,
          channelDescription: channel.description,
          importance: Importance.max,
          priority: Priority.max,
          category: AndroidNotificationCategory.alarm,
          visibility: NotificationVisibility.public,
          sound: channel.sound,
          vibrationPattern: channel.vibrationPattern,
          audioAttributesUsage: AudioAttributesUsage.alarm,
          ticker: 'Alerta sísmica',
          color: const Color(0xFFC4231A),
          styleInformation: BigTextStyleInformation(
            alert.message.isEmpty ? alert.summary : alert.message,
          ),
          timeoutAfter: const Duration(hours: 1).inMilliseconds,
        ),
      ),
    );
  }

  /// Permisos, suscripción al tema y apertura desde la notificación.
  Future<void> start() async {
    await _prepare(
      onTap: (response) {
        final alert = SeismicAlert.fromPayload(response.payload);
        if (alert != null) onAlert(alert);
      },
    );
    final launch = await _plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp ?? false) {
      final alert = SeismicAlert.fromPayload(
        launch!.notificationResponse?.payload,
      );
      if (alert != null) onAlert(alert);
    }
    _foreground = FirebaseMessaging.onMessage.listen((message) {
      final alert = SeismicAlert.fromData(message.data);
      if (alert == null) return;
      unawaited(showNotification(alert));
      onAlert(alert);
    });
    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission();
    try {
      await messaging.subscribeToTopic(topic);
    } catch (_) {
      // Sin red: Firebase reintenta en el próximo inicio de la app.
    }
  }

  void dispose() => _foreground?.cancel();
}

/// Mensaje recibido con la app en segundo plano o cerrada.
@pragma('vm:entry-point')
Future<void> seismicBackgroundHandler(RemoteMessage message) async {
  final alert = SeismicAlert.fromData(message.data);
  if (alert == null) return;
  await Firebase.initializeApp();
  await SeismicAlerts.prepareInBackground();
  await SeismicAlerts.showNotification(alert);
}

final seismicAlertsProvider = Provider<SeismicAlerts>((ref) {
  final service = SeismicAlerts(
    onAlert: (alert) => ref.read(routerProvider).push('/sismo', extra: alert),
  );
  if (SeismicAlerts.available) unawaited(service.start());
  ref.onDispose(service.dispose);
  return service;
});

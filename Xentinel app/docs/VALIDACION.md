# Verificación de Xentinel móvil

## Automatización

- `flutter analyze`: errores estáticos y uso de APIs.
- `flutter test`: estados de cámara, permisos, inicialización concurrente, disposición entre rutas, JWT/401, errores HTTP, idempotencia, QR, severidad y parsing SSE.
- `test/navigation_test.dart`: recuperación, sesión/rol, carnet/alertas/escáner, rutas desconocidas, logout, cámara detrás de otra ruta, fondo/primer plano y pantalla 320×568 con texto ampliado.
- `flutter build apk --debug --dart-define-from-file=config/development.example.json`: compilación nativa Android; Backend del host desde el emulador, sin credenciales embebidas.

Estas pruebas no sustituyen hardware ni demuestran conectividad con producción.

## Validación física pendiente

1. Instalar desde cero; abrir login, recuperación y volver. Probar credenciales válidas e inválidas contra Backend de pruebas con SMTP controlado.
2. Ingresar con cada rol. Solo Administrador/Celador puede abrir el escáner, incluidos enlaces directos.
3. Abrir cámara: no mostrar preview antes del permiso. Denegar, volver a solicitar, bloquear y conceder desde Ajustes. Probar restricción de iOS y dispositivo sin cámara.
4. Abrir/cerrar el escáner 20 veces. Alternar fondo/primer plano, bloquear/desbloquear, cubrir con alertas y volver. Comprobar que no haya sesiones nativas duplicadas ni preview congelado.
5. Escanear QR vigente, vencido, inválido y repetido; alternar ENTRADA/SALIDA. Desconectar durante el registro: mostrar sin confirmar y no duplicar al reintentar.
6. Crear/modificar/finalizar una alerta en Backend de pruebas. Verificar aviso global desde todas las pantallas, severidad correcta e indicaciones idénticas a las del centro de control.
7. Desconectar con alerta activa: conservarla con aviso. Restaurar: actualizar sin repetir sonidos innecesarios. Revocar/vencer JWT: regresar al login y liberar cámara/SSE.
8. Probar texto grande, reducción de movimiento, TalkBack/VoiceOver, teclado y scroll.
9. Distribución: instalación limpia y actualización con la misma firma; enlace y hash deben corresponder al APK publicado.

## Alcance y requisitos externos

SSE/polling operan en primer plano. FCM/APNs necesita registro de dispositivos, credenciales y envío desde el Backend; no hay entrega garantizada con la app cerrada/suspendida.

Pendientes externos: URL HTTPS operativa, firma del propietario, SMTP y pruebas físicas. iOS requiere macOS/Xcode. El QR heredado necesita firma y validación del servidor antes de considerarse prueba de identidad.

# Verificación de Xentinel móvil

## Automatización

- `flutter analyze`: errores estáticos y uso de APIs.
- `flutter test`: estados de cámara, permisos, inicialización concurrente, disposición entre rutas, JWT/401, errores HTTP, idempotencia, QR (vectores compartidos con el servidor), carnet firmado y brillo, cola sin conexión, WebSocket contra un servidor local real, respaldo SSE, cambios de red, renovación de sesión, severidad y parsing SSE.
- `test_backend/cloud_flow_test.dart`: flujo completo contra FastAPI y PostgreSQL reales (`python scripts/fastapi-smoke-server.py RUTA_BACKEND postgresql://postgres@127.0.0.1:PUERTO/postgres`, luego `flutter test test_backend/cloud_flow_test.dart --dart-define=ALLOW_INSECURE_HTTP=true`).
- `test/navigation_test.dart`: recuperación, sesión/rol, carnet/alertas/escáner, rutas desconocidas, logout, cámara detrás de otra ruta, fondo/primer plano y pantalla 320×568 con texto ampliado.
- `scripts/build-release.sh`: APK release arm64 ofuscada con la API de Render, sin credenciales embebidas.

Estas pruebas no sustituyen hardware ni demuestran conectividad con producción.

## Validación física pendiente

1. Instalar desde cero; abrir login, recuperación y volver. Probar credenciales válidas e inválidas contra Backend de pruebas con SMTP controlado.
2. Ingresar con cada rol. Solo Administrador/Celador puede abrir el escáner, incluidos enlaces directos.
3. Abrir cámara: no mostrar preview antes del permiso. Denegar, volver a solicitar, bloquear y conceder desde Ajustes. Probar restricción de iOS y dispositivo sin cámara.
4. Abrir/cerrar el escáner 20 veces. Alternar fondo/primer plano, bloquear/desbloquear, cubrir con alertas y volver. Comprobar que no haya sesiones nativas duplicadas ni preview congelado.
5. Escanear QR vigente, vencido, inválido y repetido; alternar ENTRADA/SALIDA. Desconectar durante el registro: queda «Registrado sin conexión» y no se duplica al reintentar.
5a. **Celular a celular** (al menos un Android de gama baja, uno de gama media y un iPhone, en ambos sentidos): carnet con brillo automático bajo y en exteriores; a 10, 20 y 35 cm; con zoom automático, con pellizco y con el deslizador; tocando para enfocar; con funda o protector de pantalla con reflejos; inclinado 30°. Medir el tiempo desde apuntar hasta el resultado (objetivo: menos de 1 s a 20 cm). Mantener el carnet frente a la cámara 20 s: un solo registro aunque el código rote.
5b. **Redes distintas:** carnet en datos móviles y escáner en la Wi‑Fi de la sede (y al revés). Cambiar de Wi‑Fi a datos con el escáner abierto: el canal vuelve en segundos sin reiniciar la app.
5c. **Sin conexión:** modo avión en el escáner; registrar tres personas (una inactiva); quitar el modo avión: se envían solos, la inactiva aparece en «Requieren revisión» y el historial del Dashboard muestra la hora del escaneo. Cerrar la app con pendientes y abrirla: siguen ahí.
5d. **Carnet sin conexión:** iniciar sesión, cerrar la app, activar modo avión, abrir «Mostrar mi carnet sin conexión» con huella/PIN y leerlo con otro teléfono en línea. Cerrar sesión desde otro equipo: el carnet guardado se rechaza como revocado.
5e. **Lector web:** leer el carnet de la app con la cámara del PC en el módulo de ingresos.
6. Crear/modificar/finalizar una alerta en Backend de pruebas. Verificar aviso global desde todas las pantallas, severidad correcta e indicaciones idénticas a las del centro de control.
7. Desconectar con alerta activa: conservarla con aviso. Restaurar: actualizar sin repetir sonidos innecesarios. Revocar/vencer JWT: regresar al login y liberar cámara/SSE.
8. Probar texto grande, reducción de movimiento, TalkBack/VoiceOver, teclado y scroll.
9. Distribución: instalación limpia y actualización con la misma firma; enlace y hash deben corresponder al APK publicado.

## Alcance y requisitos externos

WebSocket/SSE/consulta operan en primer plano. FCM/APNs necesita registro de dispositivos, credenciales y envío desde el Backend; no hay entrega garantizada con la app cerrada/suspendida.

Pendientes externos: firma del propietario, SMTP (en Render gratuito, un proveedor con puerto 2525) y pruebas físicas. iOS requiere macOS/Xcode. Activa `QR_REQUIRE_SIGNED=true` cuando todos usen la app 1.1: hasta entonces los QR heredados sin firma siguen siendo solo identificación.

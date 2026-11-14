# Xentinel móvil — Flutter

Aplicación Flutter/Dart existente, conservada por decisión del usuario. Usa el Backend REST de Xentinel y comparte el azul `#18458D` del Dashboard. No requiere React Native, Expo ni acceso directo a Supabase.

## Ejecutar

Herramientas usadas: Flutter 3.47.7, Dart 3.13.5, Java 21 y SDK Android 36. Comprueba `flutter doctor -v`. En iOS se requiere macOS, Xcode, CocoaPods y un dispositivo con iOS 15.5 o posterior.

```sh
flutter pub get
flutter analyze
flutter test
flutter run
```

**Producción (cualquier red, sin puertos):** la app usa la API desplegada en Render, `https://xentinel-api.onrender.com/api/v1` (`lib/core/api_config.dart` y `config/production.json`), con la base de datos en Supabase. Funciona igual con datos móviles, con otra Wi‑Fi o con la red de la sede: no hay que escribir IP ni puertos en el teléfono, ni que los teléfonos compartan red. La APK release se compila con `scripts/build-release.sh` (Linux/macOS) o `scripts/publish-android.ps1` (Windows): una sola APK arm64 ofuscada.

**Otro servidor (solo desarrollo):** compila con `--dart-define=API_BASE_URL=<url>/api/v1` y, si es HTTP, `--dart-define=ALLOW_INSECURE_HTTP=true`; en esas compilaciones aparece el diálogo «Servidor».

## Arquitectura

```text
lib/
  components/    Tarjetas y aviso global de emergencias
  core/          Configuración, sesión, rutas, colores y textos compartidos
  models/        Usuarios, resultados de acceso y alertas
  providers/     Estado reactivo (Riverpod), carnet y monitor de alertas
  repositories/  Contratos de autenticación, accesos y alertas
  screens/       Login, recuperación, inicio, carnet, cámara y alertas
  services/      HTTP, WebSocket/SSE, red, cola sin conexión, credencial segura,
                 renovación de sesión, cámara, brillo, biometría y sonido
assets/          Logo y sonidos originales
config/          Ejemplos sin secretos
test/            Pruebas de lógica, API, cámara y navegación
scripts/         Compilación/distribución y mantenimiento
web-download/    Página y manifiesto para la descarga desde el Dashboard
docs/            Verificación y límites pendientes
```

En Flutter, `providers/` cumple la función del estado y los hooks. Las rutas protegidas son `/home`, `/carnet`, `/alerts` y `/scanner`. El escáner está reservado a Administrador/Celador, además de la autorización del servidor. `/login` y `/forgot-password` son públicas. Las rutas desconocidas permiten volver al inicio. Las transiciones respetan la preferencia de reducir animaciones; las emergencias aparecen inmediatamente.

## Red, tiempo real y modo sin conexión

```text
 Teléfono (datos móviles / cualquier Wi‑Fi)          Nube (HTTPS 443)
 ┌──────────────────────────────┐   REST + WSS   ┌──────────────────────────┐
 │ ApiClient (JWT renovable)    │ ─────────────▶ │ Caddy (TLS automático)   │
 │ WebSocket /tiempo-real ◀─────┼──── eventos ── │  └ FastAPI + PostgreSQL  │
 │   ↳ SSE /eventos (respaldo)  │                └──────────────────────────┘
 │   ↳ consulta periódica       │
 │ Cola de accesos sin conexión │ ── se envía sola al volver la red (idempotente)
 │ Carnet firmado (Keystore)    │ ── se genera sin internet
 └──────────────────────────────┘
```

| Pieza | Comportamiento |
| --- | --- |
| Servidor | URL HTTPS compilada en la app. Ninguna IP local, puerto manual ni Wi‑Fi compartida. |
| Tiempo real | WebSocket seguro (`wss://…/api/v1/tiempo-real`), autenticado en el primer mensaje (el JWT no va en la URL), ping cada 20 s y vigilancia de inactividad de 45 s. Si una red o proxy bloquea WebSocket, pasa a SSE con el mismo cursor; la consulta periódica queda como red de seguridad (60 s con canal en vivo, 3 s con espera progresiva sin él). |
| Cambios de red | `connectivity_plus` detecta el paso de Wi‑Fi a datos o la recuperación de señal y reconecta al instante. Sin red no gasta batería reintentando. Reconexión con espera exponencial y variación aleatoria. |
| Sesión | El JWT (15 min) se renueva al 75 % de su vigencia con `POST /auth/renovar`, hasta `SESSION_MAX_HOURS` (12 h) desde el ingreso. El canal abierto recibe el token nuevo sin reconectar. |
| Escáner sin conexión | Sin servidor, el escaneo se guarda en una cola persistente (sobrevive a reinicios) con su `request_id` y la hora del servidor. Se envía al recuperar la red, al volver la app al frente y cada 30 s; el servidor valida la firma con la hora del escaneo y no duplica reintentos. Lo que el servidor rechace queda en «Requieren revisión». |
| Carnet sin conexión | La clave del carnet firmado se guarda en el Keystore/Keychain. El carnet se abre desde el login, sin sesión ni internet, tras huella/rostro/PIN. |
| Reloj | La hora del servidor llega por el canal (`servidor_ms`) y por la cabecera `Date`, y se guarda para usarla sin conexión. |

Contrato bajo `/api/v1`: `auth/login`, `auth/renovar`, `auth/logout`, `auth/olvide-contrasena`, `auth/credencial-qr`, `alertas/activas`, `tiempo-real` (WebSocket), `eventos` (SSE) e `ingresos` (`{codigo_qr|id_usuarios, tipo, metodo:'QR', request_id, escaneado_en?}`). Detalle en `Xentinel web/BackEnd/docs/API.md`. Un servidor antiguo sin estas rutas sigue funcionando: la app usa SSE, el carnet heredado y la sesión vence a los 15 minutos.

## Carnet QR de celular a celular

El carnet usa el formato firmado `XN2:<id>:<paso>:<firma>` (HMAC‑SHA256 emitido por el servidor, rota cada 15 s en el borde exacto según la hora del servidor). Solo contiene caracteres del modo alfanumérico de QR, así cabe en una versión 3 (29×29 módulos) con corrección de errores Q (25 %). La pantalla del carnet sube el brillo de la app al máximo mientras está visible y dibuja el código hasta 320 dp, negro puro sobre blanco con zona de silencio amplia.

El escáner analiza a 1280×720, solo QR, con zoom automático de ML Kit (Android), enfoque al tocar y zoom por pellizco o deslizador: permite alejar el teléfono más allá de la distancia mínima de enfoque, causa principal de las lecturas fallidas de pantalla a pantalla. Entre varios códigos en el cuadro elige el de Xentinel, y tras un resultado ignora durante 6 s a la misma persona aunque su código rote. La validez la decide el servidor con su propia hora, por lo que la diferencia de reloj entre dos teléfonos ya no rechaza carnets válidos. El lector de la web (PC) también reconoce este carnet.

## Cámara

`CameraSession` es el único propietario del ciclo de vida. Comprueba permisos antes de montar el preview y los solicita mediante una acción explícita. Distingue denegación, bloqueo permanente, restricción, cámara no disponible e inicialización fallida. Detiene la cámara al cambiar de ruta o ir al fondo y comprueba el permiso al regresar. Una cola compartida serializa inicio, parada y liberación, incluso al abrir y cerrar rápidamente. Android declara CAMERA; iOS incluye los propósitos de cámara/Face ID y el macro de permiso de CocoaPods.

Las pruebas automatizadas usan cámara simulada. El enfoque, lectura y permisos reales deben validarse con `docs/VALIDACION.md` en teléfonos físicos.

## Distribución y Dashboard

El identificador Android es `co.edu.sena.xentinel`. No se publican APK de debug como versiones oficiales. Configura `android/key.properties` con la **clave de firma existente** para actualizar instalaciones; nunca lo confirmes en control de versiones. La URL de producción está en `config/production.json`.

```properties
# android/key.properties — ruta relativa a android/ o absoluta
storeFile=C:/ruta/segura/xentinel.jks
storePassword=TU_CLAVE
keyAlias=TU_ALIAS
keyPassword=TU_CLAVE
```

```powershell
./scripts/publish-android.ps1 -WebPublic 'C:/ruta/FrontEnd/public'
```

El script compila release, comprueba paquete y firma, rechaza binarios depurables y genera un manifiesto con versión, tamaño y SHA-256 del APK real. `Descarga.html` usa ese manifiesto; si falta una versión válida, muestra disponibilidad pendiente sin enlazar un APK antiguo. Los botones existentes del Dashboard ya llevan a `/Descarga.html`.

No hay IPA/App Store configurado. Release requiere la firma del propietario; debug sirve para desarrollo y no es una actualización de producción.

## Seguridad y límites

El carnet firmado lo verifica el servidor: un QR fabricado o alterado se rechaza (`INVALID_QR`) y cerrar sesión, cambiar la contraseña o desactivar la cuenta revoca los carnets emitidos, incluidos los guardados sin conexión. Los formatos heredados (`XENTINEL:<id>:<timestamp>` y la identificación JSON de la web) siguen aceptándose para la transición; con `QR_REQUIRE_SIGNED=true` en el servidor el método QR exige el carnet firmado.

Sin conexión, el escáner no puede consultar el estado de la cuenta ni la firma: muestra «Registrado sin conexión» en azul (no en verde) y pide verificar el documento. Al sincronizar, el servidor decide; si rechaza un movimiento o lo registra como denegado, el celador lo ve en «Requieren revisión». La cola expira a las 72 h. Las alertas en tiempo real requieren la app abierta: no hay FCM/APNs en el Backend, por lo que **no se prometen notificaciones con la app cerrada**.

Android release: sin tráfico HTTP en claro, sin copias de seguridad ni transferencia de datos de la app, código Dart ofuscado (`--obfuscate --split-debug-info=build/symbols`). Las migraciones Supabase y plantillas Android antiguas se conservan en un respaldo privado fuera del proyecto; no deben aplicarse al Backend REST actual.


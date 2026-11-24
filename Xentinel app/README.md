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
  services/      HTTP, WebSocket/SSE, red, credencial del carnet (en memoria),
                 renovación de sesión, cámara, brillo, biometría y sonido
assets/          Logo oficial (la X), icono de la app y sonidos (entrada y salida)
config/          Ejemplos sin secretos
test/            Pruebas de lógica, API, cámara y navegación
scripts/         Compilación/distribución y mantenimiento
web-download/    Página y manifiesto para la descarga desde el Dashboard
docs/            Verificación y límites pendientes
```

En Flutter, `providers/` cumple la función del estado y los hooks. Las rutas protegidas son `/home`, `/carnet`, `/alerts` y `/scanner`. El escáner está reservado a Administrador/Celador, además de la autorización del servidor. `/login` y `/forgot-password` son públicas. Las rutas desconocidas permiten volver al inicio. Las transiciones respetan la preferencia de reducir animaciones; las emergencias aparecen inmediatamente.

## Marca, apertura e inicio

- **Icono:** el logo oficial (la X de `LOGO XENTINEL WEB.jpg`) sobre la tinta `#06141B`, generado con `flutter_launcher_icons` desde `assets/icon/` (icono adaptable y monocromo en Android, AppIcon en iOS). Para regenerarlo tras cambiar esas imágenes: `dart run flutter_launcher_icons` (y revertir el cambio que la herramienta hace en `ios/Runner.xcodeproj/project.pbxproj`, ver `docs/ENTREGA.md`).
- **Apertura:** el arranque nativo muestra la X sobre la tinta (`launch_background.xml`, `values-v31/styles.xml`). Flutter continúa desde esa misma imagen: un haz de luz recorre la X, la X sube a su lugar mientras aparecen las facetas y luego entra el formulario (1,6 s, una vez por arranque; con «reducir movimiento» aparece todo quieto). Al ingresar, el inicio se acerca con un fundido y sus bloques entran escalonados.
- **Inicio sin barra inferior:** cada acceso aparece una sola vez. La acción principal depende del rol (escáner para Celador/Administrador, carnet para los demás); las alarmas muestran el semáforo; cerrar sesión está en la cabecera y pide confirmación.

## Red y tiempo real (solo en línea)

```text
 Teléfono (datos móviles / cualquier Wi‑Fi)          Nube (HTTPS 443)
 ┌──────────────────────────────┐   REST + WSS   ┌──────────────────────────┐
 │ ApiClient (JWT renovable)    │ ─────────────▶ │ Caddy (TLS automático)   │
 │ WebSocket /tiempo-real ◀─────┼──── eventos ── │  └ FastAPI + PostgreSQL  │
 │   ↳ SSE /eventos (respaldo)  │                └──────────────────────────┘
 │   ↳ consulta periódica       │
 │ Escáner: valida en línea     │ ── sin red no registra y lo dice
 │ Carnet firmado (en memoria)  │ ── visible solo con sesión y red
 └──────────────────────────────┘
```

| Pieza | Comportamiento |
| --- | --- |
| Servidor | URL HTTPS compilada en la app. Ninguna IP local, puerto manual ni Wi‑Fi compartida. |
| Tiempo real | WebSocket seguro (`wss://…/api/v1/tiempo-real`), autenticado en el primer mensaje (el JWT no va en la URL), ping cada 20 s y vigilancia de inactividad de 45 s. Si una red o proxy bloquea WebSocket, pasa a SSE con el mismo cursor; la consulta periódica queda como red de seguridad (60 s con canal en vivo, 3 s con espera progresiva sin él). |
| Cambios de red | `connectivity_plus` detecta el paso de Wi‑Fi a datos o la recuperación de señal y reconecta al instante. Sin red no gasta batería reintentando. Reconexión con espera exponencial y variación aleatoria. |
| Sesión | El JWT (15 min) se renueva al 75 % de su vigencia con `POST /auth/renovar`, hasta `SESSION_MAX_HOURS` (12 h) desde el ingreso. El canal abierto recibe el token nuevo sin reconectar. |
| Escáner | Solo en línea: cada lectura la confirma el servidor. Sin red no registra nada y muestra «Sin conexión. El escáner necesita internet…». Si la respuesta se pierde, el reintento conserva el `request_id` y nunca duplica el movimiento. |
| Carnet | La clave del carnet firmado vive en memoria mientras hay sesión. Sin red, la pantalla del carnet pide conectarse en lugar de mostrar el QR. Al actualizar, se borra el carnet que las versiones 1.2 y anteriores guardaban para usarlo sin conexión. |
| Reloj | La hora del servidor llega por el canal (`servidor_ms`) y por la cabecera `Date`. |

Contrato bajo `/api/v1`: `auth/login`, `auth/renovar`, `auth/logout`, `auth/olvide-contrasena`, `auth/credencial-qr`, `alertas/activas`, `alarmas`, `alarmas/qr`, `tiempo-real` (WebSocket), `eventos` (SSE) e `ingresos` (`{codigo_qr|id_usuarios, tipo, metodo:'QR', request_id}`). Detalle en `Xentinel web/BackEnd/docs/API.md`. Un servidor antiguo sin estas rutas sigue funcionando: la app usa SSE, el carnet heredado y la sesión vence a los 15 minutos.

## Carnet QR de celular a celular

El carnet usa el formato firmado `XN2:<id>:<paso>:<firma>` (HMAC‑SHA256 emitido por el servidor, rota cada 15 s en el borde exacto según la hora del servidor). Solo contiene caracteres del modo alfanumérico de QR, así cabe en una versión 3 (29×29 módulos) con corrección de errores Q (25 %). La pantalla del carnet sube el brillo de la app al máximo mientras está visible y dibuja el código hasta 320 dp, negro puro sobre blanco con zona de silencio amplia.

**Entrada y salida se distinguen sin mirar dos veces:** al entrar, fondo verde, ícono de ingreso, «Acceso Permitido. ¡Bienvenido!», dos notas que suben y una vibración; al salir, azul institucional, ícono de salida, «Salida Registrada. ¡Hasta pronto!», las mismas notas bajando (`assets/sounds/salida.wav`) y dos vibraciones cortas. El resto del formato (nombre, documento, ficha y aula) no cambia.

## Alarmas (semáforo)

La pantalla **Alarmas** muestra solo rojo (crítico o alto) y amarillo (advertencia); el verde nunca aparece. Reacciona a dos casos: riesgos críticos de la API de gestión de riesgos (sismos de EMSC/USGS y alertas de administración) y, para Celador/Administrador, carnets QR vencidos (amarillo) o que no son verídicos (rojo). El semáforo cuenta y filtra; cada alarma QR se marca como revisada. Un QR que ni siquiera es de Xentinel también se reporta al servidor (`POST /alarmas/qr`) sin frenar la lectura.

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

El carnet firmado lo verifica el servidor: un QR fabricado o alterado se rechaza (`INVALID_QR`, alarma roja), uno vencido también (`QR_EXPIRED`, alarma amarilla), y cerrar sesión, cambiar la contraseña o desactivar la cuenta revoca los carnets emitidos. Los formatos heredados (`XENTINEL:<id>:<timestamp>` y la identificación JSON de la web) siguen aceptándose para la transición; con `QR_REQUIRE_SIGNED=true` en el servidor el método QR exige el carnet firmado.

Sin conexión el escáner no registra: el celador ve el aviso y usa el registro manual de la web si hace falta. Las alarmas en tiempo real llegan con la app abierta; con Firebase configurado, las alertas sísmicas en rojo o amarillo también llegan con la app cerrada.

Android release: sin tráfico HTTP en claro, sin copias de seguridad ni transferencia de datos de la app, código Dart ofuscado (`--obfuscate --split-debug-info=build/symbols`). Las migraciones Supabase y plantillas Android antiguas se conservan en un respaldo privado fuera del proyecto; no deben aplicarse al Backend REST actual.


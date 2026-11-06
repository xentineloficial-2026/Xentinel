# Xentinel móvil — Flutter

Aplicación Flutter/Dart existente, conservada por decisión del usuario. Usa el Backend REST de Xentinel y comparte el azul `#18458D` del Dashboard. No requiere React Native, Expo ni acceso directo a Supabase.

## Ejecutar

Herramientas usadas: Flutter 3.47.7, Dart 3.13.5, Java 21 y SDK Android 36. Comprueba `flutter doctor -v`. En iOS se requiere macOS, Xcode, CocoaPods y un dispositivo con iOS 15.5 o posterior.

```sh
flutter pub get
flutter analyze
flutter test
flutter run --dart-define-from-file=config/development.example.json
flutter build apk --debug --dart-define-from-file=config/development.example.json
```

`development.example.json` conecta el **emulador Android** con `http://10.0.2.2:8000/api/v1`. Inicia el Backend por separado. Para un teléfono real, copia el archivo a `config/development.local.json` y usa la IP LAN de la computadora; ambos deben estar en la misma red. HTTP solo se permite explícitamente en debug. No incluyas credenciales en la configuración.

Las herramientas y dependencias locales se retiran después de exportar el APK. Instala los SDK fuera del código fuente y ejecuta `flutter pub get` para reconstruir. `setup.bat` y `setup.sh` solo restauran dependencias; no sobrescriben Android/iOS. El APK de pruebas usa `config/usb.example.json`; consulta `docs/INSTALAR_APK.md` para conectarlo al Backend por USB.

## Arquitectura

```text
lib/
  components/    Tarjetas y aviso global de emergencias
  core/          Configuración, sesión, rutas, colores y textos compartidos
  models/        Usuarios, resultados de acceso y alertas
  providers/     Estado reactivo (Riverpod), carnet y monitor de alertas
  repositories/  Contratos de autenticación, accesos y alertas
  screens/       Login, recuperación, inicio, carnet, cámara y alertas
  services/      HTTP, SSE, permisos/cámara, biometría y sonido
assets/          Logo y sonidos originales
config/          Ejemplos sin secretos
test/            Pruebas de lógica, API, cámara y navegación
scripts/         Compilación/distribución y mantenimiento
web-download/    Página y manifiesto para la descarga desde el Dashboard
docs/            Verificación y límites pendientes
```

En Flutter, `providers/` cumple la función del estado y los hooks. Las rutas protegidas son `/home`, `/carnet`, `/alerts` y `/scanner`. El escáner está reservado a Administrador/Celador, además de la autorización del servidor. `/login` y `/forgot-password` son públicas. Las rutas desconocidas permiten volver al inicio. Las transiciones respetan la preferencia de reducir animaciones; las emergencias aparecen inmediatamente.

## Backend localizado y contrato

Se verificó el código en `C:/Users/kevin/Music/Xentinel con alarma/Xentinel version Claudia/Xentinel version Claudia/Xentinel/BackEnd`. Configura el despliegue mediante `API_BASE_URL`; no se ha supuesto una URL de producción.

| Método | Ruta bajo `/api/v1` | Uso |
|---|---|---|
| POST | `auth/login` | `{documento, contrasena}` → JWT, vencimiento y usuario |
| POST | `auth/logout` | Revoca la sesión del servidor |
| POST | `auth/olvide-contrasena` | `{correo}`; respuesta genérica sin revelar cuentas |
| GET | `alertas/activas` | Lista de alertas activas con severidad y mensaje |
| GET | `eventos` | SSE autenticado: `change`, `checkpoint`, `auth-expired` |
| POST | `ingresos` | `{id_usuarios, tipo, metodo: 'QR', request_id}` |

El cliente usa `package:http`, equivalente nativo de Fetch para Flutter, con cancelación, timeout y JWT en memoria. Lee `data` y `error` en las respuestas. Un 401 vence la sesión sin permitir que una respuesta antigua cierre una sesión nueva. Las escrituras no se reintentan automáticamente; un reintento del mismo escaneo conserva su UUID de idempotencia. Una respuesta perdida se muestra en amarillo como **acceso sin confirmar**.

Las alertas llegan por SSE con reconexión y cursor; hay consulta de respaldo cada 3 segundos mientras la app está abierta, con espera progresiva ante errores. Las últimas alertas se conservan si se pierde conexión y se marcan como desactualizadas. No hay FCM/APNs en el Backend encontrado: **no se prometen notificaciones con la app cerrada**. Recuperar contraseña requiere SMTP y la página de restablecimiento del servidor.

## Cámara

`CameraSession` es el único propietario del ciclo de vida. Comprueba permisos antes de montar el preview y los solicita mediante una acción explícita. Distingue denegación, bloqueo permanente, restricción, cámara no disponible e inicialización fallida. Detiene la cámara al cambiar de ruta o ir al fondo y comprueba el permiso al regresar. Una cola compartida serializa inicio, parada y liberación, incluso al abrir y cerrar rápidamente. Android declara CAMERA; iOS incluye los propósitos de cámara/Face ID y el macro de permiso de CocoaPods.

Las pruebas automatizadas usan cámara simulada. El enfoque, lectura y permisos reales deben validarse con `docs/VALIDACION.md` en teléfonos físicos.

## Distribución y Dashboard

El identificador Android es `co.edu.sena.xentinel`. No se publican APK de debug como versiones oficiales. Configura `android/key.properties` con la **clave de firma existente** para actualizar instalaciones y crea `config/production.local.json` con una URL HTTPS real. Nunca confirmes esos archivos en control de versiones.

```properties
# android/key.properties — ruta relativa a android/ o absoluta
storeFile=C:/ruta/segura/xentinel.jks
storePassword=TU_CLAVE
keyAlias=TU_ALIAS
keyPassword=TU_CLAVE
```

```powershell
./scripts/publish-android.ps1 -ConfigFile config/production.local.json -WebPublic 'C:/ruta/FrontEnd/public'
```

El script compila release, comprueba paquete y firma, rechaza binarios depurables y genera un manifiesto con versión, tamaño y SHA-256 del APK real. `Descarga.html` usa ese manifiesto; si falta una versión válida, muestra disponibilidad pendiente sin enlazar un APK antiguo. Los botones existentes del Dashboard ya llevan a `/Descarga.html`.

No hay IPA/App Store configurado. Release requiere la firma del propietario; debug sirve para desarrollo y no es una actualización de producción.

## Límites del contrato heredado

El QR `XENTINEL:<id>:<timestamp>` se renueva cada 15 s y la app comprueba una ventana de 45 s. **No está firmado criptográficamente**. El Backend valida operador, estado, alternancia e idempotencia; el timestamp validado solo en el móvil no demuestra autenticidad del carnet. Antes de utilizarlo como credencial de seguridad, debe añadirse emisión y verificación de QR firmados en el servidor. No se sustituyó ese contrato sin una migración coordinada.

Las migraciones Supabase y plantillas Android antiguas se conservan en un respaldo privado fuera del proyecto ejecutable al realizar la limpieza; no deben aplicarse al Backend REST actual.


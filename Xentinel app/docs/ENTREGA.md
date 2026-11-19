# Entrega del 19 de noviembre de 2026 — v1.2.0 (5)

- **Recuperación con código:** la contraseña se restablece con un código de 6 dígitos enviado desde el Gmail de Xentinel (Gmail API o contraseña de aplicación por SMTP). Vence a los 15 minutos, admite 5 intentos y se guarda cifrado con HMAC en el servidor. El correo es HTML de tema oscuro con versión en texto.
- **Alertas sísmicas:** el backend escucha EMSC por WebSocket y consulta USGS como respaldo, filtra por distancia a la sede y magnitud, y deduplica entre agencias. Crea la alerta de emergencia que la web y la app muestran al instante, y la envía por Firebase Cloud Messaging al tema `alertas_sismo`. En Android: canal `canal_sismos_critico` con importancia máxima, sirena propia, categoría de alarma (pasa No molestar), acceso opcional a No molestar y pantalla completa con el teléfono bloqueado.
- Firebase es opcional: sin `google-services.json` la app compila y funciona igual, sin notificaciones push.

---

# Entrega del 14 de noviembre de 2026 — v1.1.1 (4)

Producción en la nube, sin IP locales ni puertos, y lectura QR de celular a celular.

- **Despliegue:** API FastAPI en Render (`https://xentinel-api.onrender.com`), web estática en Render y base PostgreSQL en Supabase (Session pooler IPv4, rol propio `xentinel_api` sin privilegios de administrador, RLS en todas las tablas). La app trae la URL de producción por defecto; HTTP y el diálogo de servidor solo existen en compilaciones de desarrollo.
- **Tiempo real:** WebSocket seguro autenticado por mensaje, con respaldo SSE y consulta de seguridad; reconexión inmediata al cambiar de red (`connectivity_plus`), espera exponencial con variación aleatoria, vigilancia de inactividad y sincronización del reloj del servidor.
- **Sesión:** renovación automática del JWT (`POST /auth/renovar`) con duración máxima configurable; las alertas y el canal no se reinician al renovar.
- **Sin conexión:** cola persistente e idempotente de accesos con la hora del escaneo; carnet firmado guardado en Keystore/Keychain y accesible sin sesión tras biometría.
- **QR:** carnet `XN2` firmado (HMAC‑SHA256, verificado y revocable en el servidor), alfanumérico versión 3 con corrección Q, hasta 320 dp y brillo máximo. Escáner a 1280×720 con zoom automático, enfoque al tocar, zoom manual, preferencia por códigos Xentinel y antirrebote por persona. El lector web acepta el carnet de la app.
- **Producción:** Android sin tráfico en claro ni copias de seguridad de datos de la app, código ofuscado y una sola APK arm64.
- **Backend:** módulo `credenciales.py`, WebSocket `/api/v1/tiempo-real`, `codigo_qr` y `escaneado_en` en `POST /ingresos`, migración `004_rls_correo_opcional`, SMTP opcional en producción y pool configurable (`DB_POOL_MAX`).

Instalación: `INSTALAR_APK.md`. Pruebas en teléfonos reales: `VALIDACION.md`.

---

# Entrega del 24 de octubre de 2026

Se conserva Flutter/Dart por elección explícita del usuario. Versión **1.0.1 (2)**; paquete `co.edu.sena.xentinel`.

## Cambios

- Cámara con permiso previo, estados claros, reanudación al volver de Ajustes, pausa al cubrir la ruta o ir al fondo y operaciones nativas serializadas. Preview estable durante las pausas.
- Login REST/JWT, recuperación `auth/olvide-contrasena`, cierre y caducidad de sesión. Sin contraseñas ni JWT en preferencias.
- Alertas por severidad, indicaciones del Backend, banner global, SSE autenticado y polling de respaldo. Se conserva la última alerta cuando falla la red.
- Cierre ordenado del canal SSE: la prueba real permitió corregir una excepción al cancelar una transmisión activa.
- Saludos con nombre/hora, textos cercanos, transiciones que respetan reducción de movimiento, azul `#18458D`, blanco/negro y colores de estado conservados.
- Rutas desconocidas recuperables, protección por rol, scroll y QR adaptable al ancho.
- Permisos Android/iOS, tema Android compatible con biometría y configuración CocoaPods de cámara.
- Código modular; contratos Supabase, plantillas duplicadas y configuración obsoleta retirados.
- Descarga del Dashboard mediante manifiesto validado; el enlace público espera un APK firmado por el propietario y ya no enlaza el binario anterior.

## Evidencia

Los registros están en `entrega/evidencia/`, junto a los instalables:

- 22 pruebas Flutter de lógica, API, cámara, navegación y pantalla pequeña aprobadas.
- 2 pruebas JavaScript del manifiesto de descarga aprobadas.
- 1 integración aprobada con servicios Flutter, Backend real y PostgreSQL 17 desechable: login, recuperación sin correo, idempotencia, entrada/salida, SSE, consulta/cierre de alertas y logout/401.
- Compilación Android debug exitosa; se exporta nuevamente con la corrección final de SSE.
- `analisis-flutter.log` y `compilacion-android.log` contienen los resultados finales. `SHA256SUMS.txt` identifica los entregables.

La integración utilizó una base temporal con usuarios ficticios; no cargó `.env` ni datos de producción, ni envió correos. El servidor y su base temporal se retiraron al terminar.

## Alcance

El APK es **de pruebas, firmado con clave de desarrollo**, con `http://127.0.0.1:8000/api/v1` mediante `adb reverse`. Ver `INSTALAR_APK.md`. Producción requiere HTTPS operativo y la firma existente del propietario.

No había teléfono Android conectado: no se han probado lectura óptica, enfoque ni permisos físicos. No se compiló iOS en Windows. No se afirma funcionamiento del 100 % en hardware no disponible.

SSE/polling requiere la app abierta. No hay FCM/APNs ni entrega garantizada con la app cerrada. Recuperación por correo requiere SMTP. El QR heredado no está firmado; necesita emisión/verificación en el servidor antes de considerarse prueba criptográfica de identidad.

## Limpieza

Después de verificar el instalador se retiran `build`, `.dart_tool`, cachés Android, archivos Flutter generados y `.tooling` (Flutter, Pub, Java, Android SDK, Gradle y descargas). Se conservan fuente, assets, pruebas, `pubspec.lock`, archivos nativos y documentación. Los archivos antiguos pequeños están respaldados fuera del proyecto en `_archive/mobile-legacy-20261022/`.

Para reconstruir, instala los SDK fuera del proyecto y ejecuta `flutter pub get`. El resultado de limpieza queda en `entrega/evidencia/limpieza.json`.

## Complementos

No se localizaron coincidencias exactas para Code Assistant, EngineeringSuite o UI Consistency en el catálogo consultado. No se activaron complementos con otros nombres. Se verificó la consistencia directamente contra el Dashboard existente.


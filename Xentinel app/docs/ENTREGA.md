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


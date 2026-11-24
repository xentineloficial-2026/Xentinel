# Instalar la APK de Xentinel 1.2.0 (5)

Se entrega una sola APK de producción para Android 7.0 o posterior en teléfonos de 64 bits (`arm64-v8a`, la arquitectura de los teléfonos Android actuales). Es optimizada, ofuscada y sin depuración, y solo usa HTTPS/WSS.

La API está fija en la app: `https://xentinel-api.onrender.com` (Render, con la base de datos en Supabase). Funciona con datos móviles o con cualquier Wi‑Fi, sin configurar IP ni puertos.

## Firma

La APK está firmada con una **clave de evaluación** (`CN=Xentinel Evaluacion`). Se instala directamente, pero no actualiza una instalación firmada con otra clave (Android pide desinstalar primero). Para publicarla como versión oficial, fírmala con tu clave de producción:

```sh
apksigner sign --ks /ruta/segura/xentinel.jks --ks-key-alias TU_ALIAS --out xentinel-oficial.apk xentinel-1.2.0-5-arm64.apk
```

Lo ideal es compilar directamente con tu firma en `android/key.properties`: `./scripts/build-release.sh` (Linux/macOS) o `scripts/publish-android.ps1` (Windows).

## Instalar

1. Copia la APK al teléfono y ábrela (permite «instalar apps desconocidas» para el administrador de archivos), o ejecuta `adb install -r xentinel-1.2.0-5-arm64.apk`.
2. Inicia sesión. El rol Administrador o Celador habilita el escáner; la cámara se pide al abrirlo.
3. Acepta las notificaciones. En **Alertas** puedes permitir que la alerta sísmica se muestre a pantalla completa con el teléfono bloqueado y que suene en modo No molestar (requiere Firebase, ver `DESPLIEGUE.md`).

El plan gratuito de Render suspende la API tras 15 minutos sin uso: la primera petición posterior puede tardar cerca de un minuto. La app valida en línea: mientras la API despierta, el escáner informa que no pudo confirmar y basta con volver a escanear (nunca duplica el movimiento).

## Qué probar primero

Recorre `VALIDACION.md`, en especial 5a–5e: lectura de celular a celular a distintas distancias y con brillo bajo, teléfonos en redes distintas, modo avión en el escáner (no registra y lo avisa) y carnet sin red (pide conectarse).

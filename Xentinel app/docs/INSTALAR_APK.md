# Instalar la APK de Xentinel 1.3.0 (6)

Se entrega una sola APK de producción para Android 7.0 o posterior en teléfonos de 64 bits (`arm64-v8a`, la arquitectura de los teléfonos Android actuales). Es optimizada, ofuscada y sin depuración, y solo usa HTTPS/WSS.

La API está fija en la app: `https://xentinel-api.onrender.com` (Render, con la base de datos en Supabase). Funciona con datos móviles o con cualquier Wi‑Fi, sin configurar IP ni puertos.

## Firma

Desde la 1.3.0 la APK se firma con la **clave del proyecto** (`CN=Xentinel, OU=SENA Fontibon, O=Xentinel, C=CO`, alias `xentinel`, RSA 4096, válida 30 años). Las próximas versiones deben firmarse con esta misma clave para que el teléfono las instale como actualización.

La 1.2.0 se firmó con una clave de evaluación (`CN=Xentinel Evaluacion`) que ya no existe. **En los teléfonos que tengan la 1.2.0, desinstálala una vez antes de instalar la 1.3.0**: Android no deja actualizar entre claves distintas. Después basta con volver a iniciar sesión.

La clave (`xentinel-release.jks`) y sus contraseñas nunca entran al repositorio. Guárdalas en un lugar seguro y compila con ellas en `android/key.properties`:

```properties
storeFile=/ruta/segura/xentinel-release.jks
storePassword=…
keyAlias=xentinel
keyPassword=…
```

Luego ejecuta `./scripts/build-release.sh` (Linux/macOS) o `scripts/publish-android.ps1` (Windows). El script rechaza APK depurables o firmadas con la clave de depuración.

## Instalar

1. Si el teléfono tiene la 1.2.0, desinstálala primero.
2. Descarga la APK desde la página **Descargar app** de la web, o cópiala al teléfono y ábrela (permite «instalar apps desconocidas» para el navegador o el administrador de archivos). Con un cable: `adb install -r xentinel-1.3.0-6.apk`.
3. Inicia sesión. El rol Administrador o Celador habilita el escáner; la cámara se pide al abrirlo.
4. Acepta las notificaciones. En **Alarmas** puedes permitir que la alerta sísmica se muestre a pantalla completa con el teléfono bloqueado y que suene en modo No molestar (requiere Firebase, ver `DESPLIEGUE.md`).

El plan gratuito de Render suspende la API tras 15 minutos sin uso: la primera petición posterior puede tardar cerca de un minuto. La app valida en línea: mientras la API despierta, el escáner informa que no pudo confirmar y basta con volver a escanear (nunca duplica el movimiento).

## Qué probar primero

Recorre `VALIDACION.md`, en especial 5a–5e: lectura de celular a celular a distintas distancias y con brillo bajo, teléfonos en redes distintas, modo avión en el escáner (no registra y lo avisa) y carnet sin red (pide conectarse).

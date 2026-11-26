# Instalar la APK de Xentinel 1.3.1 (7)

Se entrega una sola APK de producción para Android 7.0 o posterior en teléfonos de 64 bits (`arm64-v8a`, la arquitectura de los teléfonos Android actuales). Es optimizada, ofuscada y sin depuración, y solo usa HTTPS/WSS.

La API está fija en la app: `https://xentinel-api.onrender.com` (Render, con la base de datos en Supabase). Funciona con datos móviles o con cualquier Wi‑Fi, sin configurar IP ni puertos.

## Firma

Todas las versiones se firman con la **clave del proyecto** (`CN=Xentinel, OU=SENA Fontibon, O=Xentinel, C=CO`, alias `xentinel`, RSA 4096, válida 30 años), con los esquemas **v1, v2 y v3**. Huella SHA-256 del certificado:

```
9ec23372e0afd1e7ee6843db7713a1a2cc8d18a16d8806c2ff8f83f373b5ef06
```

Con la misma clave, Android instala cada versión nueva encima de la anterior (desde la 1.3.0). Los scripts de publicación fijan esa huella: si el APK sale firmado con otra clave, con la de depuración o sin alguno de los tres esquemas, no se publica.

La clave (`xentinel-release.jks`) y sus contraseñas nunca entran al repositorio. Guárdalas en un lugar seguro y compila con ellas en `android/key.properties`:

```properties
storeFile=/ruta/segura/xentinel-release.jks
storePassword=…
keyAlias=xentinel
keyPassword=…
```

Luego ejecuta `./scripts/build-release.sh` (Linux/macOS) o `scripts/publish-android.ps1` (Windows).

Los teléfonos que aún tengan la 1.2.0 (firmada con una clave de evaluación que ya no existe) necesitan quitarla una vez; de la 1.3.0 en adelante las actualizaciones se instalan solas.

## Permisos

Solo los que usa la app: internet y estado de la red, cámara (escáner), vibración, huella o rostro (ingreso rápido) y notificaciones. Desde la 1.3.1 no pide pantalla completa sobre el bloqueo, acceso a No molestar ni mostrarse con el teléfono bloqueado: Play Protect trata esos permisos como propios de apps que se apoderan de la pantalla. La alerta sísmica llega como notificación de prioridad máxima con sirena.

## Instalar

1. Descarga la APK desde la página **Descargar app** de la web, o cópiala al teléfono y ábrela (permite «instalar apps desconocidas» para el navegador o el administrador de archivos). Con un cable: `adb install -r xentinel-1.3.1-7.apk`.
2. Inicia sesión. El rol Administrador o Celador habilita el escáner; la cámara se pide al abrirlo.
3. Acepta las notificaciones. Las alertas sísmicas con la app cerrada requieren Firebase (ver `DESPLIEGUE.md`).

El plan gratuito de Render suspende la API tras 15 minutos sin uso: la primera petición posterior puede tardar cerca de un minuto. La app valida en línea: mientras la API despierta, el escáner informa que no pudo confirmar y basta con volver a escanear (nunca duplica el movimiento).

## Qué probar primero

Recorre `VALIDACION.md`, en especial 5a–5e: lectura de celular a celular a distintas distancias y con brillo bajo, teléfonos en redes distintas, modo avión en el escáner (no registra y lo avisa) y carnet sin red (pide conectarse).

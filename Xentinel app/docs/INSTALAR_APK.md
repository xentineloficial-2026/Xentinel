# Instalar el APK de pruebas

El archivo entregado es **Xentinel 1.0.1 (2), debug**, firmado para desarrollo. No sustituye la firma de producción ni debe distribuirse como versión oficial. Contiene el mismo código de la entrega y ninguna credencial de usuario.

## Conectar al Backend local por USB

El APK usa `http://127.0.0.1:8000/api/v1`, con HTTP habilitado exclusivamente para pruebas. Para que esa dirección llegue a la computadora:

1. Inicia el Backend Xentinel con su configuración de base de datos y puerto 8000 siguiendo el README del Backend.
2. Conecta Android por USB y autoriza la depuración de tu computadora. Instala Android Platform Tools si no tienes `adb`.
3. Ejecuta:

```sh
adb devices
adb install -r xentinel-1.0.1-pruebas.apk
adb reverse tcp:8000 tcp:8000
adb shell am start -n co.edu.sena.xentinel/.MainActivity
```

4. Ingresa con una cuenta del Backend. El rol Administrador o Celador permite abrir el escáner. Los permisos de cámara se piden al abrirlo.

`adb reverse` también funciona con un emulador conectado. Debes restablecerlo al reconectar el teléfono. Si Android informa que la firma no coincide con una instalación anterior, conserva esa instalación y usa otro dispositivo/perfil para probar; no es una actualización de producción firmada por el propietario.

## Usar Wi-Fi o producción

Para pruebas por Wi-Fi recompila debug usando una IP LAN en `config/development.local.json`. Para distribución configura HTTPS real, la clave de firma existente y `config/production.local.json`, y ejecuta `scripts/publish-android.ps1`. Los ejemplos no contienen un servidor de producción.

El envío de correos depende de SMTP del Backend. Las alertas SSE/polling se reciben con la app abierta. La lectura óptica y los permisos de cámara reales siguen pendientes de validación física; no había un teléfono conectado durante la entrega.

## Integración reproducible sin datos reales

`scripts/backend-smoke-server.mjs` inicia el Backend real sobre una base temporal, únicamente en `127.0.0.1:55439`. Requiere un cluster PostgreSQL desechable en ese puerto y las dependencias del Backend ya instaladas:

```sh
node scripts/backend-smoke-server.mjs RUTA_AL_BACKEND postgresql://postgres@127.0.0.1:55439/postgres
flutter test test_backend/backend_smoke_test.dart --dart-define=ALLOW_INSECURE_HTTP=true
```

Escribe `stop` en la terminal del servidor al finalizar: cierra los eventos y elimina solo la base temporal que creó. La prueba valida login, recuperación sin enviar correo, entrada/salida idempotentes, emisión/consulta/cierre de alertas SSE y revocación del JWT al cerrar sesión.

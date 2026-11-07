# Xentinel en cualquier red

Hoy la app busca el backend en tu PC, por eso solo sirve en tu Wi-Fi y con el puerto abierto. Para que funcione con solo instalarla, el backend y la base de datos tienen que vivir en internet, en una dirección `https://` fija.

Esta guía deja el **piloto gratis**:

| Parte | Servicio | Límite del plan gratis |
|---|---|---|
| Backend `xentinel-api` | Render | Se duerme tras 15 minutos sin uso y tarda cerca de un minuto en despertar |
| Web `xentinel-web` | Render, sitio estático | Las actualizaciones se publican al hacer push |
| Base de datos | Neon | 1 GB; se suspende sin uso y tiene un límite mensual de cómputo |
| Correo | Brevo | 300 correos al día |

**Este plan sirve para probar y mostrar el proyecto. Antes de atender emergencias reales, pasa el backend a un plan de pago que no se duerma.** No uses servicios que hagan pings para mantenerlo despierto: agotarían las horas gratis de Render y el cómputo de Neon.

El repositorio ya está en <https://github.com/xentineloficial-2026/Xentinel>.

## 1. Crear la base en Neon

1. Crea una cuenta en <https://neon.com> y un proyecto llamado `xentinel`.
2. Elige la región **AWS US East (N. Virginia)**, cerca del backend, y Postgres **18** si está disponible.
3. En **Connect**, **desactiva "Connection pooling"** y copia el enlace. No debe contener `-pooler`, porque el backend envía opciones de conexión que el modo pooled no admite.

Guarda ese enlace como `DATABASE_URL`. Es un secreto.

## 2. Pasar tus datos actuales (opcional)

Este paso lleva datos personales reales a un servidor externo. Si tu institución tiene reglas al respecto, revísalas antes. Si lo omites, el backend crea las tablas vacías al arrancar.

Desde la carpeta del proyecto:

```bash
pg_dump --no-owner --no-acl --format=custom --file=xentinel-privado/para-render.dump "postgresql://USUARIO:CLAVE@127.0.0.1:5432/xentinel"
```

```bash
pg_restore --no-owner --no-acl --clean --if-exists --dbname="DATABASE_URL_DE_NEON" xentinel-privado/para-render.dump
```

`pg_restore` puede mostrar avisos sobre extensiones o el esquema `public`. Si la tabla `usuarios` tiene tus datos, el resultado es correcto.

## 3. Preparar el correo en Brevo

El backend no arranca en producción sin correo, y el plan gratis de Render bloquea los puertos habituales. Por eso se usa Brevo por el puerto 2525, ya configurado en `render.yaml`.

1. Crea una cuenta en <https://www.brevo.com>.
2. En **Settings > Senders & IPs > Senders**, agrega y verifica el correo que enviará los mensajes.
3. En **SMTP & API > SMTP**, genera una **clave SMTP** y anota el usuario de inicio de sesión.

## 4. Crear los servicios en Render

1. En <https://dashboard.render.com>, elige **New > Blueprint** y conecta GitHub con la cuenta `xentineloficial-2026`.
2. Selecciona el repositorio `Xentinel` y confirma que ambos servicios aparezcan como gratis.
3. Escribe estos valores:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | El enlace directo de Neon |
| `JWT_SECRET` | Está en `xentinel-privado/render-secretos.txt` |
| `MAIL_ENCRYPTION_KEY` | Está en `xentinel-privado/render-secretos.txt` |
| `WEB_ORIGINS` | `https://xentinel-web.onrender.com` |
| `RESET_PASSWORD_URL` | `https://xentinel-web.onrender.com/restablecer-contrasena` |
| `SMTP_USER` | El usuario SMTP de Brevo |
| `SMTP_PASS` | La clave SMTP de Brevo |
| `SMTP_FROM` | `Xentinel <tu-correo-verificado>` |
| `VITE_API_URL` | `https://xentinel-api.onrender.com` (sin `/api/v1`) |

Render puede cambiar esas direcciones si el nombre ya está ocupado. Si pasa, corrige `WEB_ORIGINS`, `RESET_PASSWORD_URL` y `VITE_API_URL` con las reales, y vuelve a desplegar la web.

4. Comprueba que `https://xentinel-api.onrender.com/ready` responda `{"status":"ready"}`. La primera vez puede tardar cerca de un minuto.

Si el despliegue falla, revisa primero en los registros el correo (usuario, clave y remitente verificado) y luego el enlace de Neon.

## 5. Compilar la APK definitiva (Android)

1. Copia `Xentinel app/config/production.example.json` como `production.json` y pon tu API: `https://xentinel-api.onrender.com/api/v1`.
2. Crea la firma, una sola vez. `keytool` viene con Android Studio. Guarda el archivo y las claves fuera del repositorio: sin ellos no podrás actualizar la app.

```bash
keytool -genkey -v -keystore xentinel.jks -alias xentinel -keyalg RSA -keysize 2048 -validity 10000
```

3. Crea `Xentinel app/android/key.properties`. La ruta de `storeFile` es relativa a la carpeta `android`:

```properties
storeFile=../../xentinel-privado/xentinel.jks
storePassword=TU_CLAVE
keyAlias=xentinel
keyPassword=TU_CLAVE
```

4. Compila y publica en la página de descarga, desde `Xentinel app`:

```powershell
.\scripts\publish-android.ps1 -ConfigFile config\production.json -WebPublic "..\Xentinel web\FrontEnd\public"
```

5. Haz commit y push de `public/downloads` y `app-release.json` para que Render publique la APK.

Con esta compilación desaparece "Configurar servidor" y se ignora cualquier IP vieja guardada en el teléfono.

## 6. iPhone (iOS)

El proyecto ya incluye la carpeta `ios`, pero Apple exige dos cosas que no se pueden reemplazar desde Windows:

- **Una Mac**, propia o en la nube (por ejemplo Codemagic), para compilar.
- **Una cuenta de Apple Developer** (99 USD al año), para instalar en iPhones. Las instituciones educativas acreditadas pueden solicitar una exención. No existe un equivalente a "descargar la APK": se instala por TestFlight, App Store o distribución empresarial.

Comando, en la Mac:

```bash
flutter build ipa --dart-define-from-file=config/production.json
```

## Al pasar a producción

En el panel de Render, cambia `xentinel-api` a un plan de pago para que no se duerma. Render permite además enviar correo por los puertos normales en los planes de pago.

## Qué funciona sin internet

Dos teléfonos no pueden validar un acceso entre sí sin un servidor común. Con el servidor en internet sirve cualquier Wi-Fi o datos móviles, pero sin ninguna conexión el registro no llega al servidor.

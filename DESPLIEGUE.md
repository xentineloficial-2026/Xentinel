# Xentinel en cualquier red

La app, la web y el backend viven en internet, en direcciones `https://` fijas. La app funciona con solo instalarla: con datos móviles o con cualquier Wi-Fi, sin escribir IP ni abrir puertos.

| Parte | Servicio | Dirección | Límite del plan gratis |
|---|---|---|---|
| Backend `xentinel-api` | Render | <https://xentinel-api.onrender.com> | Se duerme tras 15 minutos sin uso y tarda cerca de un minuto en despertar |
| Web `xentinel-web` | Render, sitio estático | <https://xentinel-web.onrender.com> | Las actualizaciones se publican al hacer push |
| Base de datos | Supabase (PostgreSQL 17) | Proyecto `btecqrdsbbrejtltlzto`, us-east-1 | 500 MB; el proyecto se pausa tras una semana sin actividad |
| Correo (opcional) | Brevo | `smtp-relay.brevo.com:2525` | 300 correos al día |

**Este plan sirve para probar y mostrar el proyecto. Antes de atender emergencias reales, pasa el backend a un plan de pago que no se duerma.** No uses servicios que hagan pings para mantenerlo despierto: agotarían las horas gratis de Render.

El repositorio está en <https://github.com/xentineloficial-2026/Xentinel>. Cada push a `main` vuelve a desplegar la API y la web.

## 1. Base de datos en Supabase

La base ya está creada. El backend no usa el usuario `postgres`: se conecta con su propio usuario, `xentinel_api`, dueño de las tablas de Xentinel, sin permisos de administrador. Al arrancar, el backend aplica solo las migraciones pendientes (`python -m xentinel migrar`).

- Todas las tablas tienen RLS activado y sin acceso para `anon` ni `authenticated`: la API de datos de Supabase no expone nada. El único cliente es el backend.
- La conexión usa el **Session pooler** (IPv4, puerto 5432), porque Render no llega a la conexión directa de Supabase, que solo admite IPv6:

```text
postgresql://xentinel_api.btecqrdsbbrejtltlzto:CLAVE@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

- El pooler admite 15 conexiones en el plan gratis; `DB_POOL_MAX=8` deja margen para los despliegues.

Para cambiar la clave de `xentinel_api`, ejecuta en el **SQL Editor** de Supabase `ALTER ROLE xentinel_api PASSWORD 'clave-nueva';` y actualiza `DATABASE_URL` en Render.

## 2. Pasar tus datos actuales (opcional)

Este paso lleva datos personales reales a un servidor externo. Si tu institución tiene reglas al respecto, revísalas antes. Si lo omites, la base queda con las tablas vacías.

Desde la carpeta del proyecto:

```bash
pg_dump --no-owner --no-acl --format=custom --file=xentinel-privado/para-supabase.dump "postgresql://USUARIO:CLAVE@127.0.0.1:5432/xentinel"
```

```bash
pg_restore --no-owner --no-acl --clean --if-exists --dbname="DATABASE_URL_DE_RENDER" xentinel-privado/para-supabase.dump
```

Usa el mismo `DATABASE_URL` del backend, para que las tablas sigan siendo de `xentinel_api`. `pg_restore` puede mostrar avisos sobre extensiones o el esquema `public`. Después, en Render, abre `xentinel-api` y elige **Manual Deploy > Restart service**: al arrancar se aplican las migraciones que falten.

## 3. Correo con Brevo (opcional)

Sin correo, la API funciona igual y la recuperación de contraseña responde que no está disponible. Para activarla:

1. Crea una cuenta en <https://www.brevo.com>.
2. En **Settings > Senders & IPs > Senders**, agrega y verifica el correo que enviará los mensajes.
3. En **SMTP & API > SMTP**, genera una **clave SMTP** y anota el usuario de inicio de sesión.
4. En Render, en `xentinel-api` > **Environment**, escribe `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` (`Xentinel <tu-correo-verificado>`). El puerto 2525 ya está en `render.yaml`.

## 4. Servicios en Render

Los dos servicios se crean desde `render.yaml` (**New > Blueprint**, repositorio `Xentinel`, ambos gratis). Valores del panel:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | El enlace del Session pooler de la sección 1 |
| `JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `QR_SECRET` | Secretos aleatorios propios de producción; no reutilices los de tu `.env` |
| `WEB_ORIGINS` | `https://xentinel-web.onrender.com` |
| `RESET_PASSWORD_URL` | `https://xentinel-web.onrender.com/restablecer-contrasena` |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Vacíos hasta configurar Brevo |
| `VITE_API_URL` | `https://xentinel-api.onrender.com` (sin `/api/v1`) |

Comprueba que `https://xentinel-api.onrender.com/ready` responda `{"status":"ready"}`. La primera vez puede tardar cerca de un minuto.

Si el despliegue falla, revisa en los registros de `xentinel-api` primero el enlace de Supabase (usuario, clave y host del pooler) y luego el correo.

## 5. Compilar la APK definitiva (Android)

`Xentinel app/config/production.json` ya apunta a `https://xentinel-api.onrender.com/api/v1`, y la app usa esa misma dirección por defecto.

1. Crea la firma, una sola vez. `keytool` viene con Android Studio. Guarda el archivo y las claves fuera del repositorio: sin ellos no podrás actualizar la app.

```bash
keytool -genkey -v -keystore xentinel.jks -alias xentinel -keyalg RSA -keysize 2048 -validity 10000
```

2. Crea `Xentinel app/android/key.properties`. La ruta de `storeFile` es relativa a la carpeta `android`:

```properties
storeFile=../../xentinel-privado/xentinel.jks
storePassword=TU_CLAVE
keyAlias=xentinel
keyPassword=TU_CLAVE
```

3. Compila una sola APK arm64, optimizada y ofuscada, desde `Xentinel app`:

```bash
./scripts/build-release.sh
```

En Windows, el script además la publica en la página de descarga de la web:

```powershell
.\scripts\publish-android.ps1 -WebPublic "..\Xentinel web\FrontEnd\public"
```

4. Si la publicaste en la web, haz commit y push de `public/downloads` y `app-release.json` para que Render la sirva.

Esta compilación no muestra "Configurar servidor" e ignora cualquier IP vieja guardada en el teléfono.

## 6. iPhone (iOS)

El proyecto ya incluye la carpeta `ios`, pero Apple exige dos cosas que no se pueden reemplazar desde Windows:

- **Una Mac**, propia o en la nube (por ejemplo Codemagic), para compilar.
- **Una cuenta de Apple Developer** (99 USD al año), para instalar en iPhones. Las instituciones educativas acreditadas pueden solicitar una exención. No existe un equivalente a "descargar la APK": se instala por TestFlight, App Store o distribución empresarial.

Comando, en la Mac:

```bash
flutter build ipa --dart-define-from-file=config/production.json
```

## Al pasar a producción

En el panel de Render, cambia `xentinel-api` a un plan de pago para que no se duerma; los planes de pago también permiten el correo por los puertos normales. En Supabase, un plan de pago evita la pausa por inactividad y agrega respaldos diarios.

## Qué funciona sin internet

Dos teléfonos no pueden validar un acceso entre sí sin un servidor común. Con el servidor en internet sirve cualquier Wi-Fi o datos móviles. Sin conexión, el escáner guarda cada lectura en el teléfono y la envía al servidor cuando vuelve la red, y el carnet se puede mostrar sin conexión tras iniciar sesión una vez.

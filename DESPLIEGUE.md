# Xentinel en cualquier red

La app, la web y el backend viven en internet, en direcciones `https://` fijas. La app funciona con solo instalarla: con datos móviles o con cualquier Wi-Fi, sin escribir IP ni abrir puertos.

| Parte | Servicio | Dirección | Límite del plan gratis |
|---|---|---|---|
| Backend `xentinel-api` | Render | <https://xentinel-api.onrender.com> | Se duerme tras 15 minutos sin uso y tarda cerca de un minuto en despertar |
| Web `xentinel-web` | Render, sitio estático | <https://xentinel-web.onrender.com> | Las actualizaciones se publican al hacer push |
| Base de datos | Supabase (PostgreSQL 17) | Proyecto `btecqrdsbbrejtltlzto`, us-east-1 | 500 MB; el proyecto se pausa tras una semana sin actividad |
| Correo (opcional) | Brevo | API REST o relé SMTP (puerto 2525) | 300 correos al día |

**Este plan sirve para probar y mostrar el proyecto. Antes de atender emergencias reales, pasa el backend a un plan de pago que no se duerma.** No uses servicios que hagan pings para mantenerlo despierto: agotarían las horas gratis de Render.

El repositorio está en <https://github.com/xentineloficial-2026/Xentinel>. Cada push a `main` vuelve a desplegar la API y la web.

## 1. Base de datos en Supabase

La base ya está creada. El backend no usa el usuario `postgres`: se conecta con su propio usuario, `xentinel_api`, dueño de las tablas de Xentinel, sin permisos de administrador. Al arrancar, el backend aplica solo las migraciones pendientes (`python -m xentinel migrar`).

- Todas las tablas tienen RLS activado y sin acceso para `anon` ni `authenticated`: la API de datos de Supabase no expone nada. El único cliente es el backend.
- La conexión usa el **Session pooler** (IPv4, puerto 5432), porque Render no llega a la conexión directa de Supabase, que solo admite IPv6:

```text
postgresql://xentinel_api.btecqrdsbbrejtltlzto:CLAVE@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
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

## 3. Correo con Brevo (recuperación y cambio de correo)

La recuperación de contraseña y el cambio de correo envían un **código de 6 dígitos** que vence a los 15 minutos, admite 5 intentos y se puede pedir 3 veces cada 15 minutos. Sale desde el remitente verificado de Xentinel en **Brevo** (plan gratis: 300 correos al día). Sin correo configurado, la API funciona igual y esos flujos responden `503 MAIL_NOT_CONFIGURED`.

1. En Brevo, **Remitentes y dominios**, el remitente `xentinel.oficial@gmail.com` debe estar verificado.
2. En **SMTP y API** elige una de las dos claves:
   - **Clave de API** (`xkeysib-…`): envía por la API REST (`POST https://api.brevo.com/v3/smtp/email`).
   - **Clave SMTP** (`xsmtpsib-…`): envía por el relé `smtp-relay.brevo.com` en el puerto 2525, que Render gratis no bloquea. Necesita también el **usuario del relé** (`…@smtp-brevo.com`) que aparece en esa misma página.
3. En Render, `xentinel-api` > **Environment**: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (`xentinel.oficial@gmail.com`), `BREVO_SENDER_NAME` (`Xentinel`) y, con clave SMTP, `BREVO_SMTP_LOGIN`.
4. Al reiniciar, el registro dice `Correo listo por brevo-api` o `Correo listo por brevo-smtp`. Prueba el envío en `/docs` con `POST /api/v1/correo/prueba` (sesión de administrador): si falla, la respuesta trae la causa exacta y qué corregir. Más detalle en [`docs/CORREO.md`](Xentinel%20web/BackEnd/docs/CORREO.md).

## 4. Alertas sísmicas

El backend vigila los sismos a 500 km de la sede (Bogotá) desde magnitud 4.0. Usa el WebSocket de **EMSC** (aviso segundos después de que la agencia lo publica) y, como respaldo, consulta a **USGS** cada 30 segundos. Cada sismo crea una alerta de emergencia: la web y la app abiertas la muestran al instante a pantalla completa y con sirena. Si EMSC y USGS informan el mismo sismo (menos de 2 minutos y 50 km de diferencia), sale una sola alerta. La alerta se cierra sola a los 30 minutos.

- **No es una alerta temprana.** Las agencias publican el sismo uno o varios minutos después de ocurrido. Sirve para avisar y activar el protocolo, no para anticipar el movimiento. Esa función requiere una red de sensores (en Colombia, el Servicio Geológico Colombiano).
- **Plan gratis:** el monitor solo vigila mientras `xentinel-api` está despierto; se duerme tras 15 minutos sin visitas. Para vigilar las 24 horas hace falta un plan de pago.

**Notificaciones con la app o el navegador cerrados (Firebase Cloud Messaging).** Sin Firebase todo lo anterior funciona; con Firebase el aviso llega también a teléfonos y navegadores cerrados, por el tema `alertas_sismo`.

1. En <https://console.firebase.google.com> crea el proyecto `xentinel`.
2. **Android:** agrega una app Android con el paquete `co.edu.sena.xentinel`, descarga `google-services.json` y guárdalo en `Xentinel app/android/app/`. Recompila la APK (sección 6). La app pide permiso de notificaciones al abrir; en **Alertas** se concede la pantalla completa y el sonido en No molestar.
3. **Web:** en **Configuración del proyecto > General** agrega una app web y copia `apiKey`, `projectId`, `messagingSenderId` y `appId`. En **Cloud Messaging > Certificados web push** genera un par de claves (VAPID). En Render, `xentinel-web` > **Environment**: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` y `VITE_FIREBASE_VAPID_KEY`; luego **Manual Deploy**. Cada persona activa las alertas en el módulo **Alertas** de la web.
4. **Servidor:** en **Configuración del proyecto > Cuentas de servicio** pulsa **Generar nueva clave privada**. Pega el JSON completo, en una línea, en `FIREBASE_SERVICE_ACCOUNT` de `xentinel-api` > **Environment**. Es un secreto: nunca lo subas al repositorio.

## 5. Servicios en Render

Los dos servicios se crean desde `render.yaml` (**New > Blueprint**, repositorio `Xentinel`, ambos gratis). Valores del panel:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | El enlace del Session pooler de la sección 1 |
| `JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `QR_SECRET` | Secretos aleatorios propios de producción; no reutilices los de tu `.env` |
| `WEB_ORIGINS` | `https://xentinel-web.onrender.com` |
| `RESET_PASSWORD_URL` | `https://xentinel-web.onrender.com/restablecer-contrasena` |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SMTP_LOGIN` | Los de Brevo (sección 3) |
| `VITE_API_URL` | `https://xentinel-api.onrender.com` (sin `/api/v1`) |

Comprueba que `https://xentinel-api.onrender.com/ready` responda `{"status":"ready"}`. La primera vez puede tardar cerca de un minuto.

Si el despliegue falla, revisa en los registros de `xentinel-api` primero el enlace de Supabase (usuario, clave y host del pooler) y luego el correo.

## 6. Compilar la APK definitiva (Android)

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

## 7. iPhone (iOS)

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

Dos teléfonos no pueden validar un acceso entre sí sin un servidor común. Con el servidor en internet sirve cualquier Wi-Fi o datos móviles. Desde la app 1.3.0 la validación de QR es **solo en línea**: sin conexión el escáner no registra y lo avisa, y el carnet pide conectarse en lugar de mostrar el código. El registro manual por documento de la web sigue disponible para esos casos.

## Alarmas y gestión de riesgos

Las alarmas de la web y de la app muestran solo rojo y amarillo: riesgos críticos (sismos de EMSC/USGS y alertas de administración) y carnets QR vencidos o que no son verídicos. Para probarlas sin esperar un sismo real hay un simulacro de punta a punta en la API: [`docs/RIESGOS.md`](Xentinel%20web/BackEnd/docs/RIESGOS.md).

# Xentinel en cualquier red

Hoy la app busca el backend en tu PC, por eso solo sirve en tu Wi-Fi y con el puerto abierto. Para que funcione con solo instalarla, el backend y la base de datos tienen que vivir en internet, en una dirección `https://` fija.

El archivo `render.yaml` crea tres servicios en Render, en la región Virginia:

| Servicio | Qué es | Plan |
|---|---|---|
| `xentinel-api` | Backend FastAPI (Docker) | `0.5c-512mb`, no se duerme |
| `xentinel-web` | Web React | Sitio estático |
| `xentinel-db` | PostgreSQL 18 | `0.1c-256mb` |

Revisa los precios en la página de Render antes de confirmar.

## 1. Subir el código a GitHub

1. Crea un repositorio **privado y vacío** en <https://github.com/new>, sin README ni `.gitignore`.
2. Conéctalo y súbelo desde la carpeta del proyecto:

```bash
git remote add origin https://github.com/TU-USUARIO/xentinel.git
```

```bash
git push -u origin main
```

El `.gitignore` deja fuera `xentinel-privado/`, los `.env`, `Xentinel.sql` y la APK demo.

## 2. Crear los servicios en Render

1. En <https://dashboard.render.com>, elige **New > Blueprint** y selecciona el repositorio.
2. Render pide las variables marcadas `sync: false`. Escríbelas así:

| Variable | Valor |
|---|---|
| `JWT_SECRET` | Está en `xentinel-privado/render-secretos.txt` |
| `MAIL_ENCRYPTION_KEY` | Está en `xentinel-privado/render-secretos.txt` |
| `WEB_ORIGINS` | `https://xentinel-web.onrender.com` |
| `RESET_PASSWORD_URL` | `https://xentinel-web.onrender.com/restablecer-contrasena` |
| `VITE_API_URL` | `https://xentinel-api.onrender.com` (sin `/api/v1`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Los de tu proveedor de correo. Con Gmail: `smtp.gmail.com`, `587`, tu correo y una contraseña de aplicación |

Render puede cambiar esas direcciones si el nombre ya está ocupado. Si pasa, corrige estas tres variables con las direcciones reales. Después de cambiar `VITE_API_URL`, vuelve a desplegar la web.

3. Comprueba que `https://xentinel-api.onrender.com/ready` responda `{"status":"ready"}`.

El backend no arranca sin SMTP, ni si el servidor de correo rechaza la conexión. Si el despliegue falla, revisa eso primero en los registros de Render.

## 3. Pasar tus datos actuales

Este paso lleva datos personales reales a un servidor externo. Si tu institución tiene reglas al respecto, revísalas antes.

1. Espera a que `xentinel-api` esté en verde: al arrancar crea las tablas.
2. Copia la **External Database URL** desde `xentinel-db` en Render.
3. Respalda tu base local y restáurala en Render. El respaldo reemplaza las tablas creadas al arrancar:

```bash
pg_dump --no-owner --no-acl --format=custom --file=xentinel-privado/para-render.dump "postgresql://USUARIO:CLAVE@127.0.0.1:5432/xentinel"
```

```bash
pg_restore --no-owner --no-acl --clean --if-exists --dbname="EXTERNAL_DATABASE_URL" xentinel-privado/para-render.dump
```

4. Inicia sesión en la web publicada con una cuenta real.

## 4. Compilar la APK definitiva (Android)

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

## 5. iPhone (iOS)

El proyecto ya incluye la carpeta `ios`, pero Apple exige dos cosas que no se pueden reemplazar desde Windows:

- **Una Mac**, propia o en la nube (por ejemplo Codemagic), para compilar.
- **Una cuenta de Apple Developer** (de pago anual), para instalar en iPhones. No existe un equivalente a "descargar la APK": se instala por TestFlight, App Store o distribución empresarial.

Comando, en la Mac:

```bash
flutter build ipa --dart-define-from-file=config/production.json
```

## Qué funciona sin internet

Dos teléfonos no pueden validar un acceso entre sí sin un servidor común. Con el servidor en internet sirve cualquier Wi-Fi o datos móviles, pero sin ninguna conexión el registro no llega al servidor.

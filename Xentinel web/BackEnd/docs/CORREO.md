# Correo de Xentinel: diagnóstico, configuración y pruebas

Xentinel envía dos tipos de código de 6 dígitos desde la cuenta de Gmail de Xentinel:

| Flujo | Dónde se pide | Endpoint | Destino del código |
| --- | --- | --- | --- |
| Recuperar la contraseña | Web («¿Olvidaste tu contraseña?») y app | `POST /auth/olvide-contrasena` | Correo de la cuenta |
| Cambiar el correo | Web, **Mi perfil → Cambiar correo** | `POST /auth/correo/solicitar` y `/auth/correo/confirmar` | Correo **nuevo** (prueba que es de la persona) |

Los códigos vencen a los `RESET_TTL_MINUTES` (15), admiten 5 intentos y se piden 3 veces cada 15 minutos. Ambos viajan cifrados en la cola `mail_outbox`; un proceso de la API los entrega cada 2 segundos y reintenta con espera creciente.

## 1. Diagnóstico de la falla

**Causa en producción.** Los registros de `xentinel-api` en Render repiten en cada arranque, desde el 17 de noviembre de 2026:

```text
Correo sin configurar: la recuperación de contraseña responde 503
```

En el servicio no hay ninguna credencial de correo (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` ni `SMTP_HOST`). Por eso la API respondía 503 antes de generar el código y la cola `mail_outbox` de Supabase está vacía: el código nunca se creó ni se intentó enviar. No es un fallo de Gmail.

**Lo que hacía difícil verlo, y se corrigió en el código:**

- La API respondía `INTERNAL_ERROR: No se pudo completar la solicitud`. Ahora responde `503 MAIL_NOT_CONFIGURED` con un mensaje claro.
- Un fallo de entrega solo dejaba `SMTP_DELIVERY_FAILED` en el registro. Ahora queda el código y la causa que informa el proveedor, sin secretos ni destinatarios. Por ejemplo: `GMAIL_AUTH: HTTP 400 invalid_grant: Token has been expired or revoked.`
- No había forma de probar el envío. Ahora existen `GET /correo/estado`, `POST /correo/prueba` y el comando `python -m xentinel probar-correo`.
- Con Gmail API y el remitente de ejemplo (`no-reply@example.com`), el mensaje salía con un `From` ajeno. Ahora se omite y Gmail usa la cuenta autorizada.
- No existía el cambio de correo con código: el correo solo lo cambiaba administración. Ahora cada persona lo cambia desde su perfil.

## 2. Configurar el envío en Render (Gmail API)

El plan gratis de Render bloquea los puertos SMTP, así que se usa Gmail API por HTTPS:

1. Con la cuenta de Gmail de Xentinel, en <https://console.cloud.google.com>, crea un proyecto y habilita **Gmail API**.
2. En **Google Auth Platform → Audience**, publica la app (**In production**). En modo de prueba el permiso vence a los 7 días y aparece `invalid_grant`.
3. En **Clients**, crea un ID de cliente OAuth de tipo **Aplicación web** con el URI de redirección `https://developers.google.com/oauthplayground`.
4. En <https://developers.google.com/oauthplayground>, pulsa el engranaje, marca **Use your own OAuth credentials** y pega el ID y el secreto. Autoriza el alcance `https://www.googleapis.com/auth/gmail.send` con la cuenta de Xentinel y pulsa **Exchange authorization code for tokens**. Copia el **Refresh token**.
5. En Render, `xentinel-api` → **Environment**, agrega `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN`. Opcional: `SMTP_FROM` = `Xentinel <cuenta-de-xentinel@gmail.com>`; debe ser la misma cuenta o un alias verificado.
6. Guarda: Render reinicia el servicio. En **Logs** debe aparecer `Correo listo por gmail`. Si aparece `Correo no disponible (GMAIL_AUTH)`, revisa los pasos 2 a 4.

Los tres valores son secretos: escríbelos solo en el panel de Render, nunca en el repositorio ni en un chat.

## 3. Probar el envío

**Desde Swagger** (`https://xentinel-api.onrender.com/docs`, sesión de Administrador):

1. `GET /api/v1/correo/estado` debe mostrar `"configurado": true` y `"transporte": "gmail"`.
2. `POST /api/v1/correo/prueba` con `{"destino":"tu-correo@ejemplo.com"}`:
   - `200 {"enviado": true}`: Gmail aceptó el mensaje. Revisa la bandeja y la carpeta de spam.
   - `502 MAIL_DELIVERY_FAILED`: el mensaje trae la causa (tabla de abajo).
   - `503 MAIL_NOT_CONFIGURED`: faltan las variables del paso 2.

La colección de Postman [`xentinel-riesgos.postman_collection.json`](xentinel-riesgos.postman_collection.json) trae estas dos peticiones (10 y 11).

**Desde una terminal** con el `.env` de la API:

```bash
python -m xentinel probar-correo tu-correo@ejemplo.com
```

Responde «Correo de prueba enviado…» o «No se envió (CÓDIGO): causa».

**Flujos completos:**

1. Recuperación: en la web, **Iniciar sesión → ¿Olvidaste tu contraseña?**, escribe el correo de una cuenta activa, recibe el código, escríbelo y crea la contraseña nueva. En la app, el mismo flujo desde el login.
2. Cambio de correo: en la web, **Mi perfil → Cambiar correo**, escribe el correo nuevo y tu contraseña, recibe el código en el correo nuevo y confírmalo. La sesión se cierra y el login confirma «Tu correo ahora es …».
3. `GET /correo/estado` muestra `enviados_24h` y, si algo falló, `ultimo_fallo`.

**Pruebas automáticas** (`npm test` con `TEST_DATABASE_URL`): «correo por Gmail API: diagnóstico, prueba de envío, causa exacta del fallo y cola entregada» levanta un Gmail simulado y comprueba el envío, el `invalid_grant` y la entrega por la cola. «cambio de correo con código…» cubre la contraseña, el correo repetido, los intentos y el uso único.

## 4. Códigos de fallo

| Código | Qué significa | Qué hacer |
| --- | --- | --- |
| `GMAIL_AUTH` + `invalid_grant` | El refresh token venció o se revocó | Publica la app en Google (paso 2) y genera otro refresh token (paso 4) |
| `GMAIL_AUTH` + `invalid_client` / `unauthorized_client` | ID o secreto del cliente incorrectos | Copia de nuevo `GMAIL_CLIENT_ID` y `GMAIL_CLIENT_SECRET` |
| `GMAIL_SEND` + `Insufficient Permission` | El token no tiene el alcance `gmail.send` | Repite el paso 4 con ese alcance |
| `GMAIL_SEND` + `Invalid From header` | `SMTP_FROM` no es la cuenta ni un alias verificado | Usa la cuenta de Xentinel o quita `SMTP_FROM` |
| `SMTP_AUTH` | Usuario o contraseña SMTP rechazados | Con Gmail, usa una contraseña de aplicación |
| `TIMEOUT` / `CONNECTION` | No hay salida al servidor de correo | En Render gratis usa Gmail API: los puertos SMTP están bloqueados |
| `MAIL_NOT_CONFIGURED` (503) | No hay transporte configurado | Paso 2 |

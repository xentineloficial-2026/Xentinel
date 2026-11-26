# Correo de Xentinel con Brevo: configuración, pruebas y diagnóstico

Xentinel envía dos tipos de código de 6 dígitos desde el remitente verificado de Xentinel en **Brevo**:

| Flujo | Dónde se pide | Endpoint | Destino del código |
| --- | --- | --- | --- |
| Recuperar la contraseña | Web («¿Olvidaste tu contraseña?») y app | `POST /auth/olvide-contrasena` | Correo de la cuenta |
| Cambiar el correo | Web, **Mi perfil → Cambiar correo** | `POST /auth/correo/solicitar` y `/auth/correo/confirmar` | Correo **nuevo** (prueba que es de la persona) |

Los códigos vencen a los `RESET_TTL_MINUTES` (15), admiten 5 intentos y se piden 3 veces cada 15 minutos. Viajan cifrados en la cola `mail_outbox`; un proceso de la API los entrega cada 2 segundos y reintenta con espera creciente. El correo es HTML claro con la marca de Xentinel y lleva también una versión en texto.

## 1. Cómo envía

La API elige el camino según la clave de `BREVO_API_KEY`:

| Clave | Camino | Qué más necesita |
| --- | --- | --- |
| Clave de API (`xkeysib-…`) | API REST: `POST https://api.brevo.com/v3/smtp/email` con la cabecera `api-key`. Brevo responde `201` con un `messageId`. | `BREVO_SENDER_EMAIL` |
| Clave SMTP (`xsmtpsib-…`) | Relé SMTP `smtp-relay.brevo.com`, puerto **2525** con STARTTLS. Render gratis bloquea los puertos 25, 465 y 587, no el 2525. | `BREVO_SENDER_EMAIL` y `BREVO_SMTP_LOGIN` (el usuario del relé, `…@smtp-brevo.com`) |

Un envío solo cuenta como hecho cuando Brevo lo confirma (el `messageId` en la API o la aceptación del relé). Al iniciar, la API comprueba la clave sin gastar envíos del plan (`GET /v3/account` o el inicio de sesión en el relé) y lo deja en el registro. La API quita los espacios, saltos de línea y comillas que se cuelan al pegar las variables en un panel.

Sin `BREVO_API_KEY`, la API usa el SMTP propio de `SMTP_HOST` (útil en un computador local). Sin ninguno de los dos, la recuperación responde `503 MAIL_NOT_CONFIGURED`.

## 2. Configurar Brevo en Render

1. En Brevo, **Remitentes, dominios e IP dedicadas → Remitentes**: `Xentinel <xentinel.oficial@gmail.com>` debe aparecer verificado.
2. En **SMTP y API** copia la clave (de API o SMTP) y, si es SMTP, el **usuario** del relé.
3. En Render, `xentinel-api` → **Environment**:

   | Variable | Valor |
   | --- | --- |
   | `BREVO_API_KEY` | La clave de Brevo |
   | `BREVO_SENDER_EMAIL` | `xentinel.oficial@gmail.com` |
   | `BREVO_SENDER_NAME` | `Xentinel` |
   | `BREVO_SMTP_LOGIN` | Solo con clave SMTP: el usuario del relé |

4. Guarda y despliega. En **Logs** debe aparecer `Correo listo por brevo-api` o `Correo listo por brevo-smtp`. Si aparece `Correo no disponible (…)`, la tabla de la sección 4 dice qué corregir.

Las claves son secretas: van solo en el panel de Render, nunca en el repositorio.

## 3. Probar el envío

**Desde Swagger** (`https://xentinel-api.onrender.com/docs`, sesión de Administrador):

1. `GET /api/v1/correo/estado` muestra `"configurado": true`, el transporte (`brevo-api` o `brevo-smtp`) y el remitente.
2. `POST /api/v1/correo/prueba` con `{"destino":"tu-correo@ejemplo.com"}`:
   - `200 {"enviado": true}`: Brevo aceptó el mensaje. Revisa la bandeja y la carpeta de spam.
   - `502 MAIL_DELIVERY_FAILED`: el mensaje trae la causa y qué hacer (tabla de abajo).
   - `503 MAIL_NOT_CONFIGURED`: faltan las variables de la sección 2.

La colección de Postman [`xentinel-riesgos.postman_collection.json`](xentinel-riesgos.postman_collection.json) trae estas dos peticiones (10 y 11). En Brevo, **Transaccional → Registros** muestra cada envío y si llegó.

**Desde una terminal** con el `.env` de la API:

```bash
python -m xentinel probar-correo tu-correo@ejemplo.com
```

**Flujos completos:**

1. Recuperación: en la web, **Iniciar sesión → ¿Olvidaste tu contraseña?**, escribe el correo de una cuenta activa, recibe el código, escríbelo y crea la contraseña nueva. En la app, el mismo flujo desde el login.
2. Cambio de correo: en la web, **Mi perfil → Cambiar correo**, escribe el correo nuevo y tu contraseña, recibe el código en el correo nuevo y confírmalo. La sesión se cierra y el login confirma «Tu correo ahora es …».

**Pruebas automáticas** (`npm test` con `TEST_DATABASE_URL`):

- «correo por la API de Brevo…» levanta una API de Brevo simulada y comprueba el diagnóstico, el envío, la clave inválida, el remitente sin verificar, la respuesta sin `messageId` y la entrega del código desde la cola.
- «correo por el relé SMTP de Brevo…» levanta un relé simulado y comprueba el inicio de sesión con el usuario del relé, la clave SMTP y los errores.

## 4. Códigos de fallo

| Código | Qué significa | Qué hacer |
| --- | --- | --- |
| `BREVO_AUTH` + `Key not found` | La clave de API no existe o se desactivó | Genera otra clave de API en **SMTP y API** y cámbiala en Render |
| `BREVO_AUTH` + `unrecognised IP` | Brevo bloquea llamadas desde IP desconocidas | En Brevo, **Seguridad → IP autorizadas**, desactiva el bloqueo (Render cambia de IP) |
| `BREVO_SEND` + `sender is not valid` | El remitente no está verificado en Brevo | Verifica el remitente o corrige `BREVO_SENDER_EMAIL` |
| `BREVO_SEND` + `Brevo no confirmó el envío` | Brevo respondió sin `messageId` | La cola reintenta sola; si se repite, revisa el estado de Brevo |
| `BREVO_CONFIG` | Falta `BREVO_SENDER_EMAIL` o, con clave SMTP, `BREVO_SMTP_LOGIN` | Agrégala en Render |
| `SMTP_AUTH` | El relé rechazó el usuario o la clave SMTP | Copia de nuevo el usuario (`…@smtp-brevo.com`) y la clave SMTP |
| `SMTP_SENDER` | El relé rechazó el remitente | Verifica el remitente en Brevo |
| `TIMEOUT` / `CONNECTION` | No hay salida al servidor de correo | Con el relé, usa el puerto 2525 (`BREVO_SMTP_PORT`) |
| `MAIL_NOT_CONFIGURED` (503) | No hay transporte configurado | Sección 2 |

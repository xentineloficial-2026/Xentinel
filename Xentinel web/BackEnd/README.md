# Xentinel · API REST SENA

FastAPI y PostgreSQL 17+ para la web y los clientes móviles de Xentinel. Mantiene `/api/v1`, el puerto predeterminado `8000`, los formatos `{data, meta?}` y `{error, detail}`, y los alias de transición `POST /login`, `POST /registro` y `GET /alertas/estado-actual`.

## Arranque en Windows

Desde `BackEnd`, con Python 3.12 o posterior y PostgreSQL 17+:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m xentinel migrar
.\.venv\Scripts\python.exe -m xentinel servir
```

En otros sistemas, el intérprete del entorno virtual está en `.venv/bin/python`. Use `--recargar` con `servir` para desarrollo. Con el entorno virtual activado, `npm start`, `npm run dev`, `npm run migrate` y `npm run bootstrap-admin` delegan en Python. El servicio no requiere Node.js para arrancar.

- En una instalación existente, conserve `.env`, `DATABASE_URL`, `JWT_SECRET` y `MAIL_ENCRYPTION_KEY`. Así se mantienen las sesiones vigentes y los trabajos de correo pendientes.
- En una instalación nueva, copie `.env.example` a `.env`, configure PostgreSQL y genere cada secreto por separado con `python -c "import secrets; print(secrets.token_hex(32))"`. Para crear el primer administrador, defina `ADMIN_NAME`, `ADMIN_DOCUMENT`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` en el entorno y ejecute `python -m xentinel crear-admin`.
- Haga respaldo antes de migrar una base en uso. `migrar` usa los mismos archivos SQL, versiones y checksums que Express. Si una versión ya está aplicada se verifica y se omite. El SQL completo se reserva para instalaciones nuevas o para el dump original restaurado. Se regenera con `python -m xentinel exportar-sql`.
- Detenga Express antes de iniciar FastAPI en el mismo puerto. El proxy Vite existente sigue apuntando a `127.0.0.1:8000`. Para la reversión operativa, detenga FastAPI y arranque Express con `npm run legacy:start`, con sus dependencias Node instaladas.

Con el servidor iniciado, visite `/health`, `/ready` y `/docs`. El contrato en formato JSON está en `/openapi.json`. Para una integración externa use [el contrato Web y móvil](docs/API.md).

## Módulos

| Ruta                                                               | Responsabilidad                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `xentinel/main.py`                                                 | Aplicación ASGI, ciclo de vida, montaje de rutas y recuperación HTML      |
| `xentinel/configuracion.py`, `base_datos.py`, `proteccion_http.py` | Configuración, pool, migraciones, CORS, límites y errores                 |
| `xentinel/autenticacion.py`, `seguridad.py`, `correo.py`           | Credenciales bcrypt, JWT HS256, tokens de un solo uso y cola SMTP cifrada |
| `xentinel/personas.py`, `accesos.py`                               | Directorio, perfiles, fichas asignadas y movimientos idempotentes         |
| `xentinel/programas.py`, `catalogos.py`                            | Gestión académica, catálogos, asistencias y exportaciones administrativas |
| `xentinel/alertas.py`, `eventos.py`                                | Alertas, SOS, pase de lista y sincronización WebSocket/SSE                |
| `xentinel/credenciales.py`                                         | Carnet QR rotativo firmado (XN2): emisión, firma y verificación           |
| `sql/`, `public/`, `clients/`                                      | Esquema, recuperación y cliente JS compartidos                            |
| `src/`, `scripts/`, `test/`                                        | Respaldo de Express y pruebas de compatibilidad                           |

## Configuración de clientes y despliegue

- Registre en `WEB_ORIGINS` los orígenes exactos de la web. Los clientes nativos sin `Origin` usan el mismo encabezado `Authorization: Bearer <token>`. Un teléfono debe usar una dirección alcanzable del servidor.
- La API obtiene permisos e identidad de la sesión validada contra PostgreSQL. Con los mismos secretos, los JWT emitidos por Express siguen siendo verificables hasta que venzan o se revoquen.
- En producción, configure HTTPS. SMTP es opcional: sin él la recuperación de contraseña responde 503. Si habilita `TRUST_PROXY_HOPS`, exponga Uvicorn únicamente al proxy que sanea `X-Forwarded-For`. Para SSE, desactive el almacenamiento intermedio del proxy y mantenga un tiempo de lectura mayor al heartbeat de 15 segundos.
- SSE entrega cambios confirmados de PostgreSQL, incluidos cambios externos. El cliente debe guardar el cursor como texto y reconectar con `Last-Event-ID`. La conexión se cierra cuando la sesión expira o se revoca. Los límites de conexiones se aplican por proceso.
- `RESET_PASSWORD_URL` puede apuntar a la página del frontend o a la incluida en FastAPI. El token viaja en el fragmento y la API lo valida de nuevo al cambiar la contraseña. El worker consume la cola existente y borra el contenido cifrado después de entregarlo o agotar los intentos. Los archivos históricos en `static/` se conservan fuera de las rutas públicas.

## Despliegue en la nube (Render + Supabase)

La API corre como _Web Service_ de Render y la base es PostgreSQL de Supabase. La web y los teléfonos la alcanzan por HTTPS/WSS desde cualquier red, sin IP locales ni puertos abiertos.

- Compilación: `cd "Xentinel web/BackEnd" && pip install -r requirements.txt`. Inicio: `cd "Xentinel web/BackEnd" && python -m xentinel migrar && python -m xentinel servir` (las migraciones corren antes de atender; Render define `PORT`).
- `DATABASE_URL`: _Session pooler_ de Supabase (IPv4, puerto 5432) con un rol propio de la API, p. ej. `postgresql://xentinel_api.<ref>:<clave>@<host-del-pooler>:5432/postgres?sslmode=require`. La conexión directa de Supabase solo admite IPv6. `DB_POOL_MAX=8` mantiene el pool por debajo del límite del plan gratuito.
- Producción: `NODE_ENV=production`, `WEB_ORIGINS` y `RESET_PASSWORD_URL` con la URL HTTPS de la web, `TRUST_PROXY_HOPS=1` y secretos propios (`JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `QR_SECRET`).
- El plan gratuito de Render bloquea los puertos SMTP 25, 465 y 587 (use un proveedor con puerto 2525) y suspende el servicio tras 15 minutos sin tráfico: la primera petición posterior puede tardar cerca de un minuto.

Variables nuevas: `QR_SECRET` (opcional, se deriva de `JWT_SECRET` si falta), `QR_REQUIRE_SIGNED` (`true` exige el carnet firmado para el método QR), `SESSION_MAX_HOURS` (límite de `POST /auth/renovar`, 12 h por defecto) y los límites `RATE_LIMIT_API_PER_MINUTE`, `RATE_LIMIT_AUTH_PER_15MIN` y `RATE_LIMIT_LOGIN_PER_ACCOUNT`. En la nube todos los teléfonos de una sede suelen salir por la misma IP pública (NAT): por eso el límite general se cuenta por persona autenticada y el de inicio de sesión también por cuenta, y el límite por IP del login puede elevarse (p. ej. 300) sin abrir la puerta a la fuerza bruta. El WebSocket requiere el paquete `websockets` (incluido en `requirements.txt`). Con otro proxy, reenvíe `Upgrade`/`Connection` y desactive el almacenamiento intermedio de SSE. Las rutas nuevas (`/auth/renovar`, `/auth/credencial-qr`, `/tiempo-real`, `codigo_qr`/`escaneado_en` en `/ingresos`) existen solo en FastAPI; el respaldo Express no las incluye.

## Pruebas de contrato

Requieren Node.js 22+, el entorno Python anterior y un PostgreSQL desechable. `npm ci` instala el cliente de pruebas. Defina `TEST_DATABASE_URL` con permisos para crear bases temporales y ejecute `npm test`. Si `python` no apunta al entorno virtual, defina `XENTINEL_PYTHON` con la ruta a su ejecutable. La suite lanza Uvicorn en un puerto local libre, usa bases temporales y captura el correo sin enviarlo. Para verificar también el dump histórico, defina `ORIGINAL_DUMP_PATH` y `PSQL_PATH`.

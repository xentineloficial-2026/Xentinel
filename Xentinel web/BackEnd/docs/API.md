# Contrato Web / App Móvil

El usuario devuelto por login (`data.usuario`), registro y perfil (`GET /auth/me`) contiene `id_usuarios`, `nombres_completos`, el alias `nombre` con el mismo nombre completo, `nombre_rol` y los datos de perfil. Los nombres proceden de la base de datos; no se calculan a partir del documento ni se usan nombres de demostración. El frontend puede renderizar `Bienvenido, ${usuario.nombres_completos}`. Tras un evento SSE de `usuarios`, consultar `/auth/me` para actualizar el saludo. Cambiar sólo el nombre o teléfono mantiene la sesión; cambiar credenciales, correo, estado o rol la revoca.

En React, guardar `respuesta.data.usuario` al iniciar sesión y utilizar `user.nombres_completos` en el saludo. La respuesta del alias antiguo `POST /login` también incluye el usuario en el nivel superior. El cliente no debe mostrar todo el token como si fuera el objeto usuario.

Base: `/api/v1`. JSON UTF-8. `Authorization: Bearer <access_token>` en rutas protegidas. Paginación `?limit=25&offset=0`, máximo 100. Fechas ISO 8601, instantes con zona UTC; datos históricos sin zona del dump se interpretan como America/Bogota.

| Método y ruta                                     | Permiso                             | Entrada / resultado                                                                                         |
| ------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| POST `/auth/registro`                             | Público                             | Nombre, tipo/documento, correo, contraseña; rol Aprendiz fijado por servidor                                |
| POST `/auth/login`                                | Público                             | `{documento,contrasena}` → `{access_token,token_type,expires_in,usuario}`                                   |
| GET `/auth/me`                                    | Sesión                              | Perfil sin hash ni secretos                                                                                 |
| POST `/auth/logout`                               | Sesión                              | Revoca todas las sesiones del usuario; 204                                                                  |
| POST `/auth/renovar`                              | Sesión                              | Nuevo JWT con el mismo formato de login; máximo `SESSION_MAX_HOURS` desde el ingreso; 401 `SESSION_MAX_AGE` |
| GET `/auth/credencial-qr`                         | Sesión                              | Clave del carnet QR rotativo firmado (XN2) del titular, para generarlo también sin conexión                 |
| PUT `/auth/contrasena`                            | Sesión                              | `{actual,nueva}`; revoca sesiones y recuperación; 204                                                       |
| POST `/auth/olvide-contrasena`                    | Público, limitado                   | `{correo}`; 202 genérico; envía un código de 6 dígitos (15 min, 3 solicitudes/15 min por correo)            |
| POST `/auth/validar-recuperacion`                 | Público, limitado                   | `{correo,codigo}`; `{valid:true}` sin consumir el código; cada fallo cuenta (5 máximo)                      |
| POST `/auth/restablecer-contrasena`               | Público, limitado                   | `{correo,codigo,contrasena}`; revalidación y consumo atómico; 400 `INVALID_RESET_CODE`                      |
| GET `/usuarios`                                   | Administrador                       | Filtros `id_rol` y `estado=Activo/Inactivo`. Con `estado` devuelve ambos conteos en `meta.totales`          |
| POST `/usuarios`                                  | Administrador                       | Datos de registro más `id_rol`                                                                              |
| GET `/usuarios/:id`                               | Propietario / administrador         | Perfil                                                                                                      |
| PATCH `/usuarios/:id`                             | Propietario / administrador         | Campos parciales; sólo admin cambia documento, correo, rol o estado                                         |
| DELETE `/usuarios/:id`                            | Administrador                       | Desactivación lógica; conserva historial; 204                                                               |
| GET `/usuarios/:id/fichas`                        | Propietario / administrador         | Asignaciones vigentes                                                                                       |
| GET `/ingresos`                                   | Sesión                              | Propios; solo administrador consulta todos o filtra `id_usuarios`                                           |
| POST `/ingresos`                                  | Celador / administrador             | `{id_usuarios\|codigo_qr,tipo,metodo,request_id,escaneado_en?}`; ver «Carnet QR firmado»                    |
| GET `/alertas`                                    | Sesión                              | Historial paginado; filtro `activa=true/false`                                                              |
| GET `/alertas/activas`                            | Sesión                              | Todas las activas                                                                                           |
| GET `/alertas/:id`                                | Sesión                              | Detalle                                                                                                     |
| POST `/alertas`                                   | Administrador                       | Tipo, mensaje, severidad, fuente y referencia opcional                                                      |
| PATCH `/alertas/:id/cerrar`                       | Administrador                       | Cierra sólo esa alerta; idempotente                                                                         |
| POST `/alertas/suscribir-web`                     | Sesión                              | `{token}` de Firebase Web Push → tema `alertas_sismo`; 204, 503 sin Firebase                                |
| POST `/alertas/sos`                               | Sesión                              | `{id_alerta,latitud,longitud}`; propietario tomado del JWT                                                  |
| GET `/alertas/:id/sos`                            | Administrador                       | Ubicaciones paginadas                                                                                       |
| POST `/alertas/reportes`                          | Instructor asignado / administrador | `{id_alerta,id_ficha,observaciones?,estudiantes:[{id_usuarios,presente}]}`                                  |
| GET `/alertas/:id/reportes`                       | Instructor / administrador          | Reportes propios; administrador ve todos                                                                    |
| GET `/roles`, `/fichas`, `/jornadas`, `/horarios` | Sesión                              | Catálogos paginados                                                                                         |
| GET `/programas`                                  | Sesión                              | Catálogo paginado. Administrador puede filtrar `activo=true/false`; otros roles ven sólo activos            |
| GET `/programas/:id`, `/programas/instructores`   | Administrador                       | Detalle anidado y lista de instructores activos                                                             |
| POST `/programas`, PATCH `/programas/:id`         | Administrador                       | Guarda programa, fichas y horarios en una transacción. PATCH también admite `{activo}`                      |
| GET `/reportes/accesos`, `/reportes/horarios`     | Administrador                       | Lotes completos con `limit`, `despues`, `hasta`. Accesos requiere `fecha=AAAA-MM-DD` (Bogotá)               |
| GET `/asistencias`                                | Sesión                              | Propias; administrador ve todas                                                                             |
| GET `/asistencias/fichas`                         | Instructor/admin                    | Fichas visibles: asignadas al instructor; administrador ve todas                                            |
| GET `/asistencias/lista`                          | Instructor/admin                    | Aprendices de sus fichas y estado del día (`id_ficha`, `fecha`): Presente, Retraso o Sin registro           |
| PUT `/fichas/{id}/jornada`                        | Administrador                       | `{nombre,hora_inicio,hora_fin}`: define la jornada vigente; la asistencia anterior no cambia                |
| GET `/eventos`                                    | Sesión                              | SSE; `Last-Event-ID` o `?after=cursor`                                                                      |
| WS `/tiempo-real`                                 | Sesión (mensaje `auth`)             | WebSocket (WSS en producción) con el mismo cursor y filtros que SSE                                         |

El editor de programas admite horarios con día, hora de inicio, hora de fin, entorno e instructor, agrupados dentro de sus fichas. Desactivar conserva las relaciones históricas. Las exportaciones devuelven `meta.hasta` como límite fijo, y `meta.siguiente` es nulo al finalizar. Swagger está disponible en `/docs` y el contrato generado en `/openapi.json`.

Ejemplo de login:

```http
POST /api/v1/auth/login
Content-Type: application/json

{"documento":"DOCUMENTO_REGISTRADO","contrasena":"CONTRASEÑA_DEL_USUARIO"}
```

```json
{
  "data": {
    "access_token": "JWT",
    "token_type": "Bearer",
    "expires_in": 900,
    "usuario": { "id_usuarios": 1, "nombre_rol": "Administrador" }
  }
}
```

Publicación de alerta:

```http
POST /api/v1/alertas
Authorization: Bearer JWT
Content-Type: application/json

{"tipo_alerta":"Meteorológica","mensaje":"Mensaje verificado por el operador institucional","severidad":"alta","fuente":"Operador SENA","referencia_externa":"REFERENCIA_UNICA"}
```

`fuente + referencia_externa` es único cuando se proporciona referencia. Tipos: `Sismo`, `Meteorológica`, `Evacuación`, `Incendio`, `Simulacro`, `Otra`. Severidad: `informativa`, `moderada`, `alta`, `critica`.

Registro de ingreso:

```json
{
  "id_usuarios": 1,
  "tipo": "ENTRADA",
  "metodo": "Manual",
  "request_id": "b20cbfab-416c-491c-98f1-94367f7e3d89"
}
```

El cliente genera un UUID distinto por operación y reutiliza el mismo sólo al reintentar. El servidor devuelve el registro previo si coincide. Cambiar la operación conservando `request_id` devuelve 409. Se alternan ENTRADA/SALIDA para accesos permitidos; usuarios inactivos producen registros Denegado. `metodo=QR` describe la captura efectuada por un celador autenticado, no valida criptográficamente un código QR ni permite ingreso anónimo.

Eventos:

```text
id: 125
event: change
data: {"id_evento":"125","recurso":"alertas_emergencia","operacion":"INSERT","registro_id":"9","creado_en":"2026-10-21T12:00:00.000Z"}

id: 125
event: checkpoint
data: {"cursor":"125"}
```

Guardar el cursor como texto para no perder precisión de bigint. Aplicar el cambio antes de guardar el cursor. Al reconectar, reenviarlo mediante `Last-Event-ID` o `after`. `auth-expired` exige nuevo login; `retry` o fin de conexión exige reconectar. Los eventos pueden repetirse tras una desconexión: actualizar por ID de forma idempotente. El cursor empieza en 0 cuando no se proporciona; se entrega el historial visible en lotes de 200. Máximo cinco streams por usuario y 500 por proceso; no registrar tokens en URLs.

### Canal WebSocket `/api/v1/tiempo-real`

Canal preferido para la app móvil: atraviesa redes móviles, Wi‑Fi distintas y proxies HTTPS sin abrir puertos adicionales (usa el mismo 443 que la API). Cada mensaje es un objeto JSON de texto:

| Sentido            | Mensaje                                                           | Uso                                                              |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Cliente → servidor | `{"tipo":"auth","token":"<JWT>","cursor":"125"}`                  | Obligatorio en los primeros 10 s. El token nunca viaja en la URL |
| Servidor → cliente | `{"tipo":"listo","cursor":"125","servidor_ms":…}`                 | Canal autenticado                                                |
| Servidor → cliente | `{"tipo":"change","id":"126","data":{…}}`                         | Mismo contenido que el evento SSE `change`                       |
| Servidor → cliente | `{"tipo":"checkpoint","cursor":"126","servidor_ms":…}`            | Cada 15 s o tras un lote; guardar el cursor                      |
| Cliente → servidor | `{"tipo":"ping"}` → `{"tipo":"pong","servidor_ms":…}`             | Latencia y reloj del servidor                                    |
| Cliente → servidor | `{"tipo":"auth","token":"<JWT renovado>"}` → `{"tipo":"auth-ok"}` | Renueva la sesión sin reconectar                                 |
| Servidor → cliente | `{"tipo":"auth-expired"}`                                         | Sesión vencida o revocada                                        |

Códigos de cierre: `4401` sesión inválida, `4403` origen no autorizado, `4409` cursor inválido (sincronizar desde 0), `4429` límite de conexiones, `4503` base de datos no disponible (reintentar). Un navegador de un origen no incluido en `WEB_ORIGINS` recibe 403 en el handshake. El servidor envía pings de protocolo cada 20 s; el límite de mensajes es 64 KiB. Si un proxy bloquea WebSocket, el cliente puede usar SSE con el mismo cursor.

### Carnet QR firmado (XN2)

`XN2:<id_usuarios>:<paso>:<firma>` donde `paso = floor(unix_segundos/15)` y `firma` son los primeros 20 caracteres Base32 de `HMAC-SHA256(clave, "XN2:<id>:<paso>")`. La `clave` (Base64URL) se obtiene con `GET /auth/credencial-qr`; se deriva de `QR_SECRET` (o de `JWT_SECRET` con separación de dominio) y de `auth_version`, por lo que cerrar sesión, cambiar contraseña o desactivar la cuenta revoca los carnets emitidos. Solo usa caracteres del modo alfanumérico de QR: el código cabe en una versión 3 con corrección Q y se lee de pantalla a pantalla.

`POST /ingresos` con `{"codigo_qr":"XN2:…","tipo":"ENTRADA","metodo":"QR","request_id":"<uuid>"}` verifica la firma en el servidor (`422 INVALID_QR`) y la vigencia de ±45 s (`422 QR_EXPIRED`) frente a la hora del servidor o, si se envía, frente a `escaneado_en`. `escaneado_en` (ISO 8601 con zona) permite sincronizar movimientos tomados sin conexión hasta 72 h después (`422 INVALID_SCAN_TIME` fuera de rango); el movimiento conserva esa hora para la asistencia. El reenvío con el mismo `request_id` es idempotente. Los formatos heredados (`id_usuarios`) siguen aceptándose salvo que `QR_REQUIRE_SIGNED=true`, que exige el carnet firmado para el método QR (`422 QR_UNSIGNED`).

Errores: 400 JSON/token inválido, 401 sesión ausente/vencida/revocada, 403 permiso/origen, 404 recurso/ruta, 409 duplicado/referencia/secuencia/concurrencia, 413 tamaño, 422 validación, 429 límite, 500 error interno, 503 correo o Firebase no configurados. `detail` replica el mensaje para facilitar adaptación del cliente anterior. Los errores internos no exponen SQL ni stack.

Fuentes técnicas: [Express: errores asíncronos](https://expressjs.com/en/guide/error-handling.html), [OWASP: recuperación de contraseña](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [PostgreSQL: triggers](https://www.postgresql.org/docs/17/triggers.html).

## Administración de programas y reportes

- `GET /api/v1/usuarios?estado=Activo|Inactivo`: lista filtrada y `meta.totales={activos,inactivos}` para el conjunto, independientemente de la página.
- `GET /api/v1/programas?activo=true|false`: filtro de catálogo. Los otros roles consultan los activos; las fichas y horarios históricos se conservan.
- `GET /api/v1/programas/instructores`: identificadores y nombres de instructores activos.
- `GET /api/v1/programas/:id`: programa con `fichas[].horarios[]`.
- `POST /api/v1/programas`: recibe `nombre_programa`, `nivel_programa` (texto o null) y `fichas`. Cada ficha nueva incluye `numero_ficha` y al menos un horario. Cada horario incluye `nombre_clase`, `dia_semana`, `hora_inicio`, `hora_fin`, `ambiente` e `id_instructor`.
- `PATCH /api/v1/programas/:id`: edita los datos anteriores (incluye los IDs de fichas u horarios existentes) o recibe solamente `{activo:false}` para desactivar. Omitir una ficha u horario no lo borra.
- `GET /api/v1/reportes/accesos?fecha=AAAA-MM-DD`: todas las entradas y salidas de ese día en Bogotá, incluidas las denegadas.
- `GET /api/v1/reportes/horarios`: catálogo de horarios para exportar.

Los endpoints de detalle, escritura, instructores y reportes requieren administrador. Los reportes aceptan `limit`, `despues` y `hasta`; la primera respuesta fija `meta.hasta`. Las siguientes usan el mismo `hasta` y `meta.siguiente` como `despues` hasta recibir `siguiente:null`.

Aplicar la migración `003_programas_admin` con `npm run migrate` antes de iniciar la versión nueva. Es aditiva y no elimina registros.

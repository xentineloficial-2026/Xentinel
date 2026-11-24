"""Sincronización en tiempo real (WebSocket y SSE) con cursor persistente y filtrado por identidad.

Ambos canales leen la misma tabla ``api_events``: un cliente puede pasar de WebSocket a SSE
(o a consultas periódicas) conservando el cursor, sin perder ni duplicar cambios.
"""

import asyncio
import json
import re
from collections import Counter
from contextlib import suppress
from time import monotonic, time

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from psycopg import Error as ErrorPostgres
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers

from .http import Base, ErrorAPI, codificar
from .proteccion_http import contar_peticion, ip_cliente
from .seguridad import (
    SesionActual,
    activo,
    es_admin,
    nombre_rol,
    sesion_desde_token,
    usuario_por_id,
)

rutas = APIRouter(tags=["Eventos"])
RECURSOS_PUBLICOS = {
    "alertas_emergencia",
    "ficha",
    "programa",
    "rol",
    "jornada",
    "horarios",
}


def visible(evento, usuario):
    return (
        es_admin(usuario)
        or evento["recurso"] in RECURSOS_PUBLICOS
        or (
            evento["recurso"] in ("acceso", "alarmas_qr")
            and nombre_rol(usuario) == "celador"
        )
        # Solo metadatos: /asistencias decide qué filas de sus fichas puede leer el instructor.
        or (evento["recurso"] == "asistencia" and nombre_rol(usuario) == "instructor")
        or evento["propietario_id"] == usuario["id_usuarios"]
    )


def formato(tipo, datos, identificador=None):
    prefijo = f"id: {identificador}\n" if identificador is not None else ""
    return f"{prefijo}event: {tipo}\ndata: {json.dumps(codificar(datos), separators=(',', ':'))}\n\n"


class ConexionesEventos:
    def __init__(self):
        self.por_usuario = Counter()
        self.total = 0

    def abrir(self, usuario):
        # Sólo se modifica en el bucle asíncrono, sin esperas entre comprobar e incrementar.
        if self.por_usuario[usuario] >= 5 or self.total >= 500:
            raise ErrorAPI(429, "STREAM_LIMIT", "Límite de conexiones simultáneas")
        self.total += 1
        self.por_usuario[usuario] += 1

    def cerrar(self, usuario):
        self.total -= 1
        self.por_usuario[usuario] -= 1
        if not self.por_usuario[usuario]:
            del self.por_usuario[usuario]


def siguiente_lote(db, sesion, cursor):
    with db.transaccion() as conexion:
        usuario = usuario_por_id(conexion, sesion.id)
        if (
            not activo(usuario)
            or usuario["auth_version"] != sesion.token["ver"]
            or time() >= sesion.token["exp"]
        ):
            return None, []
        filas = conexion.filas(
            """SELECT id_evento,recurso,operacion,registro_id,propietario_id,creado_en
            FROM api_events WHERE id_evento>%s ORDER BY id_evento LIMIT 200""",
            cursor,
        )
    return usuario, filas


class FlujoEventos(StreamingResponse):
    async def __call__(self, scope, receive, send):
        # Libera la reserva incluso si el cliente cierra antes de leer el primer evento.
        try:
            await super().__call__(scope, receive, send)
        finally:
            scope["app"].state.conexiones_eventos.cerrar(
                scope["state"]["usuario_eventos"]
            )


@rutas.get(
    "/eventos",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "Cambios, checkpoints y expiración de sesión",
            "content": {"text/event-stream": {}},
        },
    },
)
async def transmitir(
    solicitud: Request, db: Base, sesion: SesionActual, after: str = "0"
):
    valor = solicitud.headers.get("Last-Event-ID", after)
    if not re.fullmatch(r"[0-9]{1,18}", valor):
        raise ErrorAPI(422, "INVALID_CURSOR", "Cursor de eventos inválido")
    inicial = int(valor)
    maximo = await run_in_threadpool(
        db.fila, "SELECT coalesce(max(id_evento),0) AS ultimo FROM api_events"
    )
    if inicial > maximo["ultimo"]:
        raise ErrorAPI(
            409,
            "INVALID_CURSOR",
            "Cursor posterior al último evento; vuelva a sincronizar",
        )
    solicitud.app.state.conexiones_eventos.abrir(sesion.id)
    solicitud.state.usuario_eventos = sesion.id

    async def emitir():
        cursor, ultimo_latido = inicial, 0
        yield "retry: 2000\n\n"
        while True:
            try:
                usuario, eventos = await run_in_threadpool(
                    siguiente_lote, db, sesion, cursor
                )
            except ErrorPostgres:
                yield formato("retry", {})
                return
            if not usuario:
                yield formato("auth-expired", {})
                return
            for evento in eventos:
                cursor = evento["id_evento"]
                if visible(evento, usuario):
                    evento.pop("propietario_id")
                    evento["id_evento"] = str(cursor)
                    yield formato("change", evento, cursor)
            if eventos or monotonic() - ultimo_latido >= 15:
                yield formato("checkpoint", {"cursor": str(cursor)}, cursor)
                ultimo_latido = monotonic()
            # Si hay un atraso grande, envía el siguiente lote sin esperar un segundo.
            await asyncio.sleep(0 if len(eventos) == 200 else 1)

    return FlujoEventos(
        emitir(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


# Códigos de cierre de aplicación (4000-4999) del canal WebSocket.
CIERRE_NO_AUTORIZADO = 4401
CIERRE_ORIGEN = 4403
CIERRE_CURSOR = 4409
CIERRE_LIMITE = 4429
CIERRE_REINTENTAR = 4503
ESPERA_AUTENTICACION = 10
LATIDO_SEGUNDOS = 15


def cursor_valido(db, valor):
    if not isinstance(valor, str) or not re.fullmatch(r"[0-9]{1,18}", valor):
        raise ErrorAPI(422, "INVALID_CURSOR", "Cursor de eventos inválido")
    inicial = int(valor)
    maximo = db.fila("SELECT coalesce(max(id_evento),0) AS ultimo FROM api_events")
    if inicial > maximo["ultimo"]:
        raise ErrorAPI(
            409,
            "INVALID_CURSOR",
            "Cursor posterior al último evento; vuelva a sincronizar",
        )
    return inicial


def autenticar_mensaje(config, db, mensaje, actual=None):
    if not isinstance(mensaje, dict) or mensaje.get("tipo") != "auth":
        raise ErrorAPI(401, "UNAUTHORIZED", "Envíe primero el mensaje de autenticación")
    sesion = sesion_desde_token(config, db, mensaje.get("token"))
    if actual is not None and sesion.id != actual.id:
        raise ErrorAPI(401, "UNAUTHORIZED", "El token pertenece a otra persona")
    return sesion


@rutas.websocket("/tiempo-real")
async def tiempo_real(ws: WebSocket):
    """Canal WSS bidireccional para clientes móviles y web, a través de cualquier red.

    Protocolo (JSON por mensaje de texto):

    - Cliente → ``{"tipo":"auth","token":"<JWT>","cursor":"<id>"}`` en los primeros 10 s.
      El token viaja en el mensaje, no en la URL, para no quedar en registros de proxies.
    - Servidor → ``listo``, ``change`` (con ``id`` y ``data``), ``checkpoint`` cada 15 s,
      ``pong`` y ``auth-expired``.
    - Cliente → ``{"tipo":"ping"}`` mide la latencia y sincroniza el reloj (``servidor_ms``);
      ``{"tipo":"auth","token":...}`` renueva la sesión sin reconectar.
    """
    app = ws.app
    config = app.state.configuracion
    db = app.state.base
    cabeceras = Headers(scope=ws.scope)
    origen = cabeceras.get("origin")
    # Un navegador siempre envía Origin: evita que otra página use la sesión (CSWSH).
    if origen and origen not in config.origenes:
        await ws.close(code=CIERRE_ORIGEN)
        return
    try:
        await run_in_threadpool(
            contar_peticion,
            db,
            ip_cliente(ws.scope, cabeceras, config.TRUST_PROXY_HOPS),
            "tiempo-real",
            config.RATE_LIMIT_API_PER_MINUTE,
            60,
        )
    except ErrorAPI:
        await ws.close(code=CIERRE_LIMITE)
        return
    await ws.accept()
    enviar_lock = asyncio.Lock()

    async def enviar(datos):
        async with enviar_lock:
            await ws.send_text(
                json.dumps(codificar(datos), separators=(",", ":"), ensure_ascii=False)
            )

    async def cerrar(codigo, error=None):
        with suppress(Exception):
            if error is not None:
                await enviar(
                    {"tipo": "error", "code": error.codigo, "message": str(error)}
                )
            await ws.close(code=codigo)

    try:
        mensaje = await asyncio.wait_for(ws.receive_json(), ESPERA_AUTENTICACION)
        sesion = await run_in_threadpool(autenticar_mensaje, config, db, mensaje)
        inicial = await run_in_threadpool(
            cursor_valido, db, str(mensaje.get("cursor") or "0")
        )
    except (TimeoutError, ValueError, KeyError, WebSocketDisconnect):
        await cerrar(CIERRE_NO_AUTORIZADO)
        return
    except ErrorAPI as error:
        await cerrar(
            CIERRE_CURSOR if error.codigo == "INVALID_CURSOR" else CIERRE_NO_AUTORIZADO,
            error,
        )
        return
    except ErrorPostgres:
        await cerrar(CIERRE_REINTENTAR)
        return
    try:
        app.state.conexiones_eventos.abrir(sesion.id)
    except ErrorAPI as error:
        await cerrar(CIERRE_LIMITE, error)
        return
    usuario_conexion = sesion.id
    estado = {"sesion": sesion, "cursor": inicial}

    async def recibir():
        while True:
            mensaje = await ws.receive_json()
            if not isinstance(mensaje, dict):
                continue
            if mensaje.get("tipo") == "ping":
                await enviar({"tipo": "pong", "servidor_ms": int(time() * 1000)})
            elif mensaje.get("tipo") == "auth":
                estado["sesion"] = await run_in_threadpool(
                    autenticar_mensaje, config, db, mensaje, estado["sesion"]
                )
                await enviar({"tipo": "auth-ok"})

    async def emitir():
        ultimo_latido = monotonic()
        await enviar(
            {
                "tipo": "listo",
                "cursor": str(estado["cursor"]),
                "servidor_ms": int(time() * 1000),
            }
        )
        while True:
            usuario, eventos = await run_in_threadpool(
                siguiente_lote, db, estado["sesion"], estado["cursor"]
            )
            if not usuario:
                await enviar({"tipo": "auth-expired"})
                return CIERRE_NO_AUTORIZADO
            for evento in eventos:
                estado["cursor"] = evento["id_evento"]
                if visible(evento, usuario):
                    evento.pop("propietario_id")
                    evento["id_evento"] = str(estado["cursor"])
                    await enviar(
                        {"tipo": "change", "id": str(estado["cursor"]), "data": evento}
                    )
            if eventos or monotonic() - ultimo_latido >= LATIDO_SEGUNDOS:
                await enviar(
                    {
                        "tipo": "checkpoint",
                        "cursor": str(estado["cursor"]),
                        "servidor_ms": int(time() * 1000),
                    }
                )
                ultimo_latido = monotonic()
            await asyncio.sleep(0 if len(eventos) == 200 else 1)

    tareas = [asyncio.create_task(recibir()), asyncio.create_task(emitir())]
    codigo = 1000
    try:
        hechas, _ = await asyncio.wait(tareas, return_when=asyncio.FIRST_COMPLETED)
        for tarea in hechas:
            error = tarea.exception()
            if isinstance(error, ErrorAPI):
                codigo = CIERRE_NO_AUTORIZADO
                with suppress(Exception):
                    await enviar(
                        {"tipo": "error", "code": error.codigo, "message": str(error)}
                    )
            elif isinstance(error, ErrorPostgres):
                codigo = CIERRE_REINTENTAR
            elif error is None and tarea.result():
                codigo = tarea.result()
    finally:
        for tarea in tareas:
            tarea.cancel()
        await asyncio.gather(*tareas, return_exceptions=True)
        app.state.conexiones_eventos.cerrar(usuario_conexion)
        with suppress(Exception):
            await ws.close(code=codigo)

"""Transmisión SSE con cursor persistente y filtrado por identidad."""

import asyncio
import json
import re
from collections import Counter
from time import monotonic, time

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from psycopg import Error as ErrorPostgres
from starlette.concurrency import run_in_threadpool

from .http import Base, ErrorAPI, codificar
from .seguridad import SesionActual, activo, es_admin, nombre_rol, usuario_por_id

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
        or (evento["recurso"] == "acceso" and nombre_rol(usuario) == "celador")
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

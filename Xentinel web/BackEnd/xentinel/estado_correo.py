"""Diagnóstico del correo para administración: qué transporte usa, cómo va la cola y una
prueba de envío que devuelve la causa exacta de un fallo (p. ej. ``invalid_grant``)."""

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from . import correo
from .autenticacion import Correo
from .http import Base, Entrada, ErrorAPI, responder
from .proteccion_http import contar_peticion
from .seguridad import Administrador

rutas = APIRouter(prefix="/correo", tags=["Correo"])


class Prueba(Entrada):
    destino: Correo


def correo_no_configurado():
    return ErrorAPI(
        503,
        "MAIL_NOT_CONFIGURED",
        "El envío de correos no está configurado en el servidor. Define GMAIL_CLIENT_ID, "
        "GMAIL_CLIENT_SECRET y GMAIL_REFRESH_TOKEN (o SMTP_HOST) y reinicia la API.",
    )


@rutas.get("/estado")
def estado(db: Base, solicitud: Request, sesion: Administrador):
    """Transporte en uso, mensajes en cola de las últimas 24 horas y el último fallo."""
    config = solicitud.app.state.configuracion
    cola = db.fila("""SELECT
        count(*) FILTER (WHERE enviado_en IS NULL AND intentos<5)::int pendientes,
        count(*) FILTER (WHERE enviado_en>now()-interval '24 hours' AND error_codigo IS NULL)::int enviados_24h,
        count(*) FILTER (WHERE intentos>0 AND siguiente_intento>now()-interval '24 hours')::int con_fallos_24h,
        (SELECT error_codigo FROM mail_outbox WHERE error_codigo IS NOT NULL
            ORDER BY id_mail DESC LIMIT 1) ultimo_codigo
        FROM mail_outbox""")
    return responder(
        {
            "configurado": config.correo_configurado,
            "transporte": correo.transporte(config),
            "remitente": correo.remitente(config) or "La cuenta de Gmail autorizada",
            "cola": cola,
            "ultimo_fallo": correo.ULTIMO_FALLO or None,
        }
    )


@rutas.post("/prueba")
async def prueba(datos: Prueba, db: Base, solicitud: Request, sesion: Administrador):
    """Envía un correo de prueba en este momento, sin pasar por la cola.

    Responde 200 si el proveedor lo aceptó, o 502 con el código y la causa del fallo.
    """
    config = solicitud.app.state.configuracion
    if not config.correo_configurado:
        raise correo_no_configurado()
    await run_in_threadpool(
        contar_peticion, db, f"correo-prueba:{sesion.id}", "correo-prueba", 5, 900
    )
    try:
        await run_in_threadpool(correo.enviar_prueba, datos.destino, config)
    except correo.FalloCorreo as fallo:
        raise ErrorAPI(
            502, "MAIL_DELIVERY_FAILED", f"{fallo.codigo}: {fallo.detalle}"
        ) from None
    return responder({"enviado": True, "transporte": correo.transporte(config)})

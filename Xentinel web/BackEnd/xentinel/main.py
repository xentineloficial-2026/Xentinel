"""Aplicación ASGI, ciclo de vida y montaje de los módulos HTTP de Xentinel."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import accesos, alertas, autenticacion, catalogos, eventos, personas, programas
from .base_datos import BaseDatos, verificar_esquema
from .configuracion import RAIZ, cargar_configuracion
from .correo import conectar_smtp, mantener, procesar_correo
from .proteccion_http import MANEJADORES, ProteccionHTTP

LOG = logging.getLogger(__name__)


def verificar_smtp(config):
    # Un SMTP inalcanzable no debe tumbar la API: los correos quedan en cola y se reintentan.
    try:
        with conectar_smtp(config):
            pass
    except OSError as error:
        LOG.error("SMTP no disponible (%s); los correos quedan en cola", error)


def crear_aplicacion(configuracion=None):
    config = configuracion or cargar_configuracion()

    @asynccontextmanager
    async def ciclo_de_vida(app):
        base = BaseDatos(config.DATABASE_URL, config.DB_POOL_MAX)
        tareas = []
        try:
            await run_in_threadpool(base.pool.open, wait=True)
            await run_in_threadpool(verificar_esquema, base)
            app.state.base = base
            app.state.conexiones_eventos = eventos.ConexionesEventos()
            if config.SMTP_HOST:
                await run_in_threadpool(verificar_smtp, config)
                tareas.append(
                    asyncio.create_task(mantener(2, procesar_correo, base, config))
                )
            elif config.NODE_ENV == "production":
                LOG.warning(
                    "SMTP sin configurar: la recuperación de contraseña responde 503"
                )
            tareas.append(
                asyncio.create_task(
                    mantener(
                        60,
                        base.ejecutar,
                        "DELETE FROM api_rate_limits WHERE expires_at<now()",
                    )
                )
            )
            yield
        finally:
            for tarea in tareas:
                tarea.cancel()
            await asyncio.gather(*tareas, return_exceptions=True)
            await run_in_threadpool(base.pool.close)

    app = FastAPI(
        title="Xentinel API",
        version="1.0.0",
        lifespan=ciclo_de_vida,
        exception_handlers=MANEJADORES,
        redoc_url=None,
        redirect_slashes=False,
    )
    app.state.configuracion = config
    app.add_middleware(ProteccionHTTP, config=config)
    for rutas in (
        autenticacion.rutas,
        personas.rutas,
        accesos.rutas,
        programas.rutas,
        catalogos.rutas,
        catalogos.reportes,
        alertas.rutas,
        eventos.rutas,
    ):
        app.include_router(rutas, prefix="/api/v1")
    app.include_router(autenticacion.legado)
    app.include_router(alertas.legado)
    app.mount(
        "/recuperacion", StaticFiles(directory=RAIZ / "public"), name="recuperacion"
    )

    @app.get("/restablecer-contrasena", include_in_schema=False)
    def pagina_recuperacion():
        return FileResponse(
            RAIZ / "public" / "reset-password.html", media_type="text/html"
        )

    @app.get("/health", tags=["Estado"])
    def salud():
        return {"status": "ok"}

    @app.get("/ready", tags=["Estado"])
    def disponibilidad(solicitud: Request):
        verificar_esquema(solicitud.app.state.base)
        return {"status": "ready"}

    return app

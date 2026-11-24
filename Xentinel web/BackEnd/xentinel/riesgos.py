"""API de gestión de riesgos: cómo Xentinel decide si un sismo es una alarma.

El monitor sísmico (``sismos.py``) recibe los reportes de EMSC y USGS y los pasa por la
misma evaluación que exponen estas rutas. Aquí la administración puede:

- consultar los parámetros vigentes (sede, radio, magnitud mínima y reglas del semáforo);
- evaluar un sismo hipotético sin guardar nada (``/riesgos/evaluar``);
- lanzar un simulacro que recorre el flujo completo hasta la web y la app
  (``/riesgos/simular``);
- revisar el historial de sismos recibidos, incluidos los verdes que no generaron alarma.
"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Request
from pydantic import Field

from . import push, semaforo, sismos
from .http import Base, Entrada, Limite, responder, texto
from .seguridad import Administrador

rutas = APIRouter(prefix="/riesgos", tags=["Gestión de riesgos"])

REGLAS = [
    {
        "severidad": "critica",
        "semaforo": "rojo",
        "condicion": "M ≥ 6 a 200 km o menos, o M ≥ 7 a 500 km o menos",
    },
    {
        "severidad": "alta",
        "semaforo": "rojo",
        "condicion": "M ≥ 5 a 200 km o menos, o M ≥ 6 a 500 km o menos",
    },
    {
        "severidad": "moderada",
        "semaforo": "amarillo",
        "condicion": "M ≥ 4 a 100 km o menos, o M ≥ 5 a 500 km o menos",
    },
    {
        "severidad": "informativa",
        "semaforo": "verde",
        "condicion": "Cualquier otro sismo dentro del radio: se registra sin alarma",
    },
]


class EventoSismico(Entrada):
    magnitud: Annotated[float, Field(ge=0, le=10)]
    latitud: Annotated[float, Field(ge=-90, le=90)]
    longitud: Annotated[float, Field(ge=-180, le=180)]
    profundidad_km: Annotated[float, Field(ge=0, le=800)] | None = None


class Simulacro(EventoSismico):
    lugar: texto(2, 120) = "Simulacro Xentinel"
    # Con Firebase configurado, también envía la notificación push a teléfonos y navegadores.
    notificar: bool = False


@rutas.get("/configuracion")
def configuracion(solicitud: Request, sesion: Administrador):
    """Parámetros del monitor sísmico y tabla del semáforo que aplica la evaluación."""
    config = solicitud.app.state.configuracion
    return responder(
        {
            "monitor_activo": config.SEISMIC_ENABLED == "true",
            "fuentes": ["EMSC (WebSocket)", "USGS (consulta periódica)"],
            "sede": {"latitud": config.SEISMIC_LAT, "longitud": config.SEISMIC_LON},
            "radio_km": config.SEISMIC_RADIUS_KM,
            "magnitud_minima": config.SEISMIC_MIN_MAGNITUDE,
            "antiguedad_maxima_minutos": config.SEISMIC_MAX_AGE_MINUTES,
            "cierre_automatico_minutos": config.SEISMIC_ALERT_MINUTES,
            "notificaciones_push": bool(config.cuenta_firebase),
            "semaforo": REGLAS,
        }
    )


@rutas.post("/evaluar")
def evaluar(datos: EventoSismico, solicitud: Request, sesion: Administrador):
    """Evalúa un sismo hipotético con las reglas vigentes. No guarda ni notifica nada."""
    return responder(
        sismos.evaluar(
            solicitud.app.state.configuracion,
            datos.magnitud,
            datos.latitud,
            datos.longitud,
        )
    )


@rutas.post("/simular", status_code=201)
def simular(datos: Simulacro, db: Base, solicitud: Request, sesion: Administrador):
    """Simulacro de punta a punta: crea el sismo de prueba y, si es rojo o amarillo, su alerta.

    La alerta llega a la web y a la app por el canal en tiempo real como un sismo real,
    marcada como «SIMULACRO». Se cierra con ``PATCH /alertas/{id}/cerrar`` o sola al
    vencer, si el monitor sísmico está activo.
    """
    config = solicitud.app.state.configuracion
    evaluacion = sismos.evaluar(config, datos.magnitud, datos.latitud, datos.longitud)
    sismo = sismos.Sismo(
        fuente=sismos.FUENTE_PRUEBA,
        evento_id=f"prueba-{uuid4()}",
        magnitud=datos.magnitud,
        lugar=datos.lugar,
        latitud=datos.latitud,
        longitud=datos.longitud,
        profundidad_km=datos.profundidad_km,
        ocurrido_en=datetime.now(UTC),
    )
    resultado = sismos.registrar(db, config, sismo)
    alerta = resultado["alerta"] if resultado else None
    notificado = False
    if alerta and datos.notificar and config.cuenta_firebase:
        try:
            push.enviar_alerta_sismo(config, alerta, sismo, resultado["distancia"])
            notificado = True
        except (OSError, KeyError, ValueError):
            notificado = False
    if alerta:
        alerta = {**alerta, "semaforo": semaforo.de_severidad(alerta["severidad"])}
    return responder(
        {
            "evaluacion": evaluacion,
            "alerta": alerta,
            "notificado": notificado,
            "evento_id": sismo.evento_id,
        },
        201,
    )


@rutas.get("/sismos")
def historial(db: Base, sesion: Administrador, limit: Limite = 25):
    """Últimos sismos recibidos, con su semáforo. Los verdes figuran sin alerta."""
    filas = db.filas(
        """SELECT s.*,a.activa AS alerta_activa FROM sismos_detectados s
        LEFT JOIN alertas_emergencia a USING(id_alerta)
        ORDER BY s.id_sismo DESC LIMIT %s""",
        limit,
    )
    return responder(
        [
            {
                **fila,
                "severidad": (
                    nivel := sismos.severidad(
                        float(fila["magnitud"]), float(fila["distancia_km"])
                    )
                ),
                "semaforo": semaforo.de_severidad(nivel),
            }
            for fila in filas
        ],
        meta={"limit": limit},
    )

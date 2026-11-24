"""Monitor sísmico: EMSC por WebSocket (segundos) y USGS por consulta periódica (respaldo).

Cada sismo dentro del radio y sobre la magnitud mínima crea una alerta de emergencia: la web
y la app abiertas la reciben al instante por su canal en tiempo real, y Firebase Cloud
Messaging la entrega a los teléfonos y navegadores cerrados. Las agencias publican el sismo
uno o varios minutos después de ocurrido: es un aviso inmediato, no una alerta temprana.
"""

import asyncio
import json
import logging
import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from starlette.concurrency import run_in_threadpool
from websockets.asyncio.client import connect

from . import push, semaforo
from .correo import mantener
from .google import pedir_json

LOG = logging.getLogger(__name__)
RADIO_TIERRA_KM = 6371.0088
# El mismo sismo informado por dos agencias: menos de 2 minutos y 50 km de diferencia.
VENTANA_DUPLICADO = timedelta(minutes=2)
DISTANCIA_DUPLICADO_KM = 50
# Sismos simulados desde la API de riesgos: nunca se agrupan con reportes reales.
FUENTE_PRUEBA = "PRUEBA"


@dataclass(frozen=True)
class Sismo:
    fuente: str
    evento_id: str
    magnitud: float
    lugar: str
    latitud: float
    longitud: float
    profundidad_km: float | None
    ocurrido_en: datetime


def distancia_km(lat1, lon1, lat2, lon2):
    """Distancia de Haversine sobre la Tierra esférica."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * RADIO_TIERRA_KM * math.asin(math.sqrt(a))


def fecha_iso(valor):
    fecha = datetime.fromisoformat(str(valor))
    return fecha if fecha.tzinfo else fecha.replace(tzinfo=UTC)


def leer_emsc(texto):
    """Mensaje del WebSocket de SeismicPortal: {"action": ..., "data": Feature GeoJSON}."""
    mensaje = json.loads(texto)
    rasgo = mensaje.get("data", mensaje)
    if mensaje.get("action", "create") not in ("create", "update"):
        return None
    propiedades = rasgo["properties"]
    coordenadas = (rasgo.get("geometry") or {}).get("coordinates") or [None] * 3
    profundidad = propiedades.get("depth")
    if profundidad is None and coordenadas[2] is not None:
        profundidad = abs(float(coordenadas[2]))
    return Sismo(
        fuente="EMSC",
        evento_id=str(propiedades.get("unid") or rasgo["id"])[:120],
        magnitud=float(propiedades["mag"]),
        lugar=str(propiedades.get("flynn_region") or "Región sin nombre").title()[:200],
        latitud=float(propiedades.get("lat", coordenadas[1])),
        longitud=float(propiedades.get("lon", coordenadas[0])),
        profundidad_km=None if profundidad is None else float(profundidad),
        ocurrido_en=fecha_iso(propiedades["time"]),
    )


def leer_usgs(geojson):
    """Respuesta GeoJSON del servicio FDSN Event de USGS."""
    sismos = []
    for rasgo in geojson.get("features", []):
        try:
            propiedades = rasgo["properties"]
            longitud, latitud, profundidad = rasgo["geometry"]["coordinates"][:3]
            sismos.append(
                Sismo(
                    fuente="USGS",
                    evento_id=str(rasgo["id"])[:120],
                    magnitud=float(propiedades["mag"]),
                    lugar=str(propiedades.get("place") or "Región sin nombre")[:200],
                    latitud=float(latitud),
                    longitud=float(longitud),
                    profundidad_km=None if profundidad is None else float(profundidad),
                    ocurrido_en=datetime.fromtimestamp(propiedades["time"] / 1000, UTC),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return sismos


def severidad(magnitud, distancia):
    """Severidad según lo que probablemente se sienta en la sede."""
    if (magnitud >= 6 and distancia <= 200) or (magnitud >= 7 and distancia <= 500):
        return "critica"
    if (magnitud >= 5 and distancia <= 200) or (magnitud >= 6 and distancia <= 500):
        return "alta"
    if (magnitud >= 4 and distancia <= 100) or (magnitud >= 5 and distancia <= 500):
        return "moderada"
    return "informativa"


def evaluar(config, magnitud, latitud, longitud):
    """Evaluación de riesgo de un sismo para la sede, sin guardar nada.

    ``genera_alarma`` es verdadero solo para rojo o amarillo dentro del radio vigilado y
    desde la magnitud mínima; ``motivo`` explica por qué no, cuando no la genera.
    """
    distancia = distancia_km(config.SEISMIC_LAT, config.SEISMIC_LON, latitud, longitud)
    nivel = severidad(magnitud, distancia)
    color = semaforo.de_severidad(nivel)
    motivo = None
    if distancia > config.SEISMIC_RADIUS_KM:
        motivo = (
            f"Está a {distancia:.0f} km, fuera del radio vigilado de "
            f"{config.SEISMIC_RADIUS_KM:.0f} km."
        )
    elif magnitud < config.SEISMIC_MIN_MAGNITUDE:
        motivo = (
            f"La magnitud {magnitud:.1f} es menor que la mínima vigilada "
            f"({config.SEISMIC_MIN_MAGNITUDE:.1f})."
        )
    elif color not in semaforo.ALARMA:
        motivo = "Riesgo normal (verde): se registra, pero no genera alarma."
    return {
        "distancia_km": round(distancia, 1),
        "severidad": nivel,
        "semaforo": color,
        "dentro_del_radio": distancia <= config.SEISMIC_RADIUS_KM,
        "genera_alarma": motivo is None,
        "motivo": motivo,
    }


def mensaje_alerta(sismo, distancia, zona):
    hora = sismo.ocurrido_en.astimezone(ZoneInfo(zona)).strftime("%H:%M")
    profundidad = (
        ""
        if sismo.profundidad_km is None
        else f", profundidad {sismo.profundidad_km:.0f} km"
    )
    origen = (
        "Simulacro generado desde la API de gestión de riesgos"
        if sismo.fuente == FUENTE_PRUEBA
        else f"Reportado por {sismo.fuente}"
    )
    return (
        f"{'SIMULACRO. ' if sismo.fuente == FUENTE_PRUEBA else ''}"
        f"Sismo de magnitud {sismo.magnitud:.1f} ({sismo.lugar}) a {distancia:.0f} km de la "
        f"sede{profundidad}, a las {hora} hora local. {origen}. "
        "Agáchate, cúbrete y sujétate. Si estás al aire libre, aléjate de edificios, postes "
        "y cables; después sigue las indicaciones del personal."
    )


def registrar(base, config, sismo, ahora=None):
    """Guarda el sismo y crea su alerta si el semáforo es rojo o amarillo.

    None si no aplica, si es verde (se guarda sin alerta) o si ya se alertó ese sismo.
    """
    ahora = ahora or datetime.now(UTC)
    evaluacion = evaluar(config, sismo.magnitud, sismo.latitud, sismo.longitud)
    distancia = distancia_km(
        config.SEISMIC_LAT, config.SEISMIC_LON, sismo.latitud, sismo.longitud
    )
    if (
        distancia > config.SEISMIC_RADIUS_KM
        or sismo.magnitud < config.SEISMIC_MIN_MAGNITUDE
        or sismo.ocurrido_en < ahora - timedelta(minutes=config.SEISMIC_MAX_AGE_MINUTES)
        or sismo.ocurrido_en > ahora + timedelta(minutes=10)
    ):
        return None
    alarma = evaluacion["semaforo"] in semaforo.ALARMA
    prueba = sismo.fuente == FUENTE_PRUEBA
    with base.transaccion() as db:
        # EMSC y USGS llegan en paralelo: un solo registro a la vez decide si es nuevo.
        db.ejecutar("SELECT pg_advisory_xact_lock(91734203)")
        if db.fila(
            "SELECT 1 FROM sismos_detectados WHERE fuente=%s AND evento_id=%s",
            sismo.fuente,
            sismo.evento_id,
        ):
            return None
        cercanos = (
            []
            if prueba
            else db.filas(
                """SELECT latitud,longitud,id_alerta FROM sismos_detectados
                WHERE ocurrido_en BETWEEN %s AND %s AND fuente<>%s ORDER BY id_sismo""",
                sismo.ocurrido_en - VENTANA_DUPLICADO,
                sismo.ocurrido_en + VENTANA_DUPLICADO,
                FUENTE_PRUEBA,
            )
        )
        mismo = next(
            (
                fila
                for fila in cercanos
                if distancia_km(
                    float(fila["latitud"]),
                    float(fila["longitud"]),
                    sismo.latitud,
                    sismo.longitud,
                )
                < DISTANCIA_DUPLICADO_KM
            ),
            None,
        )
        alerta = None
        # Un sismo verde se guarda sin alerta. Si otra agencia lo reporta después con un
        # nivel de alarma (p. ej. una magnitud corregida), ahí sí se crea la alerta.
        if alarma and (not mismo or mismo["id_alerta"] is None):
            alerta = db.fila(
                """INSERT INTO alertas_emergencia(tipo_alerta,mensaje,severidad,fuente,
                referencia_externa,emisor_id) VALUES('Sismo',%s,%s,%s,%s,NULL) RETURNING *""",
                mensaje_alerta(sismo, distancia, config.ZONA_HORARIA),
                evaluacion["severidad"],
                sismo.fuente,
                sismo.evento_id,
            )
        db.ejecutar(
            """INSERT INTO sismos_detectados(fuente,evento_id,magnitud,lugar,latitud,longitud,
            profundidad_km,distancia_km,ocurrido_en,id_alerta)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            sismo.fuente,
            sismo.evento_id,
            round(sismo.magnitud, 1),
            sismo.lugar,
            round(sismo.latitud, 4),
            round(sismo.longitud, 4),
            None if sismo.profundidad_km is None else round(sismo.profundidad_km, 1),
            round(distancia, 1),
            sismo.ocurrido_en,
            alerta["id_alerta"] if alerta else (mismo or {}).get("id_alerta"),
        )
    return {"alerta": alerta, "distancia": distancia} if alerta else None


async def procesar(base, config, sismo):
    resultado = await run_in_threadpool(registrar, base, config, sismo)
    if not resultado:
        return
    alerta = resultado["alerta"]
    LOG.warning(
        "Alerta sísmica %s: M%.1f a %.0f km (%s)",
        alerta["id_alerta"],
        sismo.magnitud,
        resultado["distancia"],
        sismo.fuente,
    )
    if config.cuenta_firebase:
        try:
            await run_in_threadpool(
                push.enviar_alerta_sismo, config, alerta, sismo, resultado["distancia"]
            )
        except (OSError, KeyError, ValueError) as error:
            LOG.error("No se pudo enviar la alerta por FCM (%s)", type(error).__name__)


async def escuchar_emsc(base, config):
    espera = 1
    while True:
        try:
            async with connect(
                config.SEISMIC_EMSC_URL, open_timeout=15, ping_interval=30
            ) as canal:
                espera = 1
                async for texto in canal:
                    try:
                        sismo = leer_emsc(texto)
                    except (KeyError, TypeError, ValueError):
                        continue
                    if sismo:
                        await procesar(base, config, sismo)
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - reconecta ante cualquier caída de red.
            LOG.warning(
                "EMSC desconectado (%s); reintento en %s s",
                type(error).__name__,
                espera,
            )
        await asyncio.sleep(espera)
        espera = min(espera * 2, 60)


def consultar_usgs(config):
    desde = datetime.now(UTC) - timedelta(minutes=config.SEISMIC_MAX_AGE_MINUTES)
    parametros = {
        "format": "geojson",
        "latitude": config.SEISMIC_LAT,
        "longitude": config.SEISMIC_LON,
        "maxradiuskm": config.SEISMIC_RADIUS_KM,
        "minmagnitude": config.SEISMIC_MIN_MAGNITUDE,
        "starttime": desde.strftime("%Y-%m-%dT%H:%M:%S"),
        "orderby": "time-asc",
    }
    return leer_usgs(pedir_json(f"{config.SEISMIC_USGS_URL}?{urlencode(parametros)}"))


async def sondear_usgs(base, config):
    while True:
        try:
            for sismo in await run_in_threadpool(consultar_usgs, config):
                await procesar(base, config, sismo)
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - el siguiente sondeo vuelve a intentar.
            LOG.warning("USGS no respondió (%s)", type(error).__name__)
        await asyncio.sleep(config.SEISMIC_USGS_INTERVAL)


def cerrar_vencidas(base, config):
    base.ejecutar(
        """UPDATE alertas_emergencia SET activa=false,fecha_fin=now()
        WHERE activa AND tipo_alerta='Sismo' AND emisor_id IS NULL
        AND fecha_inicio<now()-make_interval(mins=>%s)""",
        config.SEISMIC_ALERT_MINUTES,
    )


def iniciar(base, config):
    return [
        asyncio.create_task(escuchar_emsc(base, config)),
        asyncio.create_task(sondear_usgs(base, config)),
        asyncio.create_task(mantener(60, cerrar_vencidas, base, config)),
    ]

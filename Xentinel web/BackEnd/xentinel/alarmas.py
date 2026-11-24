"""Alarmas: lo único que pide atención, ordenado por el semáforo (rojo y amarillo).

Reaccionan a dos casos y a nada más:

1. Riesgos críticos: las alertas activas que evalúa la gestión de riesgos (sismos de
   EMSC y USGS, y las que publica administración), solo en rojo o amarillo.
2. Escaneo de carnets: un QR vencido (amarillo) o que no es verídico (rojo). Las crea el
   servidor al rechazar el escaneo y el lector cuando el código ni siquiera es de Xentinel.

El verde (normal) nunca aparece aquí.
"""

import re
from hashlib import sha256
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import StringConstraints

from . import semaforo
from .http import Base, Entrada, ErrorAPI, IdRuta, Limite, codificar, responder
from .seguridad import CeladorOAdmin, SesionActual, es_admin, nombre_rol

rutas = APIRouter(prefix="/alarmas", tags=["Alarmas"])

# motivo: (semáforo, título visible)
MOTIVOS = {
    "QR_VENCIDO": ("amarillo", "Carnet QR vencido"),
    "QR_INVALIDO": ("rojo", "Carnet QR no verídico"),
}
# Lecturas repetidas del mismo código (la cámara lo ve varias veces) son una sola alarma.
VENTANA_REPETICION = "2 minutes"
ID_EN_CODIGO = re.compile(r"^(?:XN2|XENTINEL):([0-9]{1,10}):")
ORDEN = {"rojo": 0, "amarillo": 1}


def huella(contenido):
    return sha256(contenido.encode()).hexdigest()


def id_reclamado(contenido):
    """El identificador que el código dice tener. No prueba nada: solo orienta la revisión."""
    encontrado = ID_EN_CODIGO.match(contenido.strip())
    return int(encontrado[1]) if encontrado else None


def detalle_por_defecto(motivo, titular):
    if motivo == "QR_VENCIDO":
        return (
            f"El carnet de {titular} estaba vencido al escanearlo. Pide que lo "
            "actualice en la app y vuelve a escanear."
            if titular
            else "El carnet estaba vencido al escanearlo. Pide que lo actualicen en la app."
        )
    return (
        "La firma no corresponde a ningún carnet vigente de Xentinel. Puede ser una "
        "captura de pantalla, un carnet revocado o un código falsificado. Verifica el "
        "documento de identidad."
    )


def registrar_alarma_qr(
    base,
    *,
    motivo,
    contenido,
    registrado_por,
    tipo=None,
    id_usuarios=None,
    detalle=None,
):
    """Guarda la alarma en su propia transacción y devuelve ``(fila, nueva)``.

    Se llama después de que la transacción del escaneo rechazado se revirtió: la
    alarma queda aunque el movimiento no se registre.
    """
    color, _ = MOTIVOS[motivo]
    marca = huella(contenido)
    with base.transaccion() as db:
        db.ejecutar(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 91734205))", marca
        )
        previa = db.fila(
            f"""SELECT * FROM alarmas_qr WHERE huella=%s AND motivo=%s
            AND creado_en>now()-interval '{VENTANA_REPETICION}'
            ORDER BY id_alarma DESC LIMIT 1""",
            marca,
            motivo,
        )
        if previa:
            return previa, False
        titular = (
            db.fila(
                "SELECT nombres_completos FROM usuarios WHERE id_usuarios=%s",
                id_usuarios,
            )
            if id_usuarios
            else None
        )
        fila = db.fila(
            """INSERT INTO alarmas_qr(motivo,semaforo,id_usuarios,id_reclamado,
            tipo_movimiento,detalle,huella,registrado_por)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            motivo,
            color,
            id_usuarios,
            id_reclamado(contenido),
            tipo,
            (
                detalle
                or detalle_por_defecto(
                    motivo, titular["nombres_completos"] if titular else None
                )
            )[:300],
            marca,
            registrado_por,
        )
    return fila, True


def ve_alarmas_qr(usuario):
    """Las alarmas de escaneo son del personal de control y de administración."""
    return es_admin(usuario) or nombre_rol(usuario) == "celador"


def alarma_de_riesgo(fila):
    return {
        "id": f"riesgo-{fila['id_alerta']}",
        "origen": "riesgo",
        "semaforo": fila["semaforo"],
        "titulo": fila["tipo_alerta"],
        "detalle": fila["mensaje"] or "",
        "fecha": fila["fecha_inicio"],
        "id_alerta": fila["id_alerta"],
        "severidad": fila["severidad"],
        "fuente": fila["fuente"],
    }


def alarma_de_qr(fila):
    return {
        "id": f"qr-{fila['id_alarma']}",
        "origen": "qr",
        "semaforo": fila["semaforo"],
        "titulo": MOTIVOS[fila["motivo"]][1],
        "detalle": fila["detalle"],
        "fecha": fila["creado_en"],
        "id_alarma": fila["id_alarma"],
        "motivo": fila["motivo"],
        "tipo_movimiento": fila["tipo_movimiento"],
        "id_usuarios": fila["id_usuarios"],
        "titular": fila["titular"],
        "id_reclamado": fila["id_reclamado"],
        "registrado_por": fila["registrado_por_nombre"],
    }


@rutas.get("")
def listar(
    db: Base,
    sesion: SesionActual,
    semaforo_filtro: Annotated[
        Literal["rojo", "amarillo"] | None,
        # El parámetro público se llama «semaforo»; el nombre interno evita ocultar el módulo.
        Query(alias="semaforo"),
    ] = None,
    limit: Limite = 50,
):
    """Alarmas vigentes, primero las rojas y luego las amarillas; las más recientes arriba.

    Todas las personas ven los riesgos críticos. El personal de control y administración
    ve además las alarmas de escaneo pendientes de atender.
    """
    riesgos = db.filas(
        f"""SELECT id_alerta,tipo_alerta,mensaje,severidad,fuente,fecha_inicio,
        {semaforo.sql()} AS semaforo FROM alertas_emergencia
        WHERE activa AND {semaforo.SIN_VERDE} ORDER BY id_alerta DESC LIMIT %s""",
        limit,
    )
    incluye_qr = ve_alarmas_qr(sesion.usuario)
    escaneos = (
        db.filas(
            """SELECT a.*,t.nombres_completos AS titular,
            r.nombres_completos AS registrado_por_nombre FROM alarmas_qr a
            LEFT JOIN usuarios t ON t.id_usuarios=a.id_usuarios
            LEFT JOIN usuarios r ON r.id_usuarios=a.registrado_por
            WHERE a.atendida_en IS NULL ORDER BY a.id_alarma DESC LIMIT %s""",
            limit,
        )
        if incluye_qr
        else []
    )
    todas = [alarma_de_riesgo(fila) for fila in riesgos] + [
        alarma_de_qr(fila) for fila in escaneos
    ]
    conteo = {color: 0 for color in semaforo.ALARMA}
    for alarma in todas:
        conteo[alarma["semaforo"]] += 1
    visibles = [
        alarma
        for alarma in todas
        if semaforo_filtro is None or alarma["semaforo"] == semaforo_filtro
    ]
    # Rojo antes que amarillo; dentro de cada color, la más reciente primero.
    visibles.sort(key=lambda alarma: alarma["fecha"], reverse=True)
    visibles.sort(key=lambda alarma: ORDEN[alarma["semaforo"]])
    return responder(
        visibles[:limit],
        meta={"conteo": conteo, "incluye_qr": incluye_qr, "semaforo": semaforo_filtro},
    )


class ReporteQr(Entrada):
    motivo: Literal["QR_VENCIDO", "QR_INVALIDO"]
    # Lo que leyó la cámara. Se usa para la huella y el identificador reclamado; no se guarda.
    contenido: Annotated[str, StringConstraints(min_length=1, max_length=2048)]
    tipo: Literal["ENTRADA", "SALIDA"] | None = None


@rutas.post("/qr", status_code=201, responses={200: {"description": "Repetición"}})
def reportar_qr(datos: ReporteQr, db: Base, sesion: CeladorOAdmin):
    """El lector informa un código que rechazó sin consultar el registro de ingresos.

    Por ejemplo, un QR que no es de Xentinel o un carnet heredado ya vencido. Si el mismo
    código se reporta otra vez en dos minutos, responde 200 con la alarma existente.
    """
    fila, nueva = registrar_alarma_qr(
        db,
        motivo=datos.motivo,
        contenido=datos.contenido,
        registrado_por=sesion.id,
        tipo=datos.tipo,
        detalle=(
            "El código leído no es un carnet de Xentinel. Verifica el documento de "
            "identidad antes de permitir el paso."
            if datos.motivo == "QR_INVALIDO" and id_reclamado(datos.contenido) is None
            else None
        ),
    )
    if nueva:
        return responder(fila, 201)
    return JSONResponse(codificar({"data": fila}), status_code=200)


@rutas.patch("/qr/{id}/atender")
def atender_qr(id: IdRuta, db: Base, sesion: CeladorOAdmin):
    """Marca la alarma como revisada: sale de la lista de pendientes y conserva su historial."""
    fila = db.fila(
        """UPDATE alarmas_qr SET atendida_en=coalesce(atendida_en,now()),
        atendida_por=coalesce(atendida_por,%s) WHERE id_alarma=%s RETURNING *""",
        sesion.id,
        id,
    )
    if not fila:
        raise ErrorAPI(404, "NOT_FOUND", "Alarma no encontrada")
    return responder(fila)

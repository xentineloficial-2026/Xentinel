"""Alertas institucionales, ubicación SOS y pases de lista con control de acceso."""

from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import Field, StrictBool, StringConstraints, field_validator

from .http import Base, Entrada, ErrorAPI, Id, IdRuta, Paginacion, responder, texto
from .seguridad import Administrador, InstructorOAdmin, SesionActual, es_admin

rutas = APIRouter(prefix="/alertas", tags=["Alertas"])
legado = APIRouter(include_in_schema=False)


class Alerta(Entrada):
    tipo_alerta: Literal[
        "Sismo", "Meteorológica", "Evacuación", "Incendio", "Simulacro", "Otra"
    ]
    mensaje: texto(5, 5000)
    severidad: Literal["informativa", "moderada", "alta", "critica"] = "alta"
    fuente: texto(1, 120) = "Operador SENA"
    referencia_externa: texto(1, 200) = None


class UbicacionSOS(Entrada):
    id_alerta: Id
    latitud: Annotated[float, Field(strict=True, ge=-90, le=90)]
    longitud: Annotated[float, Field(strict=True, ge=-180, le=180)]


class Estudiante(Entrada):
    id_usuarios: Id
    presente: StrictBool


class Reporte(Entrada):
    id_alerta: Id
    id_ficha: Id
    observaciones: Annotated[str, StringConstraints(max_length=5000)] = None
    estudiantes: Annotated[list[Estudiante], Field(min_length=1, max_length=500)]

    @field_validator("estudiantes")
    @classmethod
    def validar_estudiantes(cls, estudiantes):
        if len({persona.id_usuarios for persona in estudiantes}) != len(estudiantes):
            raise ValueError("Estudiantes repetidos")
        return estudiantes


def alerta_ausente():
    return ErrorAPI(404, "NOT_FOUND", "Alerta no encontrada")


def comprobar_alerta_activa(db, identificador):
    alerta = db.fila(
        "SELECT activa FROM alertas_emergencia WHERE id_alerta=%s FOR SHARE",
        identificador,
    )
    if not alerta:
        raise alerta_ausente()
    if not alerta["activa"]:
        raise ErrorAPI(409, "ALERT_CLOSED", "La alerta está cerrada")


@rutas.get("")
def listar(
    db: Base,
    pagina: Paginacion,
    sesion: SesionActual,
    activa: Literal["true", "false"] | None = None,
):
    filtro = None if activa is None else activa == "true"
    return responder(
        db.filas(
            """SELECT * FROM alertas_emergencia WHERE (%s::boolean IS NULL OR activa=%s)
        ORDER BY id_alerta DESC LIMIT %s OFFSET %s""",
            filtro,
            filtro,
            pagina["limit"],
            pagina["offset"],
        ),
        meta={**pagina, "activa": activa},
    )


@rutas.get("/activas")
def alertas_activas(db: Base, sesion: SesionActual):
    return responder(
        db.filas(
            "SELECT * FROM alertas_emergencia WHERE activa ORDER BY id_alerta DESC"
        )
    )


@legado.get("/alertas/estado-actual")
def estado_actual(db: Base, sesion: SesionActual):
    alerta = db.fila(
        "SELECT * FROM alertas_emergencia WHERE activa ORDER BY id_alerta DESC LIMIT 1"
    )
    return responder(alerta or {"activa": False}, legado=True)


@rutas.post("", status_code=201)
def crear(datos: Alerta, db: Base, sesion: Administrador):
    fila = db.fila(
        """INSERT INTO alertas_emergencia(tipo_alerta,mensaje,severidad,fuente,referencia_externa,emisor_id)
        VALUES(%s,%s,%s,%s,%s,%s) RETURNING *""",
        datos.tipo_alerta,
        datos.mensaje,
        datos.severidad,
        datos.fuente,
        datos.referencia_externa,
        sesion.id,
    )
    return responder(fila, 201)


@rutas.post("/sos", status_code=201)
def registrar_sos(datos: UbicacionSOS, db: Base, sesion: SesionActual):
    with db.transaccion() as conexion:
        comprobar_alerta_activa(conexion, datos.id_alerta)
        ubicacion = conexion.fila(
            """INSERT INTO ubicaciones_sos(id_alerta,id_aprendiz,latitud,longitud)
            VALUES(%s,%s,%s,%s) RETURNING *""",
            datos.id_alerta,
            sesion.id,
            datos.latitud,
            datos.longitud,
        )
    return responder(ubicacion, 201)


@rutas.post("/reportes", status_code=201)
def enviar_pase_lista(datos: Reporte, db: Base, sesion: InstructorOAdmin):
    identificadores = [persona.id_usuarios for persona in datos.estudiantes]
    presentes = [persona.presente for persona in datos.estudiantes]
    with db.transaccion() as conexion:
        comprobar_alerta_activa(conexion, datos.id_alerta)
        if not es_admin(sesion.usuario) and not conexion.fila(
            """SELECT 1 FROM instructor_ficha
            WHERE id_usuarios=%s AND id_ficha=%s AND lower(estado)='activo' """,
            sesion.id,
            datos.id_ficha,
        ):
            raise ErrorAPI(403, "FORBIDDEN", "No está asignado a esta ficha")
        miembros = conexion.filas(
            """SELECT DISTINCT id_usuarios FROM aprendiz_ficha
            WHERE id_ficha=%s AND id_usuarios=ANY(%s::integer[]) AND fechasalida IS NULL
            AND lower(estado) NOT IN ('inactivo','retirado','finalizado','cancelado','desertado')""",
            datos.id_ficha,
            identificadores,
        )
        if len(miembros) != len(identificadores):
            raise ErrorAPI(
                422,
                "INVALID_MEMBERSHIP",
                "Hay estudiantes que no pertenecen a la ficha",
            )
        reporte = conexion.fila(
            """INSERT INTO reportes_pase_lista(id_alerta,id_instructor,id_ficha,
            observaciones,estudiantes_presentes) VALUES(%s,%s,%s,%s,'[]')
            RETURNING id_reporte,id_alerta,id_instructor,id_ficha,observaciones,fecha_envio""",
            datos.id_alerta,
            sesion.id,
            datos.id_ficha,
            datos.observaciones or None,
        )
        conexion.ejecutar(
            """INSERT INTO reporte_estudiantes(id_reporte,id_usuarios,presente)
            SELECT %s,* FROM unnest(%s::integer[],%s::boolean[])""",
            reporte["id_reporte"],
            identificadores,
            presentes,
        )
    return responder({**reporte, "estudiantes": datos.estudiantes}, 201)


@rutas.get("/{id}")
def detalle(id: IdRuta, db: Base, sesion: SesionActual):
    alerta = db.fila("SELECT * FROM alertas_emergencia WHERE id_alerta=%s", id)
    if not alerta:
        raise alerta_ausente()
    return responder(alerta)


@rutas.patch("/{id}/cerrar")
def cerrar(id: IdRuta, db: Base, sesion: Administrador):
    with db.transaccion() as conexion:
        alerta = conexion.fila(
            "SELECT * FROM alertas_emergencia WHERE id_alerta=%s FOR UPDATE", id
        )
        if not alerta:
            raise alerta_ausente()
        if alerta["activa"]:
            alerta = conexion.fila(
                """UPDATE alertas_emergencia SET activa=false,fecha_fin=now(),cerrada_por=%s
                WHERE id_alerta=%s RETURNING *""",
                sesion.id,
                id,
            )
    return responder(alerta)


@rutas.get("/{id}/sos")
def listar_sos(id: IdRuta, db: Base, pagina: Paginacion, sesion: Administrador):
    return responder(
        db.filas(
            """SELECT * FROM ubicaciones_sos WHERE id_alerta=%s ORDER BY id_sos DESC
        LIMIT %s OFFSET %s""",
            id,
            pagina["limit"],
            pagina["offset"],
        ),
        meta=pagina,
    )


@rutas.get("/{id}/reportes")
def reportes(id: IdRuta, db: Base, pagina: Paginacion, sesion: InstructorOAdmin):
    instructor = None if es_admin(sesion.usuario) else sesion.id
    return responder(
        db.filas(
            """SELECT r.id_reporte,r.id_alerta,r.id_instructor,r.id_ficha,r.observaciones,r.fecha_envio,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id_usuarios',e.id_usuarios,'presente',e.presente))
            FROM reporte_estudiantes e WHERE e.id_reporte=r.id_reporte),'[]'::jsonb) estudiantes
        FROM reportes_pase_lista r WHERE id_alerta=%s AND (%s::integer IS NULL OR id_instructor=%s)
        ORDER BY id_reporte DESC LIMIT %s OFFSET %s""",
            id,
            instructor,
            instructor,
            pagina["limit"],
            pagina["offset"],
        ),
        meta=pagina,
    )

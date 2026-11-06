"""Catálogos de lectura, asistencias y reportes administrativos completos."""

from datetime import date, time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from psycopg import sql
from pydantic import model_validator

from .accesos import AULA_DE_FICHA, SITUACIONES_RETIRO
from .http import (
    ENTERO_MAXIMO,
    Base,
    Entrada,
    ErrorAPI,
    IdRuta,
    Limite,
    Paginacion,
    responder,
)
from .programas import Hora
from .seguridad import Administrador, InstructorOAdmin, SesionActual, es_admin

rutas = APIRouter(tags=["Catálogos"])
reportes = APIRouter(prefix="/reportes", tags=["Reportes administrativos"])
Cursor = Annotated[int, Query(ge=0, le=ENTERO_MAXIMO)]
CATALOGOS = {
    "roles": ("rol", "id_rol"),
    "fichas": ("ficha", "id_ficha"),
    "jornadas": ("jornada", "id_jornada"),
    "horarios": ("horarios", "id_horario"),
}


def ruta_catalogo(tabla, clave):
    consulta = sql.SQL("SELECT * FROM {} ORDER BY {} LIMIT %s OFFSET %s").format(
        sql.Identifier(tabla), sql.Identifier(clave)
    )

    def listar(db: Base, pagina: Paginacion, sesion: SesionActual):
        return responder(
            db.filas(consulta, pagina["limit"], pagina["offset"]), meta=pagina
        )

    return listar


for segmento, (tabla, clave) in CATALOGOS.items():
    rutas.add_api_route(
        f"/{segmento}",
        ruta_catalogo(tabla, clave),
        methods=["GET"],
        name=f"Listar {segmento}",
    )


@rutas.get("/asistencias")
def asistencias(db: Base, pagina: Paginacion, sesion: SesionActual):
    usuario = None if es_admin(sesion.usuario) else sesion.id
    return responder(
        db.filas(
            """SELECT a.*,u.nombres_completos FROM asistencia a
        JOIN usuarios u ON u.id_usuarios=a.id_usuarios
        WHERE %s::integer IS NULL OR a.id_usuarios=%s
        ORDER BY a.fecha DESC,a.id_asistencia DESC LIMIT %s OFFSET %s""",
            usuario,
            usuario,
            pagina["limit"],
            pagina["offset"],
        ),
        meta=pagina,
    )


FICHAS_VISIBLES = """(%(titular)s::integer IS NULL OR f.id_ficha IN (
    SELECT id_ficha FROM instructor_ficha
    WHERE id_usuarios=%(titular)s AND lower(estado)='activo'))"""


@rutas.get("/asistencias/fichas")
def fichas_de_asistencia(db: Base, sesion: InstructorOAdmin):
    """El administrador ve todas las fichas; el instructor, solo las asignadas."""
    titular = None if es_admin(sesion.usuario) else sesion.id
    with db.transaccion() as conexion:
        with conexion.conexion.cursor() as cursor:
            filas = cursor.execute(
                f"""SELECT f.id_ficha,f.numero_ficha,p.nombre_programa,f.jornada,
                v.hora_inicio,v.hora_fin
                FROM ficha f JOIN programa p USING(id_programa)
                LEFT JOIN LATERAL (SELECT j.hora_inicio,j.hora_fin FROM jornada j
                    WHERE j.id_ficha=f.id_ficha ORDER BY j.id_jornada DESC LIMIT 1) v ON true
                WHERE {FICHAS_VISIBLES} ORDER BY f.numero_ficha""",
                {"titular": titular},
            ).fetchall()
    return responder(filas)


class JornadaFicha(Entrada):
    nombre: Literal["Mañana", "Tarde", "Noche", "Mixta"]
    hora_inicio: Hora
    hora_fin: Hora

    @model_validator(mode="after")
    def validar_horas(self):
        if time.fromisoformat(self.hora_fin) <= time.fromisoformat(self.hora_inicio):
            raise ValueError("La hora de fin debe ser posterior a la de inicio")
        return self


@rutas.put("/fichas/{id}/jornada")
def cambiar_jornada(id: IdRuta, datos: JornadaFicha, db: Base, sesion: Administrador):
    """La jornada más reciente es la vigente. Las anteriores se conservan: la asistencia
    ya registrada sigue apuntando al horario con el que se calificó."""
    inicio = time.fromisoformat(datos.hora_inicio)
    fin = time.fromisoformat(datos.hora_fin)
    with db.transaccion() as conexion:
        if not conexion.ejecutar(
            "UPDATE ficha SET jornada=%s WHERE id_ficha=%s", datos.nombre, id
        ):
            raise ErrorAPI(404, "NOT_FOUND", "Ficha no encontrada")
        vigente = conexion.fila(
            """SELECT * FROM jornada WHERE id_ficha=%s
            ORDER BY id_jornada DESC LIMIT 1 FOR UPDATE""",
            id,
        )
        if not vigente or (
            vigente["nombre"],
            vigente["hora_inicio"],
            vigente["hora_fin"],
        ) != (datos.nombre, inicio, fin):
            vigente = conexion.fila(
                """INSERT INTO jornada(id_ficha,nombre,hora_inicio,hora_fin)
                VALUES(%s,%s,%s,%s) RETURNING *""",
                id,
                datos.nombre,
                inicio,
                fin,
            )
    return responder(vigente)


@rutas.get("/asistencias/lista")
def lista_de_asistencia(
    db: Base,
    solicitud: Request,
    sesion: InstructorOAdmin,
    id_ficha: Annotated[int | None, Query(ge=1, le=ENTERO_MAXIMO)] = None,
    fecha: Annotated[date | None, Query()] = None,
):
    """Todos los aprendices de la ficha en ese día; sin escaneo quedan como «Sin registro»."""
    parametros = {
        "titular": None if es_admin(sesion.usuario) else sesion.id,
        "ficha": id_ficha,
        "fecha": fecha,
        "zona": solicitud.app.state.configuracion.ZONA_HORARIA,
        "retiro": list(SITUACIONES_RETIRO),
    }
    with db.transaccion() as conexion:
        with conexion.conexion.cursor() as cursor:
            filas = cursor.execute(
                f"""WITH dia AS (SELECT coalesce(%(fecha)s::date,
                    (now() AT TIME ZONE %(zona)s)::date) AS fecha)
                SELECT u.id_usuarios,u.nombres_completos,u.tipo_documento,u.numero_documento,
                f.id_ficha,f.numero_ficha,coalesce(u.ambiente,{AULA_DE_FICHA}) AS ambiente,
                dia.fecha,x.id_asistencia,x.jornada,x.hora_inicio,x.hora_entrada,x.hora_salida,
                CASE WHEN x.id_asistencia IS NULL THEN 'Sin registro'
                    WHEN x.estado ILIKE '%%tard%%' OR x.estado ILIKE '%%retra%%' THEN 'Retraso'
                    ELSE 'Presente' END AS estado_asistencia
                FROM aprendiz_ficha af CROSS JOIN dia
                JOIN usuarios u ON u.id_usuarios=af.id_usuarios
                JOIN ficha f ON f.id_ficha=af.id_ficha
                LEFT JOIN LATERAL (
                    SELECT a.id_asistencia,a.estado,a.hora_entrada,a.hora_salida,
                    j.nombre AS jornada,j.hora_inicio
                    FROM asistencia a JOIN jornada j ON j.id_jornada=a.id_jornada
                    WHERE a.id_usuarios=af.id_usuarios AND a.fecha=dia.fecha AND j.id_ficha=af.id_ficha
                    ORDER BY a.hora_entrada DESC NULLS LAST,a.id_asistencia DESC LIMIT 1) x ON true
                WHERE af.fechasalida IS NULL
                AND lower(af.estado) NOT IN ('inactivo','retirado','finalizado','cancelado','desertado')
                AND lower(coalesce(u.situacion_formativa,'')) <> ALL(%(retiro)s)
                AND (%(ficha)s::integer IS NULL OR f.id_ficha=%(ficha)s)
                AND {FICHAS_VISIBLES}
                ORDER BY f.numero_ficha,u.nombres_completos LIMIT 1000""",
                parametros,
            ).fetchall()
    return responder(filas)


def parametros_exportacion(
    limit: Limite = 25, despues: Cursor = 0, hasta: Cursor = None
):
    return limit, despues, hasta


ParametrosExportacion = Annotated[tuple, Depends(parametros_exportacion)]


def exportar_pagina(db, parametros, sql_maximo, sql_filas, valores, clave):
    limite, despues, hasta = parametros
    if hasta is None:
        hasta = db.fila(sql_maximo, *valores)["hasta"]
    if despues > hasta:
        raise ErrorAPI(422, "INVALID_CURSOR", "Cursor inválido")
    filas = db.filas(sql_filas, *valores, despues, hasta, limite + 1)
    datos = filas[:limite]
    return responder(
        datos,
        meta={
            "hasta": hasta,
            "siguiente": datos[-1][clave] if len(filas) > limite else None,
        },
    )


@reportes.get("/accesos")
def exportar_accesos(
    fecha: Annotated[date, Query()],
    db: Base,
    parametros: ParametrosExportacion,
    sesion: Administrador,
):
    rango = """fechahora >= (%s::date::timestamp AT TIME ZONE 'America/Bogota')
        AND fechahora < ((%s::date + 1)::timestamp AT TIME ZONE 'America/Bogota')"""
    return exportar_pagina(
        db,
        parametros,
        f"SELECT COALESCE(max(id_acceso),0) hasta FROM acceso WHERE {rango}",
        f"""SELECT id_acceso,id_usuarios,tipo,fechahora,metodo,estado FROM acceso WHERE {rango}
        AND id_acceso>%s AND id_acceso<=%s ORDER BY id_acceso LIMIT %s""",
        (fecha, fecha),
        "id_acceso",
    )


@reportes.get("/horarios")
def exportar_horarios(
    db: Base, parametros: ParametrosExportacion, sesion: Administrador
):
    return exportar_pagina(
        db,
        parametros,
        "SELECT COALESCE(max(id_horario),0) hasta FROM horarios",
        """SELECT h.*,f.numero_ficha,p.nombre_programa,u.nombres_completos AS instructor
        FROM horarios h JOIN ficha f USING(id_ficha) JOIN programa p USING(id_programa)
        JOIN usuarios u ON u.id_usuarios=h.id_instructor
        WHERE h.id_horario>%s AND h.id_horario<=%s ORDER BY h.id_horario LIMIT %s""",
        (),
        "id_horario",
    )

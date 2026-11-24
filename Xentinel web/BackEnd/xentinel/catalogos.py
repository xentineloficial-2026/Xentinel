"""Catálogos de lectura, asistencias y reportes administrativos completos."""

from datetime import date, time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from psycopg import sql
from pydantic import Field, field_validator, model_validator

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
from .seguridad import (
    Administrador,
    InstructorOAdmin,
    SesionActual,
    es_admin,
    nombre_rol,
)

rutas = APIRouter(tags=["Catálogos"])
reportes = APIRouter(prefix="/reportes", tags=["Reportes administrativos"])
Cursor = Annotated[int, Query(ge=0, le=ENTERO_MAXIMO)]
# Fichas y horarios tienen rutas propias: cada rol ve solo lo que le corresponde.
CATALOGOS = {
    "roles": ("rol", "id_rol"),
    "jornadas": ("jornada", "id_jornada"),
}
# Fichas en las que la persona es aprendiz activo (misma regla que /usuarios/{id}/fichas).
FICHAS_DE_APRENDIZ = """SELECT id_ficha FROM aprendiz_ficha WHERE id_usuarios=%(id)s
    AND fechasalida IS NULL
    AND lower(estado) NOT IN ('inactivo','retirado','finalizado','cancelado','desertado')"""


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


def alcance(sesion):
    """«todos» para administración, «instructor» para quien dicta clases y «fichas» para
    los demás (aprendices y visitantes con ficha)."""
    if es_admin(sesion.usuario):
        return "todos"
    return "instructor" if nombre_rol(sesion.usuario) == "instructor" else "fichas"


def consultar(db, consulta, parametros):
    with db.transaccion() as conexion, conexion.conexion.cursor() as cursor:
        return cursor.execute(consulta, parametros).fetchall()


@rutas.get("/horarios")
def horarios(db: Base, pagina: Paginacion, sesion: SesionActual):
    """Calendario personal. El instructor ve solo las clases que él dicta, nunca las de
    otros instructores ni el horario general; el aprendiz, las de sus fichas activas."""
    visible = alcance(sesion)
    filas = consultar(
        db,
        f"""SELECT h.*,f.numero_ficha,p.nombre_programa FROM horarios h
        JOIN ficha f ON f.id_ficha=h.id_ficha
        LEFT JOIN programa p ON p.id_programa=f.id_programa
        WHERE %(alcance)s='todos'
        OR (%(alcance)s='instructor' AND h.id_instructor=%(id)s)
        OR (%(alcance)s='fichas' AND h.id_ficha IN ({FICHAS_DE_APRENDIZ}))
        ORDER BY h.id_horario LIMIT %(limit)s OFFSET %(offset)s""",
        {"alcance": visible, "id": sesion.id, **pagina},
    )
    return responder(filas, meta={**pagina, "alcance": visible})


@rutas.get("/fichas")
def fichas(db: Base, pagina: Paginacion, sesion: SesionActual):
    """Administración ve todas las fichas; el instructor, las que tiene asignadas o en las
    que dicta clase; el aprendiz, las suyas."""
    visible = alcance(sesion)
    filas = consultar(
        db,
        f"""SELECT f.* FROM ficha f
        WHERE %(alcance)s='todos'
        OR (%(alcance)s='instructor' AND (f.id_ficha IN (SELECT id_ficha FROM instructor_ficha
            WHERE id_usuarios=%(id)s AND lower(estado)='activo')
            OR f.id_ficha IN (SELECT id_ficha FROM horarios WHERE id_instructor=%(id)s)))
        OR (%(alcance)s='fichas' AND f.id_ficha IN ({FICHAS_DE_APRENDIZ}))
        ORDER BY f.id_ficha LIMIT %(limit)s OFFSET %(offset)s""",
        {"alcance": visible, "id": sesion.id, **pagina},
    )
    return responder(filas, meta={**pagina, "alcance": visible})


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


# Presente, Retardo, Ausente o Sin registro, también para filas antiguas sin migrar
# («Retrasado», «Tarde»). Sin registro: día sin escaneo que nadie calificó todavía.
ESTADOS_ASISTENCIA = ("Presente", "Retardo", "Ausente", "Sin registro")
ESTADO_ASISTENCIA = """CASE WHEN x.id_asistencia IS NULL OR x.estado='Sin registro' THEN 'Sin registro'
    WHEN x.estado ILIKE 'ausen%%' THEN 'Ausente'
    WHEN x.estado ILIKE '%%tard%%' OR x.estado ILIKE '%%retra%%' THEN 'Retardo'
    ELSE 'Presente' END"""
APRENDICES_ACTIVOS = """af.fechasalida IS NULL
    AND lower(af.estado) NOT IN ('inactivo','retirado','finalizado','cancelado','desertado')
    AND lower(coalesce(u.situacion_formativa,'')) <> ALL(%(retiro)s)"""
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
                {ESTADO_ASISTENCIA} AS estado_asistencia,
                x.modificado_en,x.modificado_por_nombre
                FROM aprendiz_ficha af CROSS JOIN dia
                JOIN usuarios u ON u.id_usuarios=af.id_usuarios
                JOIN ficha f ON f.id_ficha=af.id_ficha
                LEFT JOIN LATERAL (
                    SELECT a.id_asistencia,a.estado,a.hora_entrada,a.hora_salida,
                    j.nombre AS jornada,j.hora_inicio,a.modificado_en,
                    m.nombres_completos AS modificado_por_nombre
                    FROM asistencia a JOIN jornada j ON j.id_jornada=a.id_jornada
                    LEFT JOIN usuarios m ON m.id_usuarios=a.modificado_por
                    WHERE a.id_usuarios=af.id_usuarios AND a.fecha=dia.fecha AND j.id_ficha=af.id_ficha
                    ORDER BY a.hora_entrada DESC NULLS LAST,a.id_asistencia DESC LIMIT 1) x ON true
                WHERE {APRENDICES_ACTIVOS}
                AND (%(ficha)s::integer IS NULL OR f.id_ficha=%(ficha)s)
                AND {FICHAS_VISIBLES}
                ORDER BY f.numero_ficha,u.nombres_completos LIMIT 1000""",
                parametros,
            ).fetchall()
    return responder(filas)


@rutas.get("/asistencias/periodo")
def asistencia_por_periodo(
    db: Base,
    solicitud: Request,
    sesion: InstructorOAdmin,
    id_ficha: Annotated[int, Query(ge=1, le=ENTERO_MAXIMO)],
    desde: Annotated[date, Query()],
    hasta: Annotated[date, Query()],
    id_usuarios: Annotated[int | None, Query(ge=1, le=ENTERO_MAXIMO)] = None,
):
    """Frecuencia de llegadas por aprendiz en una semana o un mes.

    Cuenta los días de clase según el horario de la ficha, más cualquier día con
    registros. Un día de clase sin registro cuenta como «Sin registro»."""
    if hasta < desde or (hasta - desde).days > 62:
        raise ErrorAPI(422, "INVALID_RANGE", "El periodo debe ser de máximo dos meses")
    parametros = {
        "titular": None if es_admin(sesion.usuario) else sesion.id,
        "ficha": id_ficha,
        "desde": desde,
        "hasta": hasta,
        "aprendiz": id_usuarios,
        "zona": solicitud.app.state.configuracion.ZONA_HORARIA,
        "retiro": list(SITUACIONES_RETIRO),
    }
    with db.transaccion() as conexion:
        with conexion.conexion.cursor() as cursor:
            if not cursor.execute(
                f"SELECT 1 FROM ficha f WHERE f.id_ficha=%(ficha)s AND {FICHAS_VISIBLES}",
                parametros,
            ).fetchone():
                raise ErrorAPI(403, "FORBIDDEN", "No tiene asignada esta ficha")
            detalle = cursor.execute(
                f"""WITH dias AS (
                    SELECT d::date AS fecha FROM generate_series(%(desde)s::date,
                    least(%(hasta)s::date,(now() AT TIME ZONE %(zona)s)::date),'1 day') d),
                clases AS (
                    SELECT dias.fecha FROM dias WHERE EXISTS (SELECT 1 FROM horarios h
                        WHERE h.id_ficha=%(ficha)s AND translate(lower(h.dia_semana),'áéíóú','aeiou')
                        =(ARRAY['lunes','martes','miercoles','jueves','viernes','sabado','domingo'])
                        [extract(isodow FROM dias.fecha)::int])
                    UNION SELECT a.fecha FROM asistencia a JOIN jornada j USING(id_jornada)
                        WHERE j.id_ficha=%(ficha)s AND a.fecha BETWEEN %(desde)s AND %(hasta)s)
                SELECT u.id_usuarios,u.nombres_completos,u.tipo_documento,u.numero_documento,
                c.fecha,x.hora_entrada,x.hora_salida,{ESTADO_ASISTENCIA} AS estado_asistencia,
                x.modificado_en,x.modificado_por_nombre
                FROM aprendiz_ficha af JOIN usuarios u ON u.id_usuarios=af.id_usuarios
                CROSS JOIN clases c
                LEFT JOIN LATERAL (SELECT a.id_asistencia,a.estado,a.hora_entrada,a.hora_salida,
                    a.modificado_en,m.nombres_completos AS modificado_por_nombre
                    FROM asistencia a JOIN jornada j ON j.id_jornada=a.id_jornada
                    LEFT JOIN usuarios m ON m.id_usuarios=a.modificado_por
                    WHERE a.id_usuarios=af.id_usuarios AND a.fecha=c.fecha AND j.id_ficha=af.id_ficha
                    ORDER BY a.hora_entrada DESC NULLS LAST,a.id_asistencia DESC LIMIT 1) x ON true
                WHERE af.id_ficha=%(ficha)s AND {APRENDICES_ACTIVOS}
                AND (%(aprendiz)s::integer IS NULL OR u.id_usuarios=%(aprendiz)s)
                ORDER BY u.nombres_completos,c.fecha LIMIT 5000""",
                parametros,
            ).fetchall()
    resumen = {}
    for fila in detalle:
        persona = resumen.setdefault(
            fila["id_usuarios"],
            {
                "id_usuarios": fila["id_usuarios"],
                "nombres_completos": fila["nombres_completos"],
                "tipo_documento": fila["tipo_documento"],
                "numero_documento": fila["numero_documento"],
                "dias": 0,
                "presentes": 0,
                "retardos": 0,
                "ausentes": 0,
                "sin_registro": 0,
            },
        )
        persona["dias"] += 1
        clave = {
            "Presente": "presentes",
            "Retardo": "retardos",
            "Ausente": "ausentes",
            "Sin registro": "sin_registro",
        }[fila["estado_asistencia"]]
        persona[clave] += 1
    for persona in resumen.values():
        asistio = persona["presentes"] + persona["retardos"]
        persona["asistencia"] = (
            round(asistio * 100 / persona["dias"]) if persona["dias"] else 0
        )
        persona["puntualidad"] = (
            round(persona["presentes"] * 100 / asistio) if asistio else 0
        )
    return responder(
        {
            "resumen": list(resumen.values()),
            "detalle": detalle if id_usuarios else [],
        }
    )


class CambioEstado(Entrada):
    id_usuarios: Annotated[int, Field(ge=1, le=ENTERO_MAXIMO)]
    id_ficha: Annotated[int, Field(ge=1, le=ENTERO_MAXIMO)]
    fecha: date
    estado: Literal["Presente", "Retardo", "Ausente", "Sin registro"]

    @field_validator("estado", mode="before")
    @classmethod
    def nombre_anterior(cls, estado):
        # Una pestaña abierta antes de la actualización todavía envía «Retrasado».
        return "Retardo" if estado == "Retrasado" else estado


@rutas.put("/asistencias/estado")
def cambiar_estado_asistencia(
    datos: CambioEstado, db: Base, solicitud: Request, sesion: InstructorOAdmin
):
    """El instructor corrige solo a los aprendices de sus fichas; queda registrado quién lo hizo."""
    parametros = {
        "titular": None if es_admin(sesion.usuario) else sesion.id,
        "ficha": datos.id_ficha,
        "aprendiz": datos.id_usuarios,
        "fecha": datos.fecha,
        "estado": datos.estado,
        "editor": sesion.id,
        "zona": solicitud.app.state.configuracion.ZONA_HORARIA,
        "retiro": list(SITUACIONES_RETIRO),
    }
    with db.transaccion() as conexion:
        with conexion.conexion.cursor() as cursor:
            if cursor.execute(
                "SELECT %(fecha)s::date>(now() AT TIME ZONE %(zona)s)::date AS futura",
                parametros,
            ).fetchone()["futura"]:
                raise ErrorAPI(422, "FUTURE_DATE", "No se puede calificar un día futuro")
            if not cursor.execute(
                f"""SELECT 1 FROM aprendiz_ficha af JOIN usuarios u USING(id_usuarios)
                JOIN ficha f ON f.id_ficha=af.id_ficha
                WHERE af.id_ficha=%(ficha)s AND af.id_usuarios=%(aprendiz)s
                AND {APRENDICES_ACTIVOS} AND {FICHAS_VISIBLES}""",
                parametros,
            ).fetchone():
                raise ErrorAPI(403, "FORBIDDEN", "Este aprendiz no está en sus fichas")
            actualizado = cursor.execute(
                """UPDATE asistencia SET estado=%(estado)s,modificado_por=%(editor)s,
                modificado_en=now() WHERE id_asistencia=(SELECT a.id_asistencia
                    FROM asistencia a JOIN jornada j ON j.id_jornada=a.id_jornada
                    WHERE a.id_usuarios=%(aprendiz)s AND a.fecha=%(fecha)s AND j.id_ficha=%(ficha)s
                    ORDER BY a.hora_entrada DESC NULLS LAST,a.id_asistencia DESC LIMIT 1)
                RETURNING id_asistencia""",
                parametros,
            ).fetchone()
            if not actualizado and not cursor.execute(
                """INSERT INTO asistencia(id_usuarios,id_jornada,fecha,estado,
                modificado_por,modificado_en)
                SELECT %(aprendiz)s,j.id_jornada,%(fecha)s,%(estado)s,%(editor)s,now()
                FROM jornada j WHERE j.id_ficha=%(ficha)s
                ORDER BY j.id_jornada DESC LIMIT 1 RETURNING id_asistencia""",
                parametros,
            ).fetchone():
                raise ErrorAPI(409, "NO_SCHEDULE", "La ficha no tiene jornada definida")
    return responder(datos.model_dump(mode="json"))


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

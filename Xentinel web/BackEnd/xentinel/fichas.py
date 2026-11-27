"""Gestión de fichas: datos, jornada, horario y aprendices vinculados."""

from datetime import date, time
from typing import Annotated, Literal

from fastapi import APIRouter, Request, Response
from pydantic import Field, model_validator

from .http import Base, Entrada, ErrorAPI, Id, IdRuta, responder, texto
from .programas import Ficha as FichaConHorarios
from .programas import Hora, Horario, guardar_fichas
from .seguridad import Administrador, nombre_rol

rutas = APIRouter(prefix="/fichas", tags=["Fichas"])
NombreJornada = Literal["Mañana", "Tarde", "Noche", "Mixta"]
# Ficha activa del aprendiz: sin fecha de salida. El estado conserva el motivo del cierre.
ACTIVA = "af.fechasalida IS NULL"
HOY = "(now() AT TIME ZONE %(zona)s)::date"


class DatosFicha(Entrada):
    numero_ficha: Annotated[
        str, Field(min_length=1, max_length=15, pattern=r"^[A-Za-z0-9-]+$")
    ]
    nombre_ficha: texto(0, 150) | None = None
    id_programa: Id
    jornada: NombreJornada | None = None
    hora_inicio: Hora | None = None
    hora_fin: Hora | None = None
    modalidad: Literal["Presencial", "Virtual", "Mixta"] | None = None
    fecha_inicio: date | None = None
    fecha_fin: date | None = None

    @model_validator(mode="after")
    def validar(self):
        horas = (self.jornada, self.hora_inicio, self.hora_fin)
        if any(horas) and not all(horas):
            raise ValueError("La jornada requiere nombre, hora de inicio y hora de fin")
        if all(horas) and time.fromisoformat(self.hora_fin) <= time.fromisoformat(
            self.hora_inicio
        ):
            raise ValueError("La hora de fin debe ser posterior a la de inicio")
        if self.fecha_inicio and self.fecha_fin and self.fecha_fin < self.fecha_inicio:
            raise ValueError("La fecha de fin debe ser posterior a la de inicio")
        return self


class Asignacion(Entrada):
    ids: Annotated[list[Id], Field(min_length=1, max_length=500)]


class HorariosFicha(Entrada):
    horarios: Annotated[list[Horario], Field(max_length=150)]


def ausente():
    return ErrorAPI(404, "NOT_FOUND", "Ficha no encontrada")


def guardar_jornada(conexion, id_ficha, nombre, hora_inicio, hora_fin):
    """La jornada más reciente es la vigente. Las anteriores se conservan: la asistencia
    ya registrada sigue apuntando al horario con el que se calificó."""
    inicio, fin = time.fromisoformat(hora_inicio), time.fromisoformat(hora_fin)
    vigente = conexion.fila(
        "SELECT * FROM jornada WHERE id_ficha=%s ORDER BY id_jornada DESC LIMIT 1 FOR UPDATE",
        id_ficha,
    )
    if vigente and (
        vigente["nombre"],
        vigente["hora_inicio"],
        vigente["hora_fin"],
    ) == (nombre, inicio, fin):
        return vigente
    return conexion.fila(
        """INSERT INTO jornada(id_ficha,nombre,hora_inicio,hora_fin)
        VALUES(%s,%s,%s,%s) RETURNING *""",
        id_ficha,
        nombre,
        inicio,
        fin,
    )


def detalle_ficha(conexion, identificador):
    ficha = conexion.fila(
        f"""SELECT f.*,p.nombre_programa,p.nivel_programa,p.activo AS programa_activo,
        v.hora_inicio,v.hora_fin,
        (SELECT count(*) FROM aprendiz_ficha af WHERE af.id_ficha=f.id_ficha AND {ACTIVA})::int
            AS total_aprendices,
        EXISTS (SELECT 1 FROM asistencia a JOIN jornada j USING(id_jornada)
            WHERE j.id_ficha=f.id_ficha) AS tiene_asistencia,
        COALESCE((SELECT jsonb_agg(to_jsonb(h) || jsonb_build_object('instructor',
            u.nombres_completos) ORDER BY h.dia_semana,h.hora_inicio,h.id_horario)
            FROM horarios h JOIN usuarios u ON u.id_usuarios=h.id_instructor
            WHERE h.id_ficha=f.id_ficha), '[]'::jsonb) AS horarios,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id_usuarios',u.id_usuarios,'nombres_completos',u.nombres_completos,
            'tipo_documento',u.tipo_documento,'numero_documento',u.numero_documento,
            'correo',u.correo,'estado',u.estado,'situacion_formativa',u.situacion_formativa,
            'estado_ficha',af.estado,'fechaingreso',af.fechaingreso,
            'requiere_activacion',u.requiere_restablecimiento)
            ORDER BY u.nombres_completos,u.id_usuarios)
            FROM aprendiz_ficha af JOIN usuarios u USING(id_usuarios)
            WHERE af.id_ficha=f.id_ficha AND {ACTIVA}), '[]'::jsonb) AS aprendices
        FROM ficha f JOIN programa p USING(id_programa)
        LEFT JOIN LATERAL (SELECT j.hora_inicio,j.hora_fin FROM jornada j
            WHERE j.id_ficha=f.id_ficha ORDER BY j.id_jornada DESC LIMIT 1) v ON true
        WHERE f.id_ficha=%s""",
        identificador,
    )
    if not ficha:
        raise ausente()
    return ficha


def comprobar_programa(conexion, identificador):
    programa = conexion.fila(
        "SELECT activo FROM programa WHERE id_programa=%s FOR SHARE", identificador
    )
    if not programa:
        raise ErrorAPI(404, "NOT_FOUND", "Programa no encontrado")
    if not programa["activo"]:
        raise ErrorAPI(
            409, "PROGRAM_INACTIVE", "El programa está desactivado; reactívalo primero"
        )


def numero_libre(conexion, numero, excepto=None):
    if conexion.fila(
        "SELECT 1 FROM ficha WHERE lower(numero_ficha)=lower(%s) AND id_ficha<>%s",
        numero,
        excepto or 0,
    ):
        raise ErrorAPI(409, "DUPLICATE_FICHA", f"Ya existe la ficha {numero}")


def vincular(conexion, id_ficha, ids, zona):
    """Vincula aprendices a la ficha. Quien estaba en otra ficha activa se traslada: la
    anterior queda cerrada con fecha de salida y el historial se conserva."""
    personas = {
        fila["id_usuarios"]: fila
        for fila in conexion.filas(
            """SELECT u.id_usuarios,u.nombres_completos,r.nombre_rol FROM usuarios u
            JOIN rol r USING(id_rol) WHERE u.id_usuarios=ANY(%s) FOR UPDATE OF u""",
            list(ids),
        )
    }
    resultado = {"asignados": [], "trasladados": [], "ya_estaban": [], "rechazados": []}
    for identificador in dict.fromkeys(ids):
        persona = personas.get(identificador)
        if not persona:
            resultado["rechazados"].append(
                {"id_usuarios": identificador, "motivo": "La persona no existe"}
            )
            continue
        if nombre_rol(persona) != "aprendiz":
            resultado["rechazados"].append(
                {
                    "id_usuarios": identificador,
                    "nombre": persona["nombres_completos"],
                    "motivo": "Solo los aprendices se vinculan a una ficha",
                }
            )
            continue
        valores = {"ficha": id_ficha, "persona": identificador, "zona": zona}
        with conexion.conexion.cursor() as cursor:
            trasladado = cursor.execute(
                f"""UPDATE aprendiz_ficha af SET fechasalida={HOY},estado='Trasladado'
                WHERE af.id_usuarios=%(persona)s AND {ACTIVA} AND af.id_ficha<>%(ficha)s""",
                valores,
            ).rowcount
            fila = cursor.execute(
                f"""INSERT INTO aprendiz_ficha(id_usuarios,id_ficha,estado,fechaingreso)
                VALUES(%(persona)s,%(ficha)s,'En formación',{HOY})
                ON CONFLICT (id_usuarios,id_ficha) DO UPDATE SET
                estado=CASE WHEN aprendiz_ficha.fechasalida IS NULL THEN aprendiz_ficha.estado
                    ELSE EXCLUDED.estado END,
                fechaingreso=CASE WHEN aprendiz_ficha.fechasalida IS NULL
                    THEN aprendiz_ficha.fechaingreso ELSE EXCLUDED.fechaingreso END,
                fechasalida=NULL
                RETURNING (xmax=0) AS nueva,
                (SELECT af.fechasalida IS NULL FROM aprendiz_ficha af
                    WHERE af.id_aprendiz_ficha=aprendiz_ficha.id_aprendiz_ficha) AS activa""",
                valores,
            ).fetchone()
            cursor.execute(
                """UPDATE usuarios SET situacion_formativa='En formación'
                WHERE id_usuarios=%(persona)s AND situacion_formativa IS NULL""",
                valores,
            )
        resumen = {"id_usuarios": identificador, "nombre": persona["nombres_completos"]}
        if trasladado:
            resultado["trasladados"].append(resumen)
        elif not fila["nueva"] and fila["activa"]:
            resultado["ya_estaban"].append(resumen)
        else:
            resultado["asignados"].append(resumen)
    return resultado


@rutas.post("", status_code=201)
def crear(datos: DatosFicha, db: Base, sesion: Administrador):
    with db.transaccion() as conexion:
        comprobar_programa(conexion, datos.id_programa)
        numero_libre(conexion, datos.numero_ficha)
        creada = conexion.fila(
            """INSERT INTO ficha(numero_ficha,nombre_ficha,id_programa,jornada,modalidad,
            fecha_inicio,fecha_fin) VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id_ficha""",
            datos.numero_ficha,
            datos.nombre_ficha or None,
            datos.id_programa,
            datos.jornada,
            datos.modalidad,
            datos.fecha_inicio,
            datos.fecha_fin,
        )
        if datos.jornada:
            guardar_jornada(
                conexion,
                creada["id_ficha"],
                datos.jornada,
                datos.hora_inicio,
                datos.hora_fin,
            )
        resultado = detalle_ficha(conexion, creada["id_ficha"])
    return responder(resultado, 201)


@rutas.get("/{id}")
def detalle(id: IdRuta, db: Base, sesion: Administrador):
    with db.transaccion() as conexion:
        return responder(detalle_ficha(conexion, id))


@rutas.patch("/{id}")
def actualizar(id: IdRuta, datos: DatosFicha, db: Base, sesion: Administrador):
    with db.transaccion() as conexion:
        anterior = conexion.fila(
            "SELECT id_programa FROM ficha WHERE id_ficha=%s FOR UPDATE", id
        )
        if not anterior:
            raise ausente()
        if anterior["id_programa"] != datos.id_programa:
            comprobar_programa(conexion, datos.id_programa)
        numero_libre(conexion, datos.numero_ficha, id)
        conexion.ejecutar(
            """UPDATE ficha SET numero_ficha=%s,nombre_ficha=%s,id_programa=%s,jornada=%s,
            modalidad=%s,fecha_inicio=%s,fecha_fin=%s WHERE id_ficha=%s""",
            datos.numero_ficha,
            datos.nombre_ficha or None,
            datos.id_programa,
            datos.jornada,
            datos.modalidad,
            datos.fecha_inicio,
            datos.fecha_fin,
            id,
        )
        if datos.jornada:
            guardar_jornada(
                conexion, id, datos.jornada, datos.hora_inicio, datos.hora_fin
            )
        resultado = detalle_ficha(conexion, id)
    return responder(resultado)


@rutas.delete("/{id}", status_code=204)
def eliminar(id: IdRuta, db: Base, sesion: Administrador):
    """Solo se elimina una ficha sin asistencia ni pases de lista: el historial manda."""
    with db.transaccion() as conexion:
        if not conexion.fila("SELECT 1 FROM ficha WHERE id_ficha=%s FOR UPDATE", id):
            raise ausente()
        if conexion.fila(
            """SELECT 1 FROM asistencia a JOIN jornada j USING(id_jornada) WHERE j.id_ficha=%s
            UNION ALL SELECT 1 FROM reportes_pase_lista WHERE id_ficha=%s LIMIT 1""",
            id,
            id,
        ):
            raise ErrorAPI(
                409,
                "FICHA_WITH_HISTORY",
                "La ficha tiene asistencia o pases de lista registrados. "
                "Desvincula a sus aprendices en lugar de eliminarla.",
            )
        for consulta in (
            """UPDATE solicitudes_horario SET id_horario=NULL
            WHERE id_horario IN (SELECT id_horario FROM horarios WHERE id_ficha=%s)""",
            "DELETE FROM solicitudes_horario WHERE id_ficha=%s",
            "DELETE FROM horario_archivo WHERE id_ficha=%s",
            "DELETE FROM horarios WHERE id_ficha=%s",
            "DELETE FROM estado_aprendiz WHERE id_ficha=%s",
            "DELETE FROM aprendiz_ficha WHERE id_ficha=%s",
            "DELETE FROM instructor_ficha WHERE id_ficha=%s",
            "DELETE FROM jornada WHERE id_ficha=%s",
            "DELETE FROM ficha WHERE id_ficha=%s",
        ):
            conexion.ejecutar(consulta, id)
    return Response(status_code=204)


@rutas.post("/{id}/aprendices")
def asignar(
    id: IdRuta, datos: Asignacion, db: Base, solicitud: Request, sesion: Administrador
):
    with db.transaccion() as conexion:
        if not conexion.fila("SELECT 1 FROM ficha WHERE id_ficha=%s FOR SHARE", id):
            raise ausente()
        resultado = vincular(
            conexion, id, datos.ids, solicitud.app.state.configuracion.ZONA_HORARIA
        )
        resultado["ficha"] = detalle_ficha(conexion, id)
    return responder(resultado)


@rutas.delete("/{id}/aprendices/{id_usuarios}", status_code=204)
def desvincular(
    id: IdRuta,
    id_usuarios: IdRuta,
    db: Base,
    solicitud: Request,
    sesion: Administrador,
):
    """El aprendiz sale de la lista de la ficha; su asistencia anterior se conserva."""
    with db.transaccion() as conexion, conexion.conexion.cursor() as cursor:
        if not cursor.execute(
            f"""UPDATE aprendiz_ficha af SET fechasalida={HOY},estado='Desvinculado'
            WHERE af.id_ficha=%(ficha)s AND af.id_usuarios=%(persona)s AND {ACTIVA}""",
            {
                "ficha": id,
                "persona": id_usuarios,
                "zona": solicitud.app.state.configuracion.ZONA_HORARIA,
            },
        ).rowcount:
            raise ErrorAPI(404, "NOT_FOUND", "El aprendiz no está en esta ficha")
    return Response(status_code=204)


@rutas.put("/{id}/horarios")
def guardar_horarios(id: IdRuta, datos: HorariosFicha, db: Base, sesion: Administrador):
    """Reemplaza el horario de la ficha: conserva, edita, agrega y quita clases."""
    with db.transaccion() as conexion:
        ficha = conexion.fila(
            "SELECT id_programa,numero_ficha FROM ficha WHERE id_ficha=%s FOR UPDATE",
            id,
        )
        if not ficha:
            raise ausente()
        conservados = [h.id_horario for h in datos.horarios if h.id_horario]
        quitados = [
            fila["id_horario"]
            for fila in conexion.filas(
                """SELECT id_horario FROM horarios WHERE id_ficha=%s
                AND NOT (id_horario=ANY(%s))""",
                id,
                conservados,
            )
        ]
        if quitados:
            conexion.ejecutar(
                "UPDATE solicitudes_horario SET id_horario=NULL WHERE id_horario=ANY(%s)",
                quitados,
            )
            conexion.ejecutar("DELETE FROM horarios WHERE id_horario=ANY(%s)", quitados)
        guardar_fichas(
            conexion,
            ficha["id_programa"],
            [
                FichaConHorarios(
                    id_ficha=id,
                    numero_ficha=ficha["numero_ficha"],
                    horarios=datos.horarios,
                )
            ],
        )
        resultado = detalle_ficha(conexion, id)
    return responder(resultado)

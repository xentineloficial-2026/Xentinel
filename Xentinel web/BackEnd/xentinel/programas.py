"""Catálogo académico con edición atómica de programas, fichas y horarios."""

from datetime import time
from typing import Annotated, Literal

from fastapi import APIRouter, Response
from pydantic import Field, StrictBool, StringConstraints, model_validator

from .http import Base, Entrada, ErrorAPI, Id, IdRuta, Paginacion, responder, texto
from .seguridad import Administrador, SesionActual, activo, es_admin, nombre_rol

rutas = APIRouter(prefix="/programas", tags=["Programas"])
Hora = Annotated[
    str, StringConstraints(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$")
]
Dia = Literal["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


class Horario(Entrada):
    id_horario: Id = None
    nombre_clase: texto(1, 150)
    dia_semana: Dia
    hora_inicio: Hora
    hora_fin: Hora
    ambiente: texto(1, 50) | None
    id_instructor: Id

    @model_validator(mode="after")
    def validar_horas(self):
        if time.fromisoformat(self.hora_fin) <= time.fromisoformat(self.hora_inicio):
            raise ValueError("La hora de fin debe ser posterior a la de inicio")
        return self


class Ficha(Entrada):
    id_ficha: Id = None
    numero_ficha: texto(1, 15)
    horarios: Annotated[list[Horario], Field(max_length=150)]


class Programa(Entrada):
    nombre_programa: texto(1, 150)
    nivel_programa: texto(1, 50) | None = None
    # Las fichas también se gestionan por separado (/fichas): un programa puede crearse vacío.
    fichas: Annotated[list[Ficha], Field(default_factory=list, max_length=100)]


class NuevoPrograma(Programa):
    @model_validator(mode="after")
    def validar_fichas_nuevas(self):
        if any(
            ficha.id_ficha
            or not ficha.horarios
            or any(
                horario.id_horario or not horario.ambiente for horario in ficha.horarios
            )
            for ficha in self.fichas
        ):
            raise ValueError("Cada ficha nueva requiere un horario con entorno")
        return self


class EstadoPrograma(Entrada):
    activo: StrictBool


def ausente():
    return ErrorAPI(404, "NOT_FOUND", "Programa no encontrado")


def relacion_invalida():
    return ErrorAPI(
        409, "REFERENCE_CONFLICT", "La ficha o el horario no pertenece al programa"
    )


def detalle_programa(db, identificador):
    programa = db.fila(
        """SELECT p.*, COALESCE((
        SELECT jsonb_agg(to_jsonb(f) || jsonb_build_object(
        'total_aprendices', (SELECT count(*) FROM aprendiz_ficha af
            WHERE af.id_ficha=f.id_ficha AND af.fechasalida IS NULL),
        'hora_inicio', (SELECT j.hora_inicio FROM jornada j WHERE j.id_ficha=f.id_ficha
            ORDER BY j.id_jornada DESC LIMIT 1),
        'hora_fin', (SELECT j.hora_fin FROM jornada j WHERE j.id_ficha=f.id_ficha
            ORDER BY j.id_jornada DESC LIMIT 1),
        'horarios', COALESCE((
            SELECT jsonb_agg(to_jsonb(h) || jsonb_build_object('instructor', u.nombres_completos)
                ORDER BY h.id_horario) FROM horarios h JOIN usuarios u ON u.id_usuarios=h.id_instructor
            WHERE h.id_ficha=f.id_ficha
        ), '[]'::jsonb)) ORDER BY f.id_ficha) FROM ficha f WHERE f.id_programa=p.id_programa
        ), '[]'::jsonb) AS fichas FROM programa p WHERE p.id_programa=%s""",
        identificador,
    )
    if not programa:
        raise ausente()
    return programa


def comprobar_instructor(db, identificador, revisados):
    if identificador in revisados:
        return
    persona = db.fila(
        """SELECT u.estado,r.nombre_rol FROM usuarios u JOIN rol r USING(id_rol)
        WHERE u.id_usuarios=%s FOR SHARE OF u""",
        identificador,
    )
    if not activo(persona) or nombre_rol(persona) != "instructor":
        raise ErrorAPI(
            422, "INVALID_INSTRUCTOR", "El horario requiere un instructor activo"
        )
    revisados.add(identificador)


def guardar_fichas(db, identificador, fichas):
    fichas_vistas, horarios_vistos, instructores = set(), set(), set()
    for ficha in fichas:
        id_ficha = ficha.id_ficha
        if id_ficha:
            if id_ficha in fichas_vistas or not db.ejecutar(
                """UPDATE ficha SET numero_ficha=%s
                WHERE id_ficha=%s AND id_programa=%s""",
                ficha.numero_ficha,
                id_ficha,
                identificador,
            ):
                raise relacion_invalida()
            fichas_vistas.add(id_ficha)
        else:
            if not ficha.horarios:
                raise ErrorAPI(
                    422, "INVALID_DATA", "La ficha nueva requiere un horario"
                )
            id_ficha = db.fila(
                "INSERT INTO ficha(numero_ficha,id_programa) VALUES(%s,%s) RETURNING id_ficha",
                ficha.numero_ficha,
                identificador,
            )["id_ficha"]
        for horario in ficha.horarios:
            valores = (
                horario.nombre_clase,
                horario.dia_semana,
                time.fromisoformat(horario.hora_inicio),
                time.fromisoformat(horario.hora_fin),
                horario.ambiente,
                horario.id_instructor,
                id_ficha,
            )
            if horario.id_horario:
                anterior = db.fila(
                    """SELECT id_instructor FROM horarios WHERE id_horario=%s
                    AND id_ficha=%s FOR UPDATE""",
                    horario.id_horario,
                    id_ficha,
                )
                if horario.id_horario in horarios_vistos or not anterior:
                    raise relacion_invalida()
                horarios_vistos.add(horario.id_horario)
                if anterior["id_instructor"] != horario.id_instructor:
                    comprobar_instructor(db, horario.id_instructor, instructores)
                db.ejecutar(
                    """UPDATE horarios SET nombre_clase=%s,dia_semana=%s,hora_inicio=%s,hora_fin=%s,
                    ambiente=%s,id_instructor=%s WHERE id_ficha=%s AND id_horario=%s""",
                    *valores,
                    horario.id_horario,
                )
            else:
                if not horario.ambiente:
                    raise ErrorAPI(
                        422, "INVALID_DATA", "El horario nuevo requiere un entorno"
                    )
                comprobar_instructor(db, horario.id_instructor, instructores)
                db.ejecutar(
                    """INSERT INTO horarios(nombre_clase,dia_semana,hora_inicio,hora_fin,ambiente,
                    id_instructor,id_ficha) VALUES(%s,%s,%s,%s,%s,%s,%s)""",
                    *valores,
                )


@rutas.get("")
def listar(
    db: Base,
    pagina: Paginacion,
    sesion: SesionActual,
    activo: Literal["true", "false"] | None = None,
):
    filtro = None if activo is None else activo == "true"
    visible = filtro if es_admin(sesion.usuario) else True
    return responder(
        db.filas(
            """SELECT p.*,
        (SELECT count(*) FROM ficha f WHERE f.id_programa=p.id_programa)::int AS total_fichas,
        (SELECT count(*) FROM aprendiz_ficha af JOIN ficha f USING(id_ficha)
            WHERE f.id_programa=p.id_programa AND af.fechasalida IS NULL)::int AS total_aprendices
        FROM programa p WHERE (%s::boolean IS NULL OR p.activo=%s)
        ORDER BY p.id_programa DESC LIMIT %s OFFSET %s""",
            visible,
            visible,
            pagina["limit"],
            pagina["offset"],
        ),
        meta={**pagina, "activo": filtro},
    )


@rutas.get("/instructores")
def instructores(db: Base, sesion: Administrador):
    return responder(
        db.filas("""SELECT u.id_usuarios,u.nombres_completos FROM usuarios u JOIN rol r USING(id_rol)
        WHERE lower(u.estado)='activo' AND lower(r.nombre_rol)='instructor'
        ORDER BY u.nombres_completos,u.id_usuarios""")
    )


@rutas.get("/{id}")
def detalle(id: IdRuta, db: Base, sesion: Administrador):
    return responder(detalle_programa(db, id))


@rutas.post("", status_code=201)
def crear(datos: NuevoPrograma, db: Base, sesion: Administrador):
    with db.transaccion() as conexion:
        creado = conexion.fila(
            """INSERT INTO programa(nombre_programa,nivel_programa)
            VALUES(%s,%s) RETURNING id_programa""",
            datos.nombre_programa,
            datos.nivel_programa,
        )
        identificador = creado["id_programa"]
        guardar_fichas(conexion, identificador, datos.fichas)
        resultado = detalle_programa(conexion, identificador)
    return responder(resultado, 201)


@rutas.patch("/{id}")
def actualizar(
    id: IdRuta, datos: Programa | EstadoPrograma, db: Base, sesion: Administrador
):
    if isinstance(datos, EstadoPrograma):
        resultado = db.fila(
            "UPDATE programa SET activo=%s WHERE id_programa=%s RETURNING *",
            datos.activo,
            id,
        )
        if not resultado:
            raise ausente()
        return responder(resultado)
    with db.transaccion() as conexion:
        if not conexion.ejecutar(
            "UPDATE programa SET nombre_programa=%s,nivel_programa=%s WHERE id_programa=%s",
            datos.nombre_programa,
            datos.nivel_programa,
            id,
        ):
            raise ausente()
        guardar_fichas(conexion, id, datos.fichas)
        resultado = detalle_programa(conexion, id)
    return responder(resultado)


@rutas.delete("/{id}", status_code=204)
def eliminar(id: IdRuta, db: Base, sesion: Administrador):
    """Solo se elimina un programa sin fichas; con fichas se desactiva."""
    with db.transaccion() as conexion:
        if not conexion.fila(
            "SELECT 1 FROM programa WHERE id_programa=%s FOR UPDATE", id
        ):
            raise ausente()
        if conexion.fila("SELECT 1 FROM ficha WHERE id_programa=%s LIMIT 1", id):
            raise ErrorAPI(
                409,
                "PROGRAM_WITH_FICHAS",
                "El programa tiene fichas. Elimínalas o desactiva el programa.",
            )
        conexion.ejecutar("DELETE FROM programa WHERE id_programa=%s", id)
    return Response(status_code=204)

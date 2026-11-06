"""Directorio administrativo y operaciones autorizadas sobre perfiles y fichas."""

from typing import Literal

from fastapi import APIRouter, Response
from psycopg import sql

from .autenticacion import (
    Correo,
    Documento,
    FechaNacimiento,
    Registro,
    TipoDocumento,
    insertar_usuario,
    invalidar_tokens,
)
from .http import Base, Entrada, ErrorAPI, Id, IdRuta, Paginacion, responder, texto
from .seguridad import (
    COLUMNAS_PERSONA,
    Administrador,
    SesionActual,
    es_admin,
    hash_clave,
    usuario_por_id,
    usuario_publico,
    validar_titular,
)

rutas = APIRouter(prefix="/usuarios", tags=["Personas"])
Estado = Literal["Activo", "Inactivo"]
CAMPOS_PROPIOS = {"nombres_completos", "telefono", "fecha_nacimiento"}


class AltaUsuario(Registro):
    id_rol: Id


class EdicionUsuario(Entrada):
    nombres_completos: texto(2, 150) = None
    telefono: texto(0, 20) = None
    fecha_nacimiento: FechaNacimiento = None
    correo: Correo = None
    numero_documento: Documento = None
    tipo_documento: TipoDocumento = None
    id_rol: Id = None
    estado: Estado = None
    # Desertado o Retirado saca al aprendiz de la lista y le niega el ingreso; es reversible.
    situacion_formativa: Literal[
        "En inducción", "En formación", "Desertado", "Retirado"
    ] = None


def usuario_ausente():
    return ErrorAPI(404, "NOT_FOUND", "Usuario no encontrado")


@rutas.get("")
def listar(
    db: Base,
    pagina: Paginacion,
    sesion: Administrador,
    id_rol: Id = None,
    estado: Estado = None,
):
    personas = db.filas(
        f"""SELECT {COLUMNAS_PERSONA} FROM usuarios u JOIN rol r USING(id_rol)
        WHERE (%s::integer IS NULL OR u.id_rol=%s) AND (%s::text IS NULL OR lower(u.estado)=lower(%s))
        ORDER BY u.id_usuarios LIMIT %s OFFSET %s""",
        id_rol,
        id_rol,
        estado,
        estado,
        pagina["limit"],
        pagina["offset"],
    )
    meta = {**pagina, "id_rol": id_rol, "estado": estado}
    if estado:
        meta["totales"] = db.fila(
            """SELECT count(*) FILTER (WHERE lower(estado)='activo')::int activos,
            count(*) FILTER (WHERE lower(estado)='inactivo')::int inactivos FROM usuarios
            WHERE (%s::integer IS NULL OR id_rol=%s)""",
            id_rol,
            id_rol,
        )
    return responder([usuario_publico(persona) for persona in personas], meta=meta)


@rutas.post("", status_code=201)
def crear(datos: AltaUsuario, db: Base, sesion: Administrador):
    hash_guardado = hash_clave(datos.contrasena)
    with db.transaccion() as conexion:
        usuario = insertar_usuario(conexion, datos, hash_guardado, datos.id_rol)
    return responder(usuario_publico(usuario), 201)


@rutas.get("/{id}")
def detalle(id: IdRuta, db: Base, sesion: SesionActual):
    validar_titular(sesion, id)
    usuario = usuario_por_id(db, id)
    if not usuario:
        raise usuario_ausente()
    return responder(usuario_publico(usuario))


@rutas.patch("/{id}")
def actualizar(id: IdRuta, datos: EdicionUsuario, db: Base, sesion: SesionActual):
    validar_titular(sesion, id)
    campos = datos.model_dump(exclude_unset=True)
    if not campos or (not es_admin(sesion.usuario) and campos.keys() - CAMPOS_PROPIOS):
        raise ErrorAPI(422, "VALIDATION_ERROR", "Datos inválidos")
    asignaciones = sql.SQL(",").join(
        sql.SQL("{}=%s").format(sql.Identifier(campo)) for campo in campos
    )
    with db.transaccion() as conexion:
        consulta = sql.SQL("UPDATE usuarios SET {} WHERE id_usuarios=%s").format(
            asignaciones
        )
        if not conexion.ejecutar(consulta, *campos.values(), id):
            raise usuario_ausente()
        if {"correo", "estado"}.intersection(campos):
            invalidar_tokens(conexion, id)
        usuario = usuario_por_id(conexion, id)
    return responder(usuario_publico(usuario))


@rutas.delete("/{id}", status_code=204)
def desactivar(id: IdRuta, db: Base, sesion: Administrador):
    if id == sesion.id:
        raise ErrorAPI(409, "SELF_DEACTIVATION", "No puede desactivar su propia cuenta")
    if not db.ejecutar(
        "UPDATE usuarios SET estado='Inactivo',auth_version=auth_version+1 WHERE id_usuarios=%s",
        id,
    ):
        raise usuario_ausente()
    return Response(status_code=204)


@rutas.get("/{id}/fichas")
def fichas_asignadas(id: IdRuta, db: Base, sesion: SesionActual):
    validar_titular(sesion, id)
    return responder(
        db.filas(
            """SELECT DISTINCT f.*,p.nombre_programa FROM ficha f JOIN programa p USING(id_programa)
        WHERE f.id_ficha IN (SELECT id_ficha FROM aprendiz_ficha WHERE id_usuarios=%s AND fechasalida IS NULL
        AND lower(estado) NOT IN ('inactivo','retirado','finalizado','cancelado','desertado')
        UNION SELECT id_ficha FROM instructor_ficha WHERE id_usuarios=%s AND lower(estado)='activo')
        ORDER BY f.id_ficha""",
            id,
            id,
        )
    )

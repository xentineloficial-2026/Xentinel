"""Directorio administrativo y operaciones autorizadas sobre perfiles y fichas."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, Response
from psycopg import sql

from .autenticacion import (
    Clave,
    Correo,
    Documento,
    FechaNacimiento,
    Registro,
    TipoDocumento,
    insertar_usuario,
    invalidar_tokens,
)
from .catalogos import escapar_patron
from .fichas import vincular
from .http import Base, Entrada, ErrorAPI, Id, IdRuta, Paginacion, responder, texto
from .seguridad import (
    COLUMNAS_PERSONA,
    Administrador,
    CeladorOAdmin,
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
# Ficha activa más reciente de la persona `u`, con su programa.
FORMACION = """LEFT JOIN LATERAL (SELECT f.id_ficha,f.numero_ficha,f.nombre_ficha,
        p.id_programa,p.nombre_programa FROM aprendiz_ficha af
        JOIN ficha f ON f.id_ficha=af.id_ficha JOIN programa p ON p.id_programa=f.id_programa
        WHERE af.id_usuarios=u.id_usuarios AND af.fechasalida IS NULL
        ORDER BY af.id_aprendiz_ficha DESC LIMIT 1) fa ON true"""
COLUMNAS_FORMACION = (
    "id_ficha",
    "numero_ficha",
    "nombre_ficha",
    "id_programa",
    "nombre_programa",
)


def con_formacion(persona):
    """Datos públicos de la persona más el programa y la ficha a los que pertenece."""
    formacion = (
        {campo: persona[campo] for campo in COLUMNAS_FORMACION}
        if persona.get("id_ficha")
        else None
    )
    return {**usuario_publico(persona), "formacion": formacion}


class AltaUsuario(Registro):
    id_rol: Id
    # Piloto: sin contraseña escrita, la inicial es el número de documento.
    contrasena: Clave | None = None
    # Inscribir desde la ficha: el aprendiz queda vinculado en la misma operación.
    id_ficha: Id | None = None


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
    buscar: Annotated[str | None, Query(max_length=80)] = None,
):
    """Directorio con filtros por rol, estado y texto (nombre, documento o correo)."""
    patron = f"%{escapar_patron(buscar or '')}%"
    personas = db.filas(
        f"""SELECT {COLUMNAS_PERSONA},{",".join("fa." + c for c in COLUMNAS_FORMACION)}
        FROM usuarios u JOIN rol r USING(id_rol) {FORMACION}
        WHERE (%s::integer IS NULL OR u.id_rol=%s) AND (%s::text IS NULL OR lower(u.estado)=lower(%s))
        AND (%s::text IS NULL OR u.nombres_completos ILIKE %s OR u.numero_documento ILIKE %s
            OR u.correo ILIKE %s)
        ORDER BY u.id_usuarios LIMIT %s OFFSET %s""",
        id_rol,
        id_rol,
        estado,
        estado,
        buscar or None,
        patron,
        patron,
        patron,
        pagina["limit"],
        pagina["offset"],
    )
    meta = {**pagina, "id_rol": id_rol, "estado": estado, "buscar": buscar or None}
    if estado:
        meta["totales"] = db.fila(
            """SELECT count(*) FILTER (WHERE lower(estado)='activo')::int activos,
            count(*) FILTER (WHERE lower(estado)='inactivo')::int inactivos FROM usuarios
            WHERE (%s::integer IS NULL OR id_rol=%s)""",
            id_rol,
            id_rol,
        )
    return responder([con_formacion(persona) for persona in personas], meta=meta)


def formacion_de(conexion, identificador):
    persona = conexion.fila(
        f"""SELECT {COLUMNAS_PERSONA},{",".join("fa." + c for c in COLUMNAS_FORMACION)}
        FROM usuarios u JOIN rol r USING(id_rol) {FORMACION} WHERE u.id_usuarios=%s""",
        identificador,
    )
    return con_formacion(persona) if persona else None


@rutas.post("", status_code=201)
def crear(datos: AltaUsuario, db: Base, solicitud: Request, sesion: Administrador):
    hash_guardado = hash_clave(datos.contrasena or datos.numero_documento)
    with db.transaccion() as conexion:
        usuario = insertar_usuario(conexion, datos, hash_guardado, datos.id_rol)
        if datos.id_ficha:
            if not conexion.fila(
                "SELECT 1 FROM ficha WHERE id_ficha=%s FOR SHARE", datos.id_ficha
            ):
                raise ErrorAPI(404, "NOT_FOUND", "Ficha no encontrada")
            resultado = vincular(
                conexion,
                datos.id_ficha,
                [usuario["id_usuarios"]],
                solicitud.app.state.configuracion.ZONA_HORARIA,
            )
            if resultado["rechazados"]:
                raise ErrorAPI(
                    422, "NOT_APPRENTICE", resultado["rechazados"][0]["motivo"]
                )
        usuario = formacion_de(conexion, usuario["id_usuarios"])
    return responder(usuario, 201)


@rutas.get("/documento/{numero}")
def por_documento(numero: Documento, db: Base, sesion: CeladorOAdmin):
    """Sin QR, el celador digita el documento y confirma a quién registra."""
    persona = db.fila(
        """SELECT u.id_usuarios,u.nombres_completos,u.tipo_documento,u.numero_documento,
        u.estado,r.nombre_rol FROM usuarios u JOIN rol r USING(id_rol)
        WHERE u.numero_documento=%s ORDER BY lower(u.estado)='activo' DESC LIMIT 1""",
        numero,
    )
    if not persona:
        raise ErrorAPI(404, "NOT_FOUND", "No hay ninguna persona con ese documento")
    return responder(persona)


@rutas.get("/{id}")
def detalle(id: IdRuta, db: Base, sesion: SesionActual):
    validar_titular(sesion, id)
    with db.transaccion() as conexion:
        usuario = formacion_de(conexion, id)
    if not usuario:
        raise usuario_ausente()
    return responder(usuario)


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


# Firmas de archivo: el tipo se decide por el contenido, nunca por el nombre.
FIRMAS_FOTO = {
    bytes.fromhex("ffd8ff"): "image/jpeg",
    bytes.fromhex("89504e470d0a1a0a"): "image/png",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
}
MAXIMO_FOTO = 3 * 1024 * 1024


@rutas.put("/{id}/foto")
async def subir_foto(id: IdRuta, solicitud: Request, db: Base, sesion: SesionActual):
    validar_titular(sesion, id)
    contenido = await solicitud.body()
    tipo = next(
        (valor for firma, valor in FIRMAS_FOTO.items() if contenido.startswith(firma)),
        None,
    )
    if not contenido or len(contenido) > MAXIMO_FOTO:
        raise ErrorAPI(413, "PAYLOAD_TOO_LARGE", "La foto debe pesar máximo 3 MB")
    if not tipo:
        raise ErrorAPI(415, "UNSUPPORTED_MEDIA", "Usa una imagen JPG, PNG o GIF")
    with db.transaccion() as conexion:
        if not conexion.fila("SELECT 1 FROM usuarios WHERE id_usuarios=%s", id):
            raise usuario_ausente()
        conexion.ejecutar(
            """INSERT INTO usuario_foto(id_usuarios,contenido,tipo) VALUES(%s,%s,%s)
            ON CONFLICT (id_usuarios) DO UPDATE SET contenido=EXCLUDED.contenido,
            tipo=EXCLUDED.tipo,actualizado_en=now()""",
            id,
            contenido,
            tipo,
        )
        conexion.ejecutar(
            """UPDATE usuarios SET foto_url='/api/v1/usuarios/'||id_usuarios||'/foto?v='||
            floor(extract(epoch FROM now()))::bigint WHERE id_usuarios=%s""",
            id,
        )
        usuario = usuario_por_id(conexion, id)
    return responder(usuario_publico(usuario))


@rutas.get("/{id}/foto")
def ver_foto(id: IdRuta, db: Base, sesion: SesionActual):
    validar_titular(sesion, id)
    foto = db.fila("SELECT contenido,tipo FROM usuario_foto WHERE id_usuarios=%s", id)
    if not foto:
        raise ErrorAPI(404, "NOT_FOUND", "Esta persona no tiene foto")
    return Response(
        bytes(foto["contenido"]),
        media_type=foto["tipo"],
        headers={"Cache-Control": "private, max-age=300"},
    )

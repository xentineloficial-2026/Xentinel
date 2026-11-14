"""Registro, inicio de sesión y recuperación de credenciales de uso único."""

from datetime import date
from hashlib import sha256
from secrets import token_hex
from typing import Annotated, Literal
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Request, Response
from pydantic import AfterValidator, StringConstraints

from .correo import cifrar_correo
from .http import Base, Entrada, ErrorAPI, responder, texto
from .seguridad import (
    COLUMNAS_PERSONA,
    SesionActual,
    activo,
    comprobar_clave,
    crear_token,
    hash_clave,
    usuario_por_id,
    usuario_publico,
)

rutas = APIRouter(tags=["Autenticación"])
legado = APIRouter(include_in_schema=False)
Documento = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9-]{3,20}$")
]
TipoDocumento = Literal["CC", "TI", "CE", "PA", "PEP", "PPT"]
# Acepta dominios de pruebas y las mismas direcciones ASCII del contrato anterior.
Correo = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        max_length=254,
        pattern=r"^[A-Za-z0-9_'+-]+(?:\.[A-Za-z0-9_'+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$",
    ),
]
TokenRecuperacion = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
ClaveActual = Annotated[str, StringConstraints(min_length=1, max_length=200)]
FechaNacimiento = Annotated[
    str,
    StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    AfterValidator(lambda fecha: date.fromisoformat(fecha).isoformat()),
]


def validar_bytes_clave(clave):
    if len(clave.encode()) > 72:
        raise ValueError("Máximo 72 bytes UTF-8")
    return clave


Clave = Annotated[
    str,
    StringConstraints(min_length=6, max_length=72),
    AfterValidator(validar_bytes_clave),
]


class Registro(Entrada):
    nombres_completos: texto(2, 150)
    tipo_documento: TipoDocumento
    numero_documento: Documento
    correo: Correo
    contrasena: Clave
    telefono: texto(0, 20) = None
    fecha_nacimiento: FechaNacimiento = None


class Login(Entrada):
    documento: texto(1, 20)
    contrasena: ClaveActual


class SolicitudRecuperacion(Entrada):
    correo: Correo


class ValidacionRecuperacion(SolicitudRecuperacion):
    token: TokenRecuperacion


class Restablecimiento(ValidacionRecuperacion):
    contrasena: Clave


class CambioClave(Entrada):
    actual: ClaveActual
    nueva: Clave


def insertar_usuario(db, datos, hash_guardado, rol):
    creado = db.fila(
        """INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,
        correo,contrasena,telefono,fecha_nacimiento,id_rol) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id_usuarios""",
        datos.nombres_completos,
        datos.tipo_documento,
        datos.numero_documento,
        datos.correo,
        hash_guardado,
        datos.telefono or None,
        datos.fecha_nacimiento,
        rol,
    )
    return usuario_por_id(db, creado["id_usuarios"])


@legado.post("/registro", status_code=201)
@rutas.post("/auth/registro", status_code=201)
def registrar(datos: Registro, db: Base, solicitud: Request):
    hash_guardado = hash_clave(datos.contrasena)
    with db.transaccion() as conexion:
        rol = conexion.fila("SELECT id_rol FROM rol WHERE lower(nombre_rol)='aprendiz'")
        usuario = insertar_usuario(conexion, datos, hash_guardado, rol["id_rol"])
    return responder(
        usuario_publico(usuario), 201, legado=solicitud.url.path == "/registro"
    )


@legado.post("/login")
@rutas.post("/auth/login")
def iniciar_sesion(datos: Login, db: Base, solicitud: Request):
    usuario = db.fila(
        f"""SELECT {COLUMNAS_PERSONA},u.contrasena,u.auth_version,u.requiere_restablecimiento
        FROM usuarios u JOIN rol r USING(id_rol) WHERE numero_documento=%s""",
        datos.documento,
    )
    habilitado = activo(usuario) and not usuario["requiere_restablecimiento"]
    valida = comprobar_clave(
        datos.contrasena, usuario["contrasena"] if habilitado else None
    )
    if not valida or not habilitado:
        raise ErrorAPI(401, "INVALID_CREDENTIALS", "Documento o contraseña incorrectos")
    config = solicitud.app.state.configuracion
    publico = usuario_publico(usuario)
    resultado = {
        "access_token": crear_token(usuario, config),
        "token_type": "Bearer",
        "expires_in": config.JWT_TTL_SECONDS,
        "usuario": publico,
    }
    es_legado = solicitud.url.path == "/login"
    return responder(
        {**publico, **resultado} if es_legado else resultado, legado=es_legado
    )


@rutas.get("/auth/me")
def mi_perfil(sesion: SesionActual):
    return responder(usuario_publico(sesion.usuario))


@rutas.post("/auth/logout", status_code=204)
def cerrar_sesion(db: Base, sesion: SesionActual):
    db.ejecutar(
        "UPDATE usuarios SET auth_version=auth_version+1 WHERE id_usuarios=%s",
        sesion.id,
    )
    return Response(status_code=204)


def hash_token(token):
    return sha256(token.encode()).hexdigest()


def token_invalido():
    return ErrorAPI(
        400, "INVALID_RESET_TOKEN", "El enlace es inválido, venció o ya fue utilizado"
    )


def invalidar_tokens(db, identificador):
    db.ejecutar(
        "UPDATE password_reset_tokens SET usado_en=now() WHERE id_usuarios=%s AND usado_en IS NULL",
        identificador,
    )


@rutas.post("/auth/olvide-contrasena", status_code=202)
def solicitar_recuperacion(datos: SolicitudRecuperacion, db: Base, solicitud: Request):
    config = solicitud.app.state.configuracion
    if not config.SMTP_HOST and config.NODE_ENV != "test":
        raise ErrorAPI(503, "INTERNAL_ERROR", "No se pudo completar la solicitud")
    with db.transaccion() as conexion:
        usuario = conexion.fila(
            """SELECT id_usuarios,correo FROM usuarios
            WHERE lower(btrim(correo))=%s AND lower(estado)='activo' FOR UPDATE""",
            datos.correo,
        )
        if usuario:
            identificador = usuario["id_usuarios"]
            reciente = conexion.fila(
                """SELECT id_token FROM password_reset_tokens WHERE id_usuarios=%s
                AND creado_en>now()-interval '1 minute' LIMIT 1""",
                identificador,
            )
            if not reciente:
                invalidar_tokens(conexion, identificador)
                token = token_hex(32)
                creado = conexion.fila(
                    """INSERT INTO password_reset_tokens(id_usuarios,token_hash,token_expiracion)
                    VALUES(%s,%s,now()+make_interval(mins=>%s)) RETURNING id_token""",
                    identificador,
                    hash_token(token),
                    config.RESET_TTL_MINUTES,
                )
                # El fragmento mantiene el token fuera de los registros de acceso HTTP.
                enlace = (
                    urlsplit(config.RESET_PASSWORD_URL)
                    ._replace(
                        fragment=urlencode(
                            {"token": token, "correo": usuario["correo"]}
                        )
                    )
                    .geturl()
                )
                conexion.ejecutar(
                    "INSERT INTO mail_outbox(id_token,payload_encrypted) VALUES(%s,%s)",
                    creado["id_token"],
                    cifrar_correo({"to": usuario["correo"], "link": enlace}, config),
                )
    return responder(
        {
            "message": "Si el correo corresponde a una cuenta activa, recibirás un enlace "
            "para restablecer la contraseña."
        },
        202,
    )


@rutas.post("/auth/validar-recuperacion")
def validar_recuperacion(datos: ValidacionRecuperacion, db: Base):
    token = db.fila(
        """SELECT t.id_token FROM password_reset_tokens t JOIN usuarios u USING(id_usuarios)
        WHERE token_hash=%s AND lower(btrim(correo))=%s AND usado_en IS NULL
        AND token_expiracion>now() AND lower(estado)='activo' """,
        hash_token(datos.token),
        datos.correo,
    )
    if not token:
        raise token_invalido()
    return responder({"valid": True})


@rutas.post("/auth/restablecer-contrasena")
def restablecer(datos: Restablecimiento, db: Base):
    hash_guardado = hash_clave(datos.contrasena)
    with db.transaccion() as conexion:
        # Usuario antes de token, igual que al generar el enlace.
        usuario = conexion.fila(
            """SELECT id_usuarios FROM usuarios WHERE lower(btrim(correo))=%s
            AND lower(estado)='activo' FOR UPDATE""",
            datos.correo,
        )
        if not usuario:
            raise token_invalido()
        identificador = usuario["id_usuarios"]
        token = conexion.fila(
            """UPDATE password_reset_tokens SET usado_en=now() WHERE token_hash=%s
            AND id_usuarios=%s AND usado_en IS NULL AND token_expiracion>now() RETURNING id_token""",
            hash_token(datos.token),
            identificador,
        )
        if not token:
            raise token_invalido()
        conexion.ejecutar(
            """UPDATE usuarios SET contrasena=%s,requiere_restablecimiento=false,
            auth_version=auth_version+1 WHERE id_usuarios=%s""",
            hash_guardado,
            identificador,
        )
        invalidar_tokens(conexion, identificador)
    return responder({"message": "Contraseña actualizada. Inicia sesión de nuevo."})


@rutas.put("/auth/contrasena", status_code=204)
def cambiar_clave(datos: CambioClave, db: Base, sesion: SesionActual):
    hash_guardado = hash_clave(datos.nueva)
    with db.transaccion() as conexion:
        usuario = conexion.fila(
            "SELECT contrasena,auth_version FROM usuarios WHERE id_usuarios=%s FOR UPDATE",
            sesion.id,
        )
        if (
            not usuario
            or usuario["auth_version"] != sesion.token["ver"]
            or not comprobar_clave(datos.actual, usuario["contrasena"])
        ):
            raise ErrorAPI(
                401,
                "INVALID_CREDENTIALS",
                "Contraseña actual incorrecta o sesión revocada",
            )
        conexion.ejecutar(
            "UPDATE usuarios SET contrasena=%s,auth_version=auth_version+1 WHERE id_usuarios=%s",
            hash_guardado,
            sesion.id,
        )
        invalidar_tokens(conexion, sesion.id)
    return Response(status_code=204)

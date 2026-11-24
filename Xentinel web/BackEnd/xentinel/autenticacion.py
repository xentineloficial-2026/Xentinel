"""Registro, inicio de sesión y recuperación de credenciales de uso único."""

import hmac
from datetime import date
from hashlib import sha256
from secrets import randbelow
from time import time
from typing import Annotated, Literal
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Request, Response
from pydantic import AfterValidator, StringConstraints

from . import credenciales
from .correo import cifrar_correo
from .http import Base, Entrada, ErrorAPI, responder, texto
from .proteccion_http import contar_peticion
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
CodigoRecuperacion = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9]{6}$")
]
MAXIMO_INTENTOS_CODIGO = 5
SOLICITUDES_POR_CORREO = 3
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
    codigo: CodigoRecuperacion


class Restablecimiento(ValidacionRecuperacion):
    contrasena: Clave


class CambioClave(Entrada):
    actual: ClaveActual
    nueva: Clave


class SolicitudCambioCorreo(Entrada):
    correo: Correo
    contrasena: ClaveActual


class ConfirmacionCambioCorreo(Entrada):
    codigo: CodigoRecuperacion


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
    config = solicitud.app.state.configuracion
    # Por cuenta, además del límite por IP: frena la fuerza bruta contra un documento
    # aunque llegue desde muchas IP, y permite elevar el de IP para sedes con NAT.
    contar_peticion(
        db,
        f"documento:{datos.documento.lower()}",
        "login",
        config.RATE_LIMIT_LOGIN_PER_ACCOUNT,
        900,
    )
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


@rutas.post("/auth/renovar")
def renovar_sesion(sesion: SesionActual, solicitud: Request):
    """Emite un JWT nuevo antes de que venza el actual, sin pedir otra vez la contraseña.

    La renovación conserva el instante del ingreso original (``auth_time``): al superar
    ``SESSION_MAX_HOURS`` la persona debe autenticarse de nuevo. Cerrar sesión, cambiar la
    contraseña o desactivar la cuenta revoca también los tokens renovados.
    """
    config = solicitud.app.state.configuracion
    inicio = sesion.token.get("auth_time", sesion.token.get("iat"))
    if (
        type(inicio) is not int
        or inicio > time() + 60
        or time() - inicio > config.SESSION_MAX_HOURS * 3600
    ):
        raise ErrorAPI(
            401,
            "SESSION_MAX_AGE",
            "La sesión alcanzó su duración máxima. Vuelve a ingresar.",
        )
    return responder(
        {
            "access_token": crear_token(sesion.usuario, config, inicio),
            "token_type": "Bearer",
            "expires_in": config.JWT_TTL_SECONDS,
            "usuario": usuario_publico(sesion.usuario),
        }
    )


@rutas.get("/auth/credencial-qr")
def credencial_qr(sesion: SesionActual, solicitud: Request):
    """Clave del carnet QR rotativo del titular, para generarlo incluso sin conexión.

    Solo sirve para el carnet de esta persona y se revoca con ``auth_version``.
    """
    config = solicitud.app.state.configuracion
    clave = credenciales.clave_usuario(
        config, sesion.id, sesion.usuario["auth_version"]
    )
    return responder(
        {
            "version": 2,
            "formato": credenciales.PREFIJO,
            "id_usuarios": sesion.id,
            "clave": credenciales.codificar_clave(clave),
            "paso_segundos": credenciales.PASO_SEGUNDOS,
            "ventana_pasos": credenciales.VENTANA_PASOS,
            "servidor_ms": int(time() * 1000),
        }
    )


@rutas.post("/auth/logout", status_code=204)
def cerrar_sesion(db: Base, sesion: SesionActual):
    db.ejecutar(
        "UPDATE usuarios SET auth_version=auth_version+1 WHERE id_usuarios=%s",
        sesion.id,
    )
    return Response(status_code=204)


def hash_codigo(config, identificador, codigo):
    # HMAC con clave del servidor: un volcado de la base no permite probar el millón de códigos.
    clave = hmac.new(config.JWT_SECRET.encode(), b"xentinel-otp-v1", sha256).digest()
    return hmac.new(clave, f"{identificador}:{codigo}".encode(), sha256).hexdigest()


def correo_no_configurado():
    return ErrorAPI(
        503,
        "MAIL_NOT_CONFIGURED",
        "El envío de correos no está disponible en este momento. Pide ayuda a "
        "administración para recuperar el acceso.",
    )


def enlace_web(config, fragmento=""):
    """Dirección de la web (la de RESET_PASSWORD_URL) para incluirla en el correo."""
    return urlsplit(config.RESET_PASSWORD_URL)._replace(fragment=fragmento).geturl()


def codigo_invalido():
    return ErrorAPI(
        400,
        "INVALID_RESET_CODE",
        "El código es incorrecto, venció o ya fue utilizado. Solicita uno nuevo.",
    )


def invalidar_tokens(db, identificador):
    db.ejecutar(
        "UPDATE password_reset_tokens SET usado_en=now() WHERE id_usuarios=%s AND usado_en IS NULL",
        identificador,
    )


def comprobar_codigo(conexion, config, correo, codigo, consumir):
    """Usuario del código válido o None. Un fallo suma un intento; al quinto se anula."""
    usuario = conexion.fila(
        """SELECT id_usuarios FROM usuarios WHERE lower(btrim(correo))=%s
        AND lower(estado)='activo' FOR UPDATE""",
        correo,
    )
    if not usuario:
        hash_codigo(config, 0, codigo)
        return None
    identificador = usuario["id_usuarios"]
    token = conexion.fila(
        """SELECT id_token,token_hash FROM password_reset_tokens WHERE id_usuarios=%s
        AND proposito='recuperacion' AND usado_en IS NULL AND token_expiracion>now()
        AND intentos<%s ORDER BY id_token DESC LIMIT 1 FOR UPDATE""",
        identificador,
        MAXIMO_INTENTOS_CODIGO,
    )
    if not token:
        return None
    if not hmac.compare_digest(
        token["token_hash"], hash_codigo(config, identificador, codigo)
    ):
        conexion.ejecutar(
            """UPDATE password_reset_tokens SET intentos=intentos+1,
            usado_en=CASE WHEN intentos+1>=%s THEN now() END WHERE id_token=%s""",
            MAXIMO_INTENTOS_CODIGO,
            token["id_token"],
        )
        return None
    if consumir:
        conexion.ejecutar(
            "UPDATE password_reset_tokens SET usado_en=now() WHERE id_token=%s",
            token["id_token"],
        )
    return identificador


@rutas.post("/auth/olvide-contrasena", status_code=202)
def solicitar_recuperacion(datos: SolicitudRecuperacion, db: Base, solicitud: Request):
    config = solicitud.app.state.configuracion
    if not config.correo_configurado and config.NODE_ENV != "test":
        raise correo_no_configurado()
    # Por correo, exista o no la cuenta: limita el abuso sin revelar qué correos existen.
    contar_peticion(db, datos.correo, "reset-correo", SOLICITUDES_POR_CORREO, 900)
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
                AND proposito='recuperacion' AND creado_en>now()-interval '1 minute' LIMIT 1""",
                identificador,
            )
            if not reciente:
                # Un código nuevo reemplaza a los anteriores (y su correo pendiente).
                conexion.ejecutar(
                    """DELETE FROM password_reset_tokens
                    WHERE id_usuarios=%s AND proposito='recuperacion'""",
                    identificador,
                )
                codigo = f"{randbelow(1_000_000):06d}"
                creado = conexion.fila(
                    """INSERT INTO password_reset_tokens(id_usuarios,token_hash,token_expiracion)
                    VALUES(%s,%s,now()+make_interval(mins=>%s)) RETURNING id_token""",
                    identificador,
                    hash_codigo(config, identificador, codigo),
                    config.RESET_TTL_MINUTES,
                )
                enlace = enlace_web(config, urlencode({"correo": usuario["correo"]}))
                conexion.ejecutar(
                    "INSERT INTO mail_outbox(id_token,payload_encrypted) VALUES(%s,%s)",
                    creado["id_token"],
                    cifrar_correo(
                        {
                            "to": usuario["correo"],
                            "codigo": codigo,
                            "link": enlace,
                            "tipo": "recuperacion",
                        },
                        config,
                    ),
                )
    return responder(
        {
            "message": "Si el correo corresponde a una cuenta activa, recibirás un código "
            "de 6 dígitos para restablecer la contraseña."
        },
        202,
    )


@rutas.post("/auth/validar-recuperacion")
def validar_recuperacion(datos: ValidacionRecuperacion, db: Base, solicitud: Request):
    config = solicitud.app.state.configuracion
    with db.transaccion() as conexion:
        valido = comprobar_codigo(conexion, config, datos.correo, datos.codigo, False)
    # Fuera de la transacción: el intento fallido queda registrado aunque se responda 400.
    if not valido:
        raise codigo_invalido()
    return responder({"valid": True})


@rutas.post("/auth/restablecer-contrasena")
def restablecer(datos: Restablecimiento, db: Base, solicitud: Request):
    config = solicitud.app.state.configuracion
    hash_guardado = hash_clave(datos.contrasena)
    with db.transaccion() as conexion:
        identificador = comprobar_codigo(
            conexion, config, datos.correo, datos.codigo, True
        )
        if identificador:
            conexion.ejecutar(
                """UPDATE usuarios SET contrasena=%s,requiere_restablecimiento=false,
                auth_version=auth_version+1 WHERE id_usuarios=%s""",
                hash_guardado,
                identificador,
            )
            invalidar_tokens(conexion, identificador)
    if not identificador:
        raise codigo_invalido()
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


@rutas.post("/auth/correo/solicitar", status_code=202)
def solicitar_cambio_correo(
    datos: SolicitudCambioCorreo, db: Base, solicitud: Request, sesion: SesionActual
):
    """Envía un código de 6 dígitos al correo nuevo para comprobar que es de la persona.

    Exige la contraseña actual. El correo de la cuenta no cambia hasta confirmar el código
    en ``POST /auth/correo/confirmar``.
    """
    config = solicitud.app.state.configuracion
    if not config.correo_configurado and config.NODE_ENV != "test":
        raise correo_no_configurado()
    contar_peticion(
        db, f"usuario:{sesion.id}", "cambio-correo", SOLICITUDES_POR_CORREO, 900
    )
    with db.transaccion() as conexion:
        usuario = conexion.fila(
            """SELECT contrasena,auth_version,correo FROM usuarios
            WHERE id_usuarios=%s FOR UPDATE""",
            sesion.id,
        )
        if (
            not usuario
            or usuario["auth_version"] != sesion.token["ver"]
            or not comprobar_clave(datos.contrasena, usuario["contrasena"])
        ):
            raise ErrorAPI(
                401, "INVALID_CREDENTIALS", "La contraseña actual no es correcta"
            )
        if (usuario["correo"] or "").strip().lower() == datos.correo:
            raise ErrorAPI(409, "SAME_EMAIL", "Ese ya es el correo de tu cuenta")
        if conexion.fila(
            """SELECT 1 FROM usuarios WHERE lower(btrim(correo))=%s AND id_usuarios<>%s""",
            datos.correo,
            sesion.id,
        ):
            raise ErrorAPI(
                409, "EMAIL_IN_USE", "Ese correo ya está registrado en otra cuenta"
            )
        # Un código nuevo reemplaza al anterior (y a su correo pendiente).
        conexion.ejecutar(
            """DELETE FROM password_reset_tokens
            WHERE id_usuarios=%s AND proposito='cambio_correo'""",
            sesion.id,
        )
        codigo = f"{randbelow(1_000_000):06d}"
        creado = conexion.fila(
            """INSERT INTO password_reset_tokens(id_usuarios,token_hash,token_expiracion,
            proposito,correo_nuevo) VALUES(%s,%s,now()+make_interval(mins=>%s),
            'cambio_correo',%s) RETURNING id_token""",
            sesion.id,
            hash_codigo(config, f"correo:{sesion.id}", codigo),
            config.RESET_TTL_MINUTES,
            datos.correo,
        )
        conexion.ejecutar(
            "INSERT INTO mail_outbox(id_token,payload_encrypted) VALUES(%s,%s)",
            creado["id_token"],
            cifrar_correo(
                {
                    "to": datos.correo,
                    "codigo": codigo,
                    "link": enlace_web(config),
                    "tipo": "cambio_correo",
                },
                config,
            ),
        )
    return responder(
        {
            "message": f"Enviamos un código de 6 dígitos a {datos.correo}. "
            f"Vence en {config.RESET_TTL_MINUTES} minutos.",
            "correo": datos.correo,
        },
        202,
    )


@rutas.post("/auth/correo/confirmar")
def confirmar_cambio_correo(
    datos: ConfirmacionCambioCorreo, db: Base, solicitud: Request, sesion: SesionActual
):
    """Cambia el correo de la cuenta si el código es correcto (5 intentos, uso único).

    Como al cambiar la contraseña, la base revoca las sesiones abiertas de la persona:
    después de confirmar, la web y la app piden ingresar de nuevo.
    """
    config = solicitud.app.state.configuracion
    nuevo = None
    with db.transaccion() as conexion:
        token = conexion.fila(
            """SELECT id_token,token_hash,correo_nuevo FROM password_reset_tokens
            WHERE id_usuarios=%s AND proposito='cambio_correo' AND usado_en IS NULL
            AND token_expiracion>now() AND intentos<%s
            ORDER BY id_token DESC LIMIT 1 FOR UPDATE""",
            sesion.id,
            MAXIMO_INTENTOS_CODIGO,
        )
        if token and hmac.compare_digest(
            token["token_hash"],
            hash_codigo(config, f"correo:{sesion.id}", datos.codigo),
        ):
            conexion.ejecutar(
                "UPDATE password_reset_tokens SET usado_en=now() WHERE id_token=%s",
                token["id_token"],
            )
            if conexion.fila(
                """SELECT 1 FROM usuarios WHERE lower(btrim(correo))=%s
                AND id_usuarios<>%s""",
                token["correo_nuevo"],
                sesion.id,
            ):
                raise ErrorAPI(
                    409, "EMAIL_IN_USE", "Ese correo ya está registrado en otra cuenta"
                )
            # El disparador de la base anula cualquier código de recuperación pendiente.
            conexion.ejecutar(
                "UPDATE usuarios SET correo=%s WHERE id_usuarios=%s",
                token["correo_nuevo"],
                sesion.id,
            )
            nuevo = usuario_por_id(conexion, sesion.id)
        elif token:
            conexion.ejecutar(
                """UPDATE password_reset_tokens SET intentos=intentos+1,
                usado_en=CASE WHEN intentos+1>=%s THEN now() END WHERE id_token=%s""",
                MAXIMO_INTENTOS_CODIGO,
                token["id_token"],
            )
    # Fuera de la transacción: el intento fallido queda registrado aunque se responda 400.
    if not nuevo:
        raise codigo_invalido()
    return responder(usuario_publico(nuevo))

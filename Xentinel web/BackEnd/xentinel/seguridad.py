"""Sesiones Bearer interoperables con Express y autorización por rol o titular."""

import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .http import Base, ErrorAPI

CAMPOS_PERSONA = (
    "id_usuarios",
    "nombres_completos",
    "tipo_documento",
    "numero_documento",
    "correo",
    "telefono",
    "fecha_nacimiento",
    "estado",
    "situacion_formativa",
    "id_rol",
    "nombre_rol",
    "foto_url",
    "foto_pos",
)
COLUMNAS_PERSONA = ",".join(
    f"{'r' if campo == 'nombre_rol' else 'u'}.{campo}" for campo in CAMPOS_PERSONA
)
EMISOR = "xentinel-api"
AUDIENCIA = "xentinel-clients"
ESQUEMA_BEARER = HTTPBearer(auto_error=False)
# Hace el mismo trabajo bcrypt para documentos inexistentes y cuentas bloqueadas.
HASH_FICTICIO = bcrypt.hashpw(
    b"Xentinel-valor-ficticio-no-es-una-credencial", bcrypt.gensalt(12)
)


def usuario_por_id(db, identificador):
    return db.fila(
        f"""SELECT {COLUMNAS_PERSONA},u.auth_version
        FROM usuarios u JOIN rol r USING(id_rol) WHERE u.id_usuarios=%s""",
        identificador,
    )


def usuario_publico(usuario):
    return {
        **{campo: usuario[campo] for campo in CAMPOS_PERSONA},
        "nombre": usuario["nombres_completos"],
    }


def nombre_rol(usuario):
    return "".join(
        letra
        for letra in unicodedata.normalize("NFD", usuario["nombre_rol"])
        if not unicodedata.combining(letra)
    ).lower()


def es_admin(usuario):
    return nombre_rol(usuario) in ("administrador", "admin")


def activo(usuario):
    return usuario is not None and (usuario.get("estado") or "").lower() == "activo"


def crear_token(usuario, configuracion, inicio=None):
    """JWT corto. ``auth_time`` conserva el ingreso original para limitar las renovaciones."""
    ahora = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(usuario["id_usuarios"]),
            "ver": usuario["auth_version"],
            "iss": EMISOR,
            "aud": AUDIENCIA,
            "iat": ahora,
            "auth_time": int(inicio if inicio is not None else ahora.timestamp()),
            "exp": ahora + timedelta(seconds=configuracion.JWT_TTL_SECONDS),
        },
        configuracion.JWT_SECRET,
        algorithm="HS256",
    )


def hash_clave(clave):
    return bcrypt.hashpw(clave.encode(), bcrypt.gensalt(12)).decode()


def comprobar_clave(clave, hash_guardado=None):
    # bcryptjs admite claves históricas de más de 72 bytes truncándolas.
    try:
        return bcrypt.checkpw(
            clave.encode()[:72],
            hash_guardado.encode() if hash_guardado else HASH_FICTICIO,
        )
    except ValueError:
        bcrypt.checkpw(clave.encode()[:72], HASH_FICTICIO)
        return False


@dataclass(frozen=True)
class Sesion:
    usuario: dict
    token: dict

    @property
    def id(self):
        return self.usuario["id_usuarios"]


def autenticar(
    solicitud: Request,
    db: Base,
    credencial: Annotated[
        HTTPAuthorizationCredentials | None, Security(ESQUEMA_BEARER)
    ],
):
    cabecera = solicitud.headers.get("Authorization", "")
    if not credencial or not re.fullmatch(r"Bearer \S+", cabecera, re.IGNORECASE):
        raise ErrorAPI(401, "UNAUTHORIZED", "Se requiere Authorization: Bearer token")
    return sesion_desde_token(
        solicitud.app.state.configuracion, db, credencial.credentials
    )


def sesion_desde_token(configuracion, db, credencial):
    """Valida firma, vigencia, versión y estado; compartido por HTTP y WebSocket."""
    if not isinstance(credencial, str) or not 0 < len(credencial) <= 4096:
        raise ErrorAPI(401, "UNAUTHORIZED", "Se requiere un token de sesión")
    try:
        token = jwt.decode(
            credencial,
            configuracion.JWT_SECRET,
            algorithms=["HS256"],
            issuer=EMISOR,
            audience=AUDIENCIA,
            options={"require": ["exp", "sub", "ver"]},
        )
    except jwt.InvalidTokenError:
        raise ErrorAPI(401, "INVALID_TOKEN", "Sesión inválida o vencida") from None
    if not re.fullmatch(r"[0-9]{1,10}", token["sub"]) or type(token["ver"]) is not int:
        raise ErrorAPI(401, "INVALID_TOKEN", "Sesión inválida")
    usuario = usuario_por_id(db, int(token["sub"]))
    if not activo(usuario) or usuario["auth_version"] != token["ver"]:
        raise ErrorAPI(401, "REVOKED_TOKEN", "Sesión inválida o revocada")
    return Sesion(usuario, token)


SesionActual = Annotated[Sesion, Depends(autenticar)]


def autorizar(*roles):
    def comprobar(sesion: SesionActual):
        if not es_admin(sesion.usuario) and nombre_rol(sesion.usuario) not in roles:
            raise ErrorAPI(403, "FORBIDDEN", "No tiene permisos para esta operación")
        return sesion

    return comprobar


Administrador = Annotated[Sesion, Depends(autorizar())]
CeladorOAdmin = Annotated[Sesion, Depends(autorizar("celador"))]
InstructorOAdmin = Annotated[Sesion, Depends(autorizar("instructor"))]


def validar_titular(sesion, identificador):
    if sesion.id != identificador and not es_admin(sesion.usuario):
        raise ErrorAPI(403, "FORBIDDEN", "No tiene acceso a este usuario")

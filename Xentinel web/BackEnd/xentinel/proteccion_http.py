"""Cabeceras, CORS y límites compartidos sin almacenar las respuestas SSE en memoria."""

import logging
import re
from hashlib import sha256
from uuid import uuid4

import jwt
from fastapi.exceptions import RequestValidationError
from psycopg import Error as ErrorPostgres
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, Response

from .http import ErrorAPI
from .seguridad import AUDIENCIA, EMISOR

LOG = logging.getLogger(__name__)
MAXIMO_CUERPO = 64 * 1024
# Solo la subida de la foto de perfil admite archivos de hasta 3 MB.
MAXIMO_FOTO = 3 * 1024 * 1024 + 4096
RUTA_FOTO = re.compile(r"^/api/v1/usuarios/\d+/foto$")
METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
RUTAS_AUTH = {
    "/login",
    "/registro",
    "/api/v1/auth/login",
    "/api/v1/auth/registro",
    "/api/v1/auth/contrasena",
}
RUTAS_RESET = {
    f"/api/v1/auth/{ruta}"
    for ruta in (
        "olvide-contrasena",
        "validar-recuperacion",
        "restablecer-contrasena",
    )
}
ERRORES_SQL = {
    "23505": (409, "CONFLICT", "El registro ya existe"),
    "23503": (409, "REFERENCE_CONFLICT", "Referencia inexistente o registro en uso"),
    **dict.fromkeys(
        ("23514", "23502", "22007", "22008", "22P02"),
        (422, "INVALID_DATA", "Datos incompatibles con las restricciones"),
    ),
    **dict.fromkeys(
        ("40001", "40P01"),
        (409, "RETRY_TRANSACTION", "Conflicto concurrente, reintente la operación"),
    ),
}


def respuesta_error(scope, error, campos=None):
    datos = {
        "code": error.codigo,
        "message": str(error),
        "request_id": scope.get("state", {}).get("request_id"),
    }
    if campos is not None:
        datos["fields"] = campos
    return JSONResponse(
        {"error": datos, "detail": str(error)},
        status_code=error.estado,
        headers=error.cabeceras,
    )


def error_interno(scope, error):
    # Ni cuerpos ni parámetros SQL se escriben en registros de error.
    LOG.error(
        "request_id=%s tipo=%s sqlstate=%s",
        scope.get("state", {}).get("request_id"),
        type(error).__name__,
        getattr(error, "sqlstate", None),
    )
    return respuesta_error(
        scope, ErrorAPI(500, "INTERNAL_ERROR", "No se pudo completar la solicitud")
    )


async def error_api(solicitud, error):
    return respuesta_error(solicitud.scope, error)


async def error_validacion(solicitud, error):
    if any(campo["type"] == "json_invalid" for campo in error.errors()):
        return respuesta_error(
            solicitud.scope, ErrorAPI(400, "INVALID_JSON", "JSON inválido")
        )
    campos = [
        {"path": ".".join(map(str, campo["loc"][1:])), "message": campo["msg"]}
        for campo in error.errors()
    ]
    return respuesta_error(
        solicitud.scope, ErrorAPI(422, "VALIDATION_ERROR", "Datos inválidos"), campos
    )


async def error_ruta(solicitud, error):
    if error.status_code in (404, 405):
        return respuesta_error(
            solicitud.scope, ErrorAPI(404, "NOT_FOUND", "Ruta no encontrada")
        )
    return respuesta_error(
        solicitud.scope,
        ErrorAPI(error.status_code, "HTTP_ERROR", str(error.detail), error.headers),
    )


async def error_postgres(solicitud, error):
    if error.sqlstate in ERRORES_SQL:
        return respuesta_error(solicitud.scope, ErrorAPI(*ERRORES_SQL[error.sqlstate]))
    return error_interno(solicitud.scope, error)


MANEJADORES = {
    ErrorAPI: error_api,
    RequestValidationError: error_validacion,
    HTTPException: error_ruta,
    ErrorPostgres: error_postgres,
}


def contar_peticion(db, ip, grupo, maximo, segundos):
    clave = sha256(f"{grupo}:{ip}".encode()).hexdigest()
    fila = db.fila(
        """INSERT INTO api_rate_limits(key,hits,expires_at)
        VALUES(%s,1,now()+make_interval(secs=>%s)) ON CONFLICT (key) DO UPDATE SET
        hits=CASE WHEN api_rate_limits.expires_at<=now() THEN 1 ELSE api_rate_limits.hits+1 END,
        expires_at=CASE WHEN api_rate_limits.expires_at<=now() THEN now()+make_interval(secs=>%s)
            ELSE api_rate_limits.expires_at END RETURNING hits""",
        clave,
        segundos,
        segundos,
    )
    if fila["hits"] > maximo:
        raise ErrorAPI(
            429,
            "RATE_LIMIT",
            "Demasiadas solicitudes; intente más tarde",
            {"Retry-After": str(segundos)},
        )


def clave_limite(cabeceras, config, ip):
    """Persona autenticada (firma del JWT válida) o, sin sesión, la IP.

    Solo se comprueba la firma, sin consultar la base: basta para que un cliente no
    pueda gastar el cupo de otra persona. La autorización completa ocurre después.
    """
    cabecera = cabeceras.get("authorization", "")
    if cabecera[:7].lower() == "bearer " and len(cabecera) <= 4096:
        try:
            datos = jwt.decode(
                cabecera[7:].strip(),
                config.JWT_SECRET,
                algorithms=["HS256"],
                issuer=EMISOR,
                audience=AUDIENCIA,
                options={"verify_exp": False},
            )
        except jwt.InvalidTokenError:
            return ip
        sujeto = datos.get("sub")
        if isinstance(sujeto, str) and sujeto.isdigit() and len(sujeto) <= 10:
            return f"usuario:{sujeto}"
    return ip


def ip_cliente(scope, cabeceras, saltos):
    """IP del cliente; con proxies de confianza toma la entrada que agregó el último proxy."""
    ip = scope.get("client", ("local", 0)) or ("local", 0)
    if not saltos:
        return ip[0]
    cadena = [
        direccion.strip()
        for direccion in cabeceras.get("x-forwarded-for", "").split(",")
        if direccion.strip()
    ]
    cadena.append(ip[0])
    return cadena[max(0, len(cadena) - 1 - saltos)]


class CorsXentinel(CORSMiddleware):
    def preflight_response(self, request_headers):
        respuesta = super().preflight_response(request_headers)
        if respuesta.status_code == 200:
            cabeceras = {
                nombre: valor
                for nombre, valor in respuesta.headers.items()
                if nombre not in ("content-length", "content-type")
            }
            return Response(status_code=204, headers=cabeceras)
        return respuesta


class ProteccionHTTP:
    def __init__(self, app, config):
        self.config = config
        self.app = CorsXentinel(
            app,
            allow_origins=config.origenes,
            allow_methods=METODOS,
            allow_headers=["Content-Type", "Authorization", "Last-Event-ID"],
            expose_headers=["X-Request-ID", "Retry-After"],
            max_age=600,
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        ruta, metodo = scope["path"], scope["method"]
        cabeceras = Headers(scope=scope)
        solicitud_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = solicitud_id
        origen = cabeceras.get("origin")
        respondido = False

        async def enviar(mensaje):
            nonlocal respondido
            if mensaje["type"] == "http.response.start":
                respondido = True
                salida = MutableHeaders(scope=mensaje)
                salida["X-Request-ID"] = solicitud_id
                salida.setdefault("Cache-Control", "no-store")
                salida["X-Content-Type-Options"] = "nosniff"
                salida["X-Frame-Options"] = "DENY"
                salida["Referrer-Policy"] = "no-referrer"
                politica = "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
                if ruta in ("/docs", "/docs/oauth2-redirect"):
                    politica += "; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com"
                else:
                    politica += "; form-action 'self'"
                if self.config.NODE_ENV == "production":
                    salida["Strict-Transport-Security"] = (
                        "max-age=31536000; includeSubDomains"
                    )
                    politica += "; upgrade-insecure-requests"
                salida["Content-Security-Policy"] = politica
                if origen in self.config.origenes:
                    salida.setdefault("Access-Control-Allow-Origin", origen)
                    salida.setdefault(
                        "Access-Control-Expose-Headers", "X-Request-ID, Retry-After"
                    )
                    if "origin" not in salida.get("vary", "").lower():
                        salida.add_vary_header("Origin")
            await send(mensaje)

        try:
            if origen and origen not in self.config.origenes:
                raise ErrorAPI(403, "CORS_DENIED", "Origen no autorizado")
            if (
                metodo != "OPTIONS"
                and not ruta.startswith("/recuperacion/")
                and ruta
                not in {
                    "/health",
                    "/ready",
                    "/restablecer-contrasena",
                    "/docs",
                    "/docs/oauth2-redirect",
                    "/openapi.json",
                }
            ):
                db = scope["app"].state.base
                ip = self.ip_cliente(scope, cabeceras)
                await run_in_threadpool(
                    contar_peticion,
                    db,
                    clave_limite(cabeceras, self.config, ip),
                    "api",
                    self.config.RATE_LIMIT_API_PER_MINUTE,
                    60,
                )
                if ruta in RUTAS_AUTH:
                    await run_in_threadpool(
                        contar_peticion,
                        db,
                        ip,
                        "auth",
                        self.config.RATE_LIMIT_AUTH_PER_15MIN,
                        900,
                    )
                if ruta in RUTAS_RESET:
                    await run_in_threadpool(contar_peticion, db, ip, "reset", 10, 900)
                if ruta == "/api/v1/alertas/sos" and metodo == "POST":
                    await run_in_threadpool(contar_peticion, db, ip, "sos", 30, 60)
            if metodo in ("POST", "PUT", "PATCH", "DELETE"):
                maximo = MAXIMO_FOTO if RUTA_FOTO.match(ruta) else MAXIMO_CUERPO
                receive = await self.limitar_cuerpo(cabeceras, receive, maximo)
            await self.app(scope, receive, enviar)
        except ErrorAPI as error:
            if respondido:
                raise
            await respuesta_error(scope, error)(scope, receive, enviar)
        except Exception as error:
            if respondido:
                raise
            await error_interno(scope, error)(scope, receive, enviar)

    def ip_cliente(self, scope, cabeceras):
        return ip_cliente(scope, cabeceras, self.config.TRUST_PROXY_HOPS)

    @staticmethod
    async def limitar_cuerpo(cabeceras, receive, maximo=MAXIMO_CUERPO):
        def demasiado_grande():
            return ErrorAPI(413, "PAYLOAD_TOO_LARGE", "Solicitud demasiado grande")

        longitud = cabeceras.get("content-length", "")
        if (
            longitud.isascii()
            and longitud.isdecimal()
            and (len(longitud) > 8 or int(longitud) > maximo)
        ):
            raise demasiado_grande()
        cuerpo = bytearray()
        while True:
            parte = await receive()
            if parte["type"] != "http.request":

                async def desconectado(evento=parte):
                    return evento

                return desconectado
            contenido = parte.get("body", b"")
            if len(cuerpo) + len(contenido) > maximo:
                raise demasiado_grande()
            cuerpo.extend(contenido)
            if not parte.get("more_body"):
                break
        enviado = False

        async def releer():
            nonlocal enviado
            if enviado:
                return await receive()
            enviado = True
            return {"type": "http.request", "body": bytes(cuerpo), "more_body": False}

        return releer

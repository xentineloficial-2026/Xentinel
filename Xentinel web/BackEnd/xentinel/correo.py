"""Cola de correo cifrada con reintentos coordinados en PostgreSQL (Brevo o SMTP).

Brevo envía por su API REST con una clave de API (``xkeysib-``) o por su relé SMTP en el
puerto 2525 con una clave SMTP (``xsmtpsib-``). Sin Brevo se usa el SMTP de ``SMTP_HOST``.
"""

import asyncio
import json
import logging
import os
import smtplib
import ssl
from base64 import b64decode, b64encode
from contextlib import contextmanager
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from html import escape
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from starlette.concurrency import run_in_threadpool

from .google import pedir_json

LOG = logging.getLogger(__name__)
# Último fallo de entrega en este proceso, para el diagnóstico de administración.
# Solo guarda el código y la causa técnica; nunca destinatarios, códigos ni secretos.
ULTIMO_FALLO = {}


class FalloCorreo(OSError):
    """Fallo de entrega con un código corto y la causa que informó el proveedor."""

    def __init__(self, codigo, detalle):
        super().__init__(f"{codigo}: {detalle}")
        self.codigo = codigo
        self.detalle = detalle


# Qué hacer ante las respuestas más comunes de la API de Brevo.
PISTAS_BREVO = (
    (
        "unrecognised IP",
        "en Brevo, Seguridad > IP autorizadas, desactiva el bloqueo de IP",
    ),
    ("Key not found", "BREVO_API_KEY debe ser una clave de API activa (xkeysib-)"),
    (
        "API Key is not enabled",
        "BREVO_API_KEY debe ser una clave de API activa (xkeysib-)",
    ),
    ("sender", "BREVO_SENDER_EMAIL debe ser un remitente verificado en Brevo"),
)


def causa_http(error):
    """Causa legible de una respuesta de Brevo, p. ej. «HTTP 401 unauthorized: Key not found»."""
    try:
        cuerpo = json.loads(error.read().decode("utf-8", "replace") or "{}")
    except (OSError, ValueError):
        cuerpo = {}
    if not isinstance(cuerpo, dict):
        cuerpo = {}
    texto = ": ".join(
        str(parte) for parte in (cuerpo.get("code"), cuerpo.get("message")) if parte
    )
    causa = f"HTTP {error.code} {texto}".strip()
    pista = next((p for clave, p in PISTAS_BREVO if clave.lower() in causa.lower()), "")
    return (f"{causa} ({pista})" if pista else causa)[:300]


def clasificar_fallo(error):
    """``(codigo, detalle)`` de cualquier error de envío, para registrarlo y mostrarlo."""
    if isinstance(error, FalloCorreo):
        return error.codigo, error.detalle
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return "SMTP_AUTH", (
            f"El servidor SMTP rechazó el usuario o la clave ({error.smtp_code}). Con "
            "Brevo, BREVO_SMTP_LOGIN es el usuario del relé (…@smtp-brevo.com) y "
            "BREVO_API_KEY la clave SMTP."
        )
    if isinstance(error, smtplib.SMTPSenderRefused):
        return "SMTP_SENDER", (
            "El servidor SMTP rechazó el remitente: en Brevo debe estar verificado."
        )
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "SMTP_RECIPIENT", "El servidor SMTP rechazó el destinatario."
    if isinstance(error, smtplib.SMTPException):
        return "SMTP_ERROR", f"{type(error).__name__}"[:300]
    if isinstance(error, TimeoutError):
        return "TIMEOUT", (
            "El servidor de correo no respondió a tiempo. En Render gratis los puertos "
            "25, 465 y 587 están bloqueados: el relé de Brevo usa el 2525."
        )
    if isinstance(error, (ConnectionError, URLError)):
        return (
            "CONNECTION",
            f"No se pudo conectar con el servidor de correo ({type(error).__name__}).",
        )
    if isinstance(error, OSError):
        return "NETWORK", f"Error de red al enviar el correo ({type(error).__name__})."
    return "INVALID_PAYLOAD", f"Mensaje de la cola ilegible ({type(error).__name__})."


def anotar_fallo(error):
    codigo, detalle = clasificar_fallo(error)
    ULTIMO_FALLO.clear()
    ULTIMO_FALLO.update(codigo=codigo, detalle=detalle, en=datetime.now(UTC))
    LOG.warning("Correo no entregado (%s): %s", codigo, detalle)
    return codigo


def cifrar_correo(datos, config):
    nonce = os.urandom(12)
    cifrado = AESGCM(bytes.fromhex(config.MAIL_ENCRYPTION_KEY)).encrypt(
        nonce, json.dumps(datos).encode(), None
    )
    # La cola existente almacena nonce.etiqueta.cifrado en base64.
    return ".".join(
        b64encode(parte).decode() for parte in (nonce, cifrado[-16:], cifrado[:-16])
    )


def descifrar_correo(valor, config):
    nonce, etiqueta, cifrado = (
        b64decode(parte, validate=True) for parte in valor.split(".")
    )
    return json.loads(
        AESGCM(bytes.fromhex(config.MAIL_ENCRYPTION_KEY)).decrypt(
            nonce, cifrado + etiqueta, None
        )
    )


def servidor_smtp(config):
    """``(host, puerto, segura, usuario, clave)``: el relé de Brevo o el SMTP propio."""
    if config.brevo == "smtp":
        if not config.BREVO_SMTP_LOGIN:
            raise FalloCorreo(
                "BREVO_CONFIG",
                "Falta BREVO_SMTP_LOGIN, el usuario del relé SMTP de Brevo "
                "(…@smtp-brevo.com).",
            )
        return (
            config.BREVO_SMTP_HOST,
            config.BREVO_SMTP_PORT,
            "false",
            config.BREVO_SMTP_LOGIN,
            config.BREVO_API_KEY,
        )
    return (
        config.SMTP_HOST,
        config.SMTP_PORT,
        config.SMTP_SECURE,
        config.SMTP_USER,
        config.SMTP_PASS,
    )


@contextmanager
def conectar_smtp(config):
    host, puerto, segura, usuario, clave = servidor_smtp(config)
    tls = ssl.create_default_context()
    conexion = (
        smtplib.SMTP_SSL(host, puerto, timeout=10, context=tls)
        if segura == "true"
        else smtplib.SMTP(host, puerto, timeout=10)
    )
    with conexion:
        conexion.ehlo_or_helo_if_needed()
        # En producción la conexión siempre se cifra con STARTTLS antes de autenticar.
        if segura == "false" and (
            config.NODE_ENV == "production" or conexion.has_extn("starttls")
        ):
            conexion.starttls(context=tls)
            conexion.ehlo()
        if usuario:
            conexion.login(usuario, clave)
        yield conexion


# Plantilla clara con la paleta de Xentinel: se lee igual en webmail, Outlook y el celular.
FUENTE = "Arial,Helvetica,sans-serif"
PLANTILLA_HTML = """<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>{titulo}</title></head>
<body style="margin:0;padding:0;background:#eef1f0;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{resumen}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f0">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td style="padding:0 4px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:10px"><img src="{logo}" width="32" height="32" alt=""
 style="display:block;border:0;border-radius:8px"></td>
<td style="font-family:{fuente};font-size:18px;font-weight:bold;color:#06141b">Xentinel</td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid #ccd0cf;border-radius:16px;padding:32px">
<h1 style="margin:0 0 8px;font-family:{fuente};font-size:22px;line-height:28px;color:#06141b">{titulo}</h1>
<p style="margin:0;font-family:{fuente};font-size:15px;line-height:22px;color:#4a5c6a">{indicacion}</p>
{codigo}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0">
<tr><td style="background:#11212d;border-radius:10px">
<a href="{enlace}" style="display:inline-block;padding:12px 22px;font-family:{fuente};font-size:15px;
 font-weight:bold;color:#f2f4f3;text-decoration:none">Abrir Xentinel</a></td></tr></table>
<p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #e2e6e5;font-family:{fuente};
 font-size:13px;line-height:20px;color:#4a5c6a">{seguridad}</p>
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:{fuente};font-size:12px;line-height:18px;color:#4a5c6a">
Xentinel, gestión y control de acceso del SENA, sede Fontibón.</td></tr>
</table></td></tr></table></body></html>"""

BLOQUE_CODIGO = """<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
 style="margin:24px 0 8px"><tr><td align="center" style="background:#eef1f0;border-radius:12px;
 padding:20px 12px;font-family:'Courier New',Courier,monospace;font-size:34px;line-height:40px;
 font-weight:bold;letter-spacing:10px;color:#06141b">{codigo}</td></tr></table>
<p style="margin:0;font-family:{fuente};font-size:13px;line-height:20px;color:#4a5c6a;text-align:center">
Vence en {minutos} minutos y solo funciona una vez.</p>"""


def origen_web(config):
    partes = urlsplit(config.RESET_PASSWORD_URL)
    return f"{partes.scheme}://{partes.netloc}"


def html_correo(config, *, titulo, indicacion, seguridad, enlace, resumen, codigo=None):
    bloque = (
        BLOQUE_CODIGO.format(
            codigo=escape(codigo), minutos=config.RESET_TTL_MINUTES, fuente=FUENTE
        )
        if codigo
        else ""
    )
    return PLANTILLA_HTML.format(
        titulo=escape(titulo),
        indicacion=escape(indicacion),
        seguridad=escape(seguridad),
        enlace=escape(enlace, quote=True),
        resumen=escape(resumen),
        logo=escape(f"{origen_web(config)}/favicon-xentinel.png", quote=True),
        codigo=bloque,
        fuente=FUENTE,
    )


# tipo de código: (asunto, título, indicación, qué no cambia si se ignora)
TEXTOS = {
    "recuperacion": (
        "{codigo} es tu código de recuperación de Xentinel",
        "Tu código de recuperación",
        "Escríbelo en la app o en la web para crear una nueva contraseña.",
        "tu contraseña no cambia.",
    ),
    "cambio_correo": (
        "{codigo} es tu código para confirmar tu correo en Xentinel",
        "Confirma tu nuevo correo",
        "Escríbelo en tu perfil de Xentinel para usar esta dirección en tu cuenta.",
        "tu cuenta no cambia.",
    ),
}


def remitente(config):
    """``From`` del correo, p. ej. «Xentinel <cuenta>», o ``None`` si no hay uno real.

    Con Brevo es el remitente verificado (``BREVO_SENDER_EMAIL``); si falta, se toma la
    dirección de ``SMTP_FROM``. Una dirección de ejemplo nunca se usa como remitente.
    """
    nombre, direccion = parseaddr(config.SMTP_FROM)
    if config.brevo:
        nombre = config.BREVO_SENDER_NAME or nombre
        direccion = config.BREVO_SENDER_EMAIL or direccion
    if not direccion or direccion.lower().endswith("@example.com"):
        return None
    return formataddr((nombre or "Xentinel", direccion))


def mensaje_codigo(datos, config):
    """Correo con un código de 6 dígitos: recuperación de contraseña o cambio de correo."""
    asunto, titulo, indicacion, sin_cambios = TEXTOS[datos.get("tipo", "recuperacion")]
    seguridad = (
        f"Si no lo pediste, ignora este correo: {sin_cambios} "
        "Nadie de Xentinel te pedirá este código."
    )
    mensaje = EmailMessage()
    if remitente(config):
        mensaje["From"] = remitente(config)
    mensaje["To"] = datos["to"]
    mensaje["Subject"] = asunto.format(codigo=datos["codigo"])
    mensaje.set_content(
        f"{titulo}:\n\n"
        f"    {datos['codigo']}\n\n"
        f"Vence en {config.RESET_TTL_MINUTES} minutos y solo funciona una vez. "
        f"{indicacion} {datos['link']}\n\n{seguridad}\n\nXentinel · SENA"
    )
    mensaje.add_alternative(
        html_correo(
            config,
            titulo=titulo,
            indicacion=indicacion,
            seguridad=seguridad,
            enlace=datos["link"],
            resumen=f"Tu código es {datos['codigo']}. Vence en "
            f"{config.RESET_TTL_MINUTES} minutos.",
            codigo=datos["codigo"],
        ),
        subtype="html",
    )
    return mensaje


# Nombre anterior, conservado para scripts y pruebas existentes.
mensaje_recuperacion = mensaje_codigo


def mensaje_prueba(destino, config):
    indicacion = (
        "Si lo recibiste, Xentinel ya puede enviar los códigos de recuperación de "
        "contraseña y de cambio de correo."
    )
    mensaje = EmailMessage()
    if remitente(config):
        mensaje["From"] = remitente(config)
    mensaje["To"] = destino
    mensaje["Subject"] = "Prueba de correo de Xentinel"
    mensaje.set_content(f"Este es un correo de prueba de Xentinel.\n\n{indicacion}")
    mensaje.add_alternative(
        html_correo(
            config,
            titulo="Correo de prueba",
            indicacion=indicacion,
            seguridad="Lo envió administración desde el diagnóstico de correo.",
            enlace=origen_web(config),
            resumen="El correo de Xentinel funciona.",
        ),
        subtype="html",
    )
    return mensaje


def carga_brevo(mensaje, config):
    """Cuerpo de ``POST /v3/smtp/email`` a partir del mensaje ya armado."""
    nombre, correo = parseaddr(remitente(config) or "")
    if not correo:
        raise FalloCorreo(
            "BREVO_CONFIG",
            "Falta BREVO_SENDER_EMAIL, el remitente verificado en Brevo.",
        )
    carga = {
        "sender": {"name": nombre or "Xentinel", "email": correo},
        "to": [{"email": parseaddr(mensaje["To"])[1]}],
        "subject": str(mensaje["Subject"]),
    }
    for clave, tipo in (("textContent", "plain"), ("htmlContent", "html")):
        parte = mensaje.get_body(preferencelist=(tipo,))
        if parte is not None and parte.get_content_type() == f"text/{tipo}":
            carga[clave] = parte.get_content()
    return carga


def llamar_brevo(config, ruta, cuerpo=None):
    """Llama a la API de Brevo con la cabecera ``api-key``. Los errores son ``FalloCorreo``."""
    try:
        return pedir_json(
            f"{config.BREVO_API_URL.rstrip('/')}{ruta}",
            cuerpo=cuerpo,
            cabeceras={"api-key": config.BREVO_API_KEY, "accept": "application/json"},
        )
    except HTTPError as error:
        codigo = "BREVO_AUTH" if error.code in (401, 403) else "BREVO_SEND"
        raise FalloCorreo(codigo, causa_http(error)) from None
    except ValueError:
        raise FalloCorreo("BREVO_SEND", "Brevo respondió algo que no es JSON") from None


def enviar_brevo(mensaje, config):
    """Envía por la API REST de Brevo y devuelve el ``messageId`` que confirma (201)."""
    respuesta = llamar_brevo(config, "/v3/smtp/email", carga_brevo(mensaje, config))
    if not isinstance(respuesta, dict) or not respuesta.get("messageId"):
        raise FalloCorreo(
            "BREVO_SEND", "Brevo no confirmó el envío: respuesta sin messageId"
        )
    return respuesta["messageId"]


def transporte(config):
    if config.brevo:
        return f"brevo-{config.brevo}"
    return "smtp" if config.SMTP_HOST else None


def entregar(mensaje, config):
    if config.brevo == "api":
        enviar_brevo(mensaje, config)
        return
    if config.brevo and not remitente(config):
        raise FalloCorreo(
            "BREVO_CONFIG",
            "Falta BREVO_SENDER_EMAIL, el remitente verificado en Brevo.",
        )
    with conectar_smtp(config) as smtp:
        smtp.send_message(mensaje)


def enviar_correo(datos, config):
    entregar(mensaje_codigo(datos, config), config)


def enviar_prueba(destino, config):
    """Envía un correo de prueba ahora mismo. Lanza ``FalloCorreo`` con la causa exacta."""
    try:
        entregar(mensaje_prueba(destino, config), config)
    except (OSError, ValueError, KeyError) as error:
        codigo, detalle = clasificar_fallo(error)
        anotar_fallo(error)
        raise FalloCorreo(codigo, detalle) from None
    ULTIMO_FALLO.clear()


def verificar_correo(config):
    """Comprueba el transporte al iniciar sin enviar nada; un fallo no tumba la API."""
    try:
        if config.brevo == "api":
            # Valida la clave sin gastar envíos del plan.
            llamar_brevo(config, "/v3/account")
        else:
            with conectar_smtp(config):
                pass
        if config.brevo and not remitente(config):
            raise FalloCorreo(
                "BREVO_CONFIG",
                "Falta BREVO_SENDER_EMAIL, el remitente verificado en Brevo.",
            )
    except (OSError, KeyError, ValueError) as error:
        codigo = anotar_fallo(error)
        LOG.error(
            "Correo no disponible (%s); los mensajes quedan en cola. Pruébalo con "
            "python -m xentinel probar-correo <destino>",
            codigo,
        )
    else:
        # Nivel warning: sin configuración de logging, el registro solo muestra desde él.
        LOG.warning("Correo listo por %s", transporte(config))


def procesar_correo(base, config, enviar=enviar_correo):
    with base.transaccion() as db:
        pendiente = db.fila("""SELECT m.*,t.usado_en,t.token_expiracion FROM mail_outbox m
            JOIN password_reset_tokens t USING(id_token)
            WHERE m.enviado_en IS NULL AND m.intentos<5 AND m.siguiente_intento<=now()
            ORDER BY m.id_mail LIMIT 1 FOR UPDATE OF m SKIP LOCKED""")
        if not pendiente:
            return
        identificador = pendiente["id_mail"]
        if pendiente["usado_en"] or pendiente["token_expiracion"] <= datetime.now(UTC):
            db.ejecutar(
                """UPDATE mail_outbox SET payload_encrypted=NULL,enviado_en=now(),
                error_codigo='TOKEN_INACTIVE' WHERE id_mail=%s""",
                identificador,
            )
            return
        try:
            enviar(descifrar_correo(pendiente["payload_encrypted"], config), config)
        except (OSError, InvalidTag, ValueError, TypeError, KeyError) as error:
            db.ejecutar(
                """UPDATE mail_outbox SET intentos=intentos+1,error_codigo=%s,
                siguiente_intento=now()+make_interval(secs=>60*(intentos+1)),
                payload_encrypted=CASE WHEN intentos>=4 THEN NULL ELSE payload_encrypted END WHERE id_mail=%s""",
                anotar_fallo(error)[:50],
                identificador,
            )
        else:
            ULTIMO_FALLO.clear()
            db.ejecutar(
                """UPDATE mail_outbox SET enviado_en=now(),payload_encrypted=NULL,error_codigo=NULL
                WHERE id_mail=%s""",
                identificador,
            )


async def mantener(intervalo, trabajo, *argumentos):
    while True:
        await asyncio.sleep(intervalo)
        try:
            await run_in_threadpool(trabajo, *argumentos)
        except Exception:  # noqa: BLE001 - mantiene viva la tarea sin registrar datos sensibles.
            LOG.error("Falló la tarea de mantenimiento %s", trabajo.__name__)

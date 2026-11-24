"""Cola de correo cifrada con reintentos coordinados en PostgreSQL (SMTP o Gmail API)."""

import asyncio
import json
import logging
import os
import smtplib
import ssl
from base64 import b64decode, b64encode, urlsafe_b64encode
from contextlib import contextmanager
from datetime import UTC, datetime
from email.message import EmailMessage
from html import escape
from urllib.error import HTTPError, URLError

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from starlette.concurrency import run_in_threadpool

from .google import pedir_json, token_gmail

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


def causa_http(error):
    """Causa legible de una respuesta de Google, p. ej. «invalid_grant: Token has been expired»."""
    try:
        cuerpo = json.loads(error.read().decode("utf-8", "replace") or "{}")
    except (OSError, ValueError):
        cuerpo = {}
    falla = cuerpo.get("error")
    if isinstance(falla, dict):
        texto = falla.get("message") or falla.get("status") or ""
    else:
        texto = ": ".join(
            parte for parte in (falla, cuerpo.get("error_description")) if parte
        )
    return f"HTTP {error.code} {texto}".strip()[:300]


def clasificar_fallo(error):
    """``(codigo, detalle)`` de cualquier error de envío, para registrarlo y mostrarlo."""
    if isinstance(error, FalloCorreo):
        return error.codigo, error.detalle
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return "SMTP_AUTH", (
            f"El servidor SMTP rechazó el usuario o la contraseña ({error.smtp_code}). "
            "Con Gmail se necesita una contraseña de aplicación."
        )
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "SMTP_RECIPIENT", "El servidor SMTP rechazó el destinatario."
    if isinstance(error, smtplib.SMTPException):
        return "SMTP_ERROR", f"{type(error).__name__}"[:300]
    if isinstance(error, TimeoutError):
        return "TIMEOUT", (
            "El servidor de correo no respondió a tiempo. En Render gratis los puertos "
            "SMTP están bloqueados: usa Gmail API."
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


@contextmanager
def conectar_smtp(config):
    tls = ssl.create_default_context()
    conexion = (
        smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=5, context=tls)
        if config.SMTP_SECURE == "true"
        else smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=5)
    )
    with conexion:
        conexion.ehlo_or_helo_if_needed()
        if config.SMTP_SECURE == "false" and (
            config.NODE_ENV == "production" or conexion.has_extn("starttls")
        ):
            conexion.starttls(context=tls)
            conexion.ehlo()
        if config.SMTP_USER:
            conexion.login(config.SMTP_USER, config.SMTP_PASS)
        yield conexion


PLANTILLA_HTML = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
<title>{titulo} · Xentinel</title></head>
<body style="margin:0;padding:0;background:#06141b;color:#edf0ef;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06141b">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="max-width:520px;background:#0d1d27;border:1px solid #1a2e3b;border-radius:16px">
<tr><td style="padding:32px 32px 8px">
<p style="margin:0;font-size:13px;letter-spacing:3px;color:#9ba8ab">XENTINEL · SENA</p>
<h1 style="margin:16px 0 8px;font-size:24px;color:#edf0ef">{titulo}</h1>
<p style="margin:0;font-size:15px;line-height:22px;color:#9ba8ab">
{indicacion}</p>
</td></tr>
<tr><td style="padding:24px 32px" align="center">
<div style="display:inline-block;padding:16px 24px;border:1px solid #4a5c6a;border-radius:12px;
 background:#06141b;font-family:'Courier New',monospace;font-size:36px;font-weight:bold;
 letter-spacing:10px;color:#edf0ef">{codigo}</div>
<p style="margin:16px 0 0;font-size:14px;color:#9ba8ab">Vence en {minutos} minutos y solo funciona una vez.</p>
</td></tr>
<tr><td style="padding:0 32px 24px" align="center">
<a href="{enlace}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#edf0ef;
 color:#06141b;font-size:15px;font-weight:bold;text-decoration:none">Abrir Xentinel</a>
</td></tr>
<tr><td style="padding:16px 32px 32px;border-top:1px solid #1a2e3b">
<p style="margin:0;font-size:13px;line-height:20px;color:#9ba8ab">
Si no lo solicitaste, ignora este correo: {sin_cambios} Nadie de Xentinel te pedirá este código.</p>
</td></tr></table></td></tr></table></body></html>"""


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
    """Con Gmail API, un remitente de ejemplo se omite y Gmail usa la cuenta autorizada."""
    if config.gmail and config.SMTP_FROM.lower().rstrip("> ").endswith("@example.com"):
        return None
    return config.SMTP_FROM


def mensaje_codigo(datos, config):
    """Correo con un código de 6 dígitos: recuperación de contraseña o cambio de correo."""
    asunto, titulo, indicacion, sin_cambios = TEXTOS[datos.get("tipo", "recuperacion")]
    mensaje = EmailMessage()
    if remitente(config):
        mensaje["From"] = remitente(config)
    mensaje["To"] = datos["to"]
    mensaje["Subject"] = asunto.format(codigo=datos["codigo"])
    mensaje.set_content(
        f"{titulo}:\n\n"
        f"    {datos['codigo']}\n\n"
        f"Vence en {config.RESET_TTL_MINUTES} minutos y solo funciona una vez. "
        f"{indicacion} {datos['link']}\n\n"
        f"Si no lo solicitaste, ignora este correo: {sin_cambios} "
        "Nadie de Xentinel te pedirá este código.\n\nXentinel · SENA"
    )
    mensaje.add_alternative(
        PLANTILLA_HTML.format(
            titulo=escape(titulo),
            indicacion=escape(indicacion),
            sin_cambios=escape(sin_cambios),
            codigo=escape(datos["codigo"]),
            minutos=config.RESET_TTL_MINUTES,
            enlace=escape(datos["link"], quote=True),
        ),
        subtype="html",
    )
    return mensaje


# Nombre anterior, conservado para scripts y pruebas existentes.
mensaje_recuperacion = mensaje_codigo


def mensaje_prueba(destino, config):
    mensaje = EmailMessage()
    if remitente(config):
        mensaje["From"] = remitente(config)
    mensaje["To"] = destino
    mensaje["Subject"] = "Prueba de correo de Xentinel"
    mensaje.set_content(
        "Este es un correo de prueba de Xentinel.\n\n"
        "Si lo recibiste, el servidor ya puede enviar los códigos de recuperación de "
        "contraseña y de cambio de correo.\n\nXentinel · SENA"
    )
    return mensaje


def enviar_gmail(mensaje, config):
    try:
        token = token_gmail(config)
    except HTTPError as error:
        # invalid_grant: el refresh token venció o se revocó (en modo de prueba dura 7 días).
        raise FalloCorreo("GMAIL_AUTH", causa_http(error)) from None
    try:
        pedir_json(
            f"{config.GMAIL_API_URL.rstrip('/')}/gmail/v1/users/me/messages/send",
            cuerpo={"raw": urlsafe_b64encode(mensaje.as_bytes()).decode()},
            token=token,
        )
    except HTTPError as error:
        raise FalloCorreo("GMAIL_SEND", causa_http(error)) from None


def transporte(config):
    return "gmail" if config.gmail else "smtp" if config.SMTP_HOST else None


def entregar(mensaje, config):
    if config.gmail:
        enviar_gmail(mensaje, config)
        return
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
    """Comprueba el transporte al iniciar; un fallo no tumba la API (la cola reintenta)."""
    try:
        if config.gmail:
            try:
                token_gmail(config)
            except HTTPError as error:
                raise FalloCorreo("GMAIL_AUTH", causa_http(error)) from None
        else:
            with conectar_smtp(config):
                pass
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

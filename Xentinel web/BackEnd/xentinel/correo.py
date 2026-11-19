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

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from starlette.concurrency import run_in_threadpool

from .google import pedir_json, token_gmail

LOG = logging.getLogger(__name__)


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
<title>Código de recuperación de Xentinel</title></head>
<body style="margin:0;padding:0;background:#06141b;color:#edf0ef;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06141b">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="max-width:520px;background:#0d1d27;border:1px solid #1a2e3b;border-radius:16px">
<tr><td style="padding:32px 32px 8px">
<p style="margin:0;font-size:13px;letter-spacing:3px;color:#9ba8ab">XENTINEL · SENA</p>
<h1 style="margin:16px 0 8px;font-size:24px;color:#edf0ef">Tu código de recuperación</h1>
<p style="margin:0;font-size:15px;line-height:22px;color:#9ba8ab">
Escríbelo en la app o en la web para crear una nueva contraseña.</p>
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
Si no lo solicitaste, ignora este correo: tu contraseña no cambia. Nadie de Xentinel te pedirá este código.</p>
</td></tr></table></td></tr></table></body></html>"""


def mensaje_recuperacion(datos, config):
    mensaje = EmailMessage()
    mensaje["From"] = config.SMTP_FROM
    mensaje["To"] = datos["to"]
    mensaje["Subject"] = f"{datos['codigo']} es tu código de recuperación de Xentinel"
    mensaje.set_content(
        "Tu código para restablecer la contraseña de Xentinel es:\n\n"
        f"    {datos['codigo']}\n\n"
        f"Vence en {config.RESET_TTL_MINUTES} minutos y solo funciona una vez. "
        f"Escríbelo en la app o en la web: {datos['link']}\n\n"
        "Si no lo solicitaste, ignora este correo: tu contraseña no cambia. "
        "Nadie de Xentinel te pedirá este código.\n\nXentinel · SENA"
    )
    mensaje.add_alternative(
        PLANTILLA_HTML.format(
            codigo=escape(datos["codigo"]),
            minutos=config.RESET_TTL_MINUTES,
            enlace=escape(datos["link"], quote=True),
        ),
        subtype="html",
    )
    return mensaje


def enviar_gmail(mensaje, config):
    pedir_json(
        f"{config.GMAIL_API_URL.rstrip('/')}/gmail/v1/users/me/messages/send",
        cuerpo={"raw": urlsafe_b64encode(mensaje.as_bytes()).decode()},
        token=token_gmail(config),
    )


def enviar_correo(datos, config):
    mensaje = mensaje_recuperacion(datos, config)
    if config.gmail:
        enviar_gmail(mensaje, config)
        return
    with conectar_smtp(config) as smtp:
        smtp.send_message(mensaje)


def verificar_correo(config):
    """Comprueba el transporte al iniciar; un fallo no tumba la API (la cola reintenta)."""
    try:
        if config.gmail:
            token_gmail(config)
        else:
            with conectar_smtp(config):
                pass
    except (OSError, KeyError, ValueError) as error:
        LOG.error(
            "Correo no disponible (%s); los mensajes quedan en cola",
            type(error).__name__,
        )


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
        except (OSError, InvalidTag, ValueError, TypeError, KeyError):
            db.ejecutar(
                """UPDATE mail_outbox SET intentos=intentos+1,error_codigo='SMTP_DELIVERY_FAILED',
                siguiente_intento=now()+make_interval(secs=>60*(intentos+1)),
                payload_encrypted=CASE WHEN intentos>=4 THEN NULL ELSE payload_encrypted END WHERE id_mail=%s""",
                identificador,
            )
            LOG.warning("SMTP_DELIVERY_FAILED")
        else:
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

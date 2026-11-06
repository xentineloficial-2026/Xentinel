"""Cola SMTP con cifrado compatible y reintentos coordinados en PostgreSQL."""

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

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from starlette.concurrency import run_in_threadpool

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


def enviar_correo(datos, config):
    mensaje = EmailMessage()
    mensaje["From"] = config.SMTP_FROM
    mensaje["To"] = datos["to"]
    mensaje["Subject"] = "Restablecer contraseña de Xentinel"
    mensaje.set_content(
        f"Se solicitó restablecer tu contraseña de Xentinel. El enlace vence en {config.RESET_TTL_MINUTES} "
        f"minutos y sólo se puede usar una vez.\n\n{datos['link']}\n\nSi no lo solicitaste, ignora este correo."
    )
    with conectar_smtp(config) as smtp:
        smtp.send_message(mensaje)


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

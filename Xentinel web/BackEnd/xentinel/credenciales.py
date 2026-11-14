"""Carnet QR rotativo firmado (formato XN2) que el servidor verifica sin depender del reloj del lector.

Formato: ``XN2:<id_usuarios>:<paso>:<firma>``

- ``paso`` es ``floor(unix_segundos / 15)``: el código cambia cada 15 segundos.
- ``firma`` son los primeros 20 caracteres Base32 (100 bits) de
  ``HMAC-SHA256(clave_usuario, "XN2:<id>:<paso>")``.
- ``clave_usuario = HMAC-SHA256(secreto_qr, "XN2|<id>|<auth_version>")``: cerrar sesión,
  cambiar la contraseña o desactivar la cuenta incrementa ``auth_version`` y revoca
  automáticamente los carnets emitidos, también los guardados para uso sin conexión.

Todos los caracteres pertenecen al modo alfanumérico de QR (dígitos, A-Z y ``:``), así el
código queda en una versión 3 (29×29 módulos) con corrección Q: grande y robusto para
leerlo de pantalla a pantalla entre dos teléfonos.
"""

import base64
import hashlib
import hmac
import re

from .http import ErrorAPI

PREFIJO = "XN2"
PASO_SEGUNDOS = 15
# ±3 pasos (≈45 s) absorben la diferencia de reloj entre el carnet y el servidor.
VENTANA_PASOS = 3
PATRON = re.compile(r"XN2:([1-9][0-9]{0,9}):([0-9]{1,12}):([A-Z2-7]{20})")
# Clave ficticia: un identificador inexistente cuesta lo mismo que uno real.
CLAVE_FICTICIA = hashlib.sha256(b"xentinel-qr-clave-ficticia").digest()


def secreto_qr(config):
    if config.QR_SECRET:
        return config.QR_SECRET.encode()
    # Separación de dominio: la clave de QR nunca firma JWT ni viceversa.
    return hmac.new(
        config.JWT_SECRET.encode(), b"xentinel-qr-v2", hashlib.sha256
    ).digest()


def clave_usuario(config, identificador, auth_version):
    return hmac.new(
        secreto_qr(config),
        f"{PREFIJO}|{identificador}|{auth_version}".encode(),
        hashlib.sha256,
    ).digest()


def firmar(clave, identificador, paso):
    mac = hmac.new(
        clave, f"{PREFIJO}:{identificador}:{paso}".encode(), hashlib.sha256
    ).digest()
    return base64.b32encode(mac).decode()[:20]


def generar(clave, identificador, paso):
    return f"{PREFIJO}:{identificador}:{paso}:{firmar(clave, identificador, paso)}"


def paso_de(epoch_segundos):
    return int(epoch_segundos // PASO_SEGUNDOS)


def codificar_clave(clave):
    return base64.urlsafe_b64encode(clave).decode().rstrip("=")


def es_codigo_firmado(texto):
    return isinstance(texto, str) and texto.startswith(f"{PREFIJO}:")


def qr_invalido():
    return ErrorAPI(
        422, "INVALID_QR", "El código QR no es un carnet válido de Xentinel"
    )


def verificar_firma(conexion, config, codigo):
    """Devuelve ``(id_usuarios, paso)`` si la firma es auténtica; no evalúa la vigencia."""
    partes = PATRON.fullmatch(codigo.strip())
    if not partes:
        raise qr_invalido()
    identificador, paso, recibida = int(partes[1]), int(partes[2]), partes[3]
    if identificador > 2147483647:
        raise qr_invalido()
    usuario = conexion.fila(
        "SELECT auth_version FROM usuarios WHERE id_usuarios=%s", identificador
    )
    clave = (
        clave_usuario(config, identificador, usuario["auth_version"])
        if usuario
        else CLAVE_FICTICIA
    )
    if (
        not hmac.compare_digest(firmar(clave, identificador, paso), recibida)
        or not usuario
    ):
        raise qr_invalido()
    return identificador, paso


def comprobar_vigencia(paso, referencia_epoch):
    if abs(paso - paso_de(referencia_epoch)) > VENTANA_PASOS:
        raise ErrorAPI(
            422,
            "QR_EXPIRED",
            "El carnet QR venció; pide que lo actualicen en la app y escanea de nuevo",
        )

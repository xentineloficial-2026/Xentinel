"""Llamadas HTTPS sin SDK adicionales: Firebase Cloud Messaging, USGS y Brevo."""

import json
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import jwt

ALCANCE_FCM = "https://www.googleapis.com/auth/firebase.messaging"


def pedir_json(url, *, formulario=None, cuerpo=None, token=None, cabeceras=None):
    """POST de formulario o JSON (o GET sin cuerpo). Los errores HTTP son OSError."""
    datos, tipo = None, None
    if formulario is not None:
        datos, tipo = (
            urlencode(formulario).encode(),
            "application/x-www-form-urlencoded",
        )
    elif cuerpo is not None:
        datos, tipo = json.dumps(cuerpo).encode(), "application/json"
    peticion = Request(url, data=datos, method="POST" if datos else "GET")
    if tipo:
        peticion.add_header("Content-Type", tipo)
    if token:
        peticion.add_header("Authorization", f"Bearer {token}")
    for nombre, valor in (cabeceras or {}).items():
        peticion.add_header(nombre, valor)
    with urlopen(peticion, timeout=10) as respuesta:
        contenido = respuesta.read()
    return json.loads(contenido) if contenido else {}


class TokenTemporal:
    """Token OAuth en memoria, renovado un minuto antes de vencer."""

    def __init__(self):
        self.candado = threading.Lock()
        self.valor = None
        self.vence = 0.0
        self.huella = None

    def obtener(self, huella, pedir):
        with self.candado:
            if self.valor and self.huella == huella and time.time() < self.vence - 60:
                return self.valor
            respuesta = pedir()
            valor = (
                respuesta.get("access_token") if isinstance(respuesta, dict) else None
            )
            if not valor:
                raise ValueError("Google respondió sin access_token")
            self.valor = valor
            self.vence = time.time() + int(respuesta.get("expires_in", 3600))
            self.huella = huella
            return self.valor


TOKEN_FIREBASE = TokenTemporal()


def token_firebase(cuenta):
    """Token de la cuenta de servicio: aserción JWT RS256 firmada con su clave privada."""
    destino = cuenta.get("token_uri") or "https://oauth2.googleapis.com/token"

    def pedir():
        ahora = int(time.time())
        asercion = jwt.encode(
            {
                "iss": cuenta["client_email"],
                "scope": ALCANCE_FCM,
                "aud": destino,
                "iat": ahora,
                "exp": ahora + 3600,
            },
            cuenta["private_key"],
            algorithm="RS256",
            headers={"kid": cuenta.get("private_key_id", "")},
        )
        return pedir_json(
            destino,
            formulario={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": asercion,
            },
        )

    return TOKEN_FIREBASE.obtener((cuenta["client_email"], destino), pedir)

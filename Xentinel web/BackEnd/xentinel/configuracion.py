"""Configuración compartida con la instalación existente de Xentinel."""

import json
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import (
    BaseModel,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

RAIZ = Path(__file__).resolve().parents[1]


class Configuracion(BaseModel):
    NODE_ENV: Literal["development", "test", "production"] = "development"
    HOST: str = "0.0.0.0"
    PORT: int = Field(default=8000, ge=1, le=65535)
    DATABASE_URL: str = Field(repr=False)
    # El pooler de Supabase en modo sesión reserva una conexión del servidor por cliente:
    # el máximo debe quedar por debajo de su "pool size" (15 en el plan gratuito).
    DB_POOL_MAX: int = Field(default=15, ge=2, le=100)
    JWT_SECRET: str = Field(min_length=64, repr=False)
    MAIL_ENCRYPTION_KEY: str = Field(pattern=r"^[a-fA-F0-9]{64}$", repr=False)
    JWT_TTL_SECONDS: int = Field(default=900, ge=60, le=3600)
    # Vigencia del código de recuperación de 6 dígitos.
    RESET_TTL_MINUTES: int = Field(default=15, ge=5, le=60)
    # Zona de la sede: la fecha y la hora de asistencia son locales, no UTC.
    ZONA_HORARIA: str = "America/Bogota"
    WEB_ORIGINS: str
    RESET_PASSWORD_URL: str
    TRUST_PROXY_HOPS: int = Field(default=0, ge=0, le=5)
    SMTP_HOST: str = ""
    SMTP_PORT: int = Field(default=587, ge=1, le=65535)
    SMTP_SECURE: Literal["true", "false"] = "false"
    SMTP_USER: str = ""
    SMTP_PASS: str = Field(default="", repr=False)
    SMTP_FROM: str = "Xentinel <no-reply@example.com>"
    # Brevo: con BREVO_API_KEY definido reemplaza a SMTP. Una clave de API (xkeysib-)
    # envía por la API REST (HTTPS); una clave SMTP (xsmtpsib-) envía por el relé de
    # Brevo en el puerto 2525, que Render gratis no bloquea, con el usuario del relé.
    BREVO_API_KEY: str = Field(default="", repr=False)
    BREVO_SENDER_EMAIL: str = ""
    BREVO_SENDER_NAME: str = "Xentinel"
    BREVO_SMTP_LOGIN: str = ""
    BREVO_SMTP_HOST: str = "smtp-relay.brevo.com"
    BREVO_SMTP_PORT: int = Field(default=2525, ge=1, le=65535)
    BREVO_API_URL: str = "https://api.brevo.com"
    # Carnet QR rotativo firmado (XN2). Sin valor se deriva de JWT_SECRET con separación
    # de dominio; defínalo para rotar las credenciales QR sin cerrar las sesiones.
    QR_SECRET: str = Field(default="", repr=False)
    # true: el método QR solo acepta carnets firmados (rechaza los formatos heredados).
    QR_REQUIRE_SIGNED: Literal["true", "false"] = "false"
    # Duración máxima de una sesión renovada sin volver a ingresar la contraseña.
    SESSION_MAX_HOURS: int = Field(default=12, ge=1, le=24)
    # Límites. En la nube, todos los teléfonos de la sede suelen salir por una sola IP
    # (NAT): el límite general se aplica por persona autenticada y el de inicio de
    # sesión también por cuenta, así puede elevarse el de IP sin abrir fuerza bruta.
    RATE_LIMIT_API_PER_MINUTE: int = Field(default=600, ge=60, le=100000)
    RATE_LIMIT_AUTH_PER_15MIN: int = Field(default=20, ge=5, le=100000)
    RATE_LIMIT_LOGIN_PER_ACCOUNT: int = Field(default=10, ge=3, le=1000)
    # Monitor sísmico: EMSC por WebSocket en tiempo real y USGS como respaldo, con centro
    # en la sede. Solo genera alertas dentro del radio y desde la magnitud mínima.
    SEISMIC_ENABLED: Literal["true", "false"] = "false"
    SEISMIC_LAT: float = Field(default=4.6097, ge=-90, le=90)
    SEISMIC_LON: float = Field(default=-74.0817, ge=-180, le=180)
    SEISMIC_RADIUS_KM: float = Field(default=500, gt=0, le=20000)
    SEISMIC_MIN_MAGNITUDE: float = Field(default=4.0, ge=0, le=10)
    SEISMIC_USGS_INTERVAL: int = Field(default=30, ge=10, le=3600)
    # Ignora reportes de sismos más antiguos (por ejemplo, al despertar el servidor).
    SEISMIC_MAX_AGE_MINUTES: int = Field(default=30, ge=1, le=1440)
    # La alerta automática se cierra sola pasado este tiempo.
    SEISMIC_ALERT_MINUTES: int = Field(default=30, ge=5, le=1440)
    SEISMIC_EMSC_URL: str = "wss://www.seismicportal.eu/standing_order/websocket"
    SEISMIC_USGS_URL: str = "https://earthquake.usgs.gov/fdsnws/event/1/query"
    # Firebase Cloud Messaging: JSON de la cuenta de servicio, completo y en una línea.
    FIREBASE_SERVICE_ACCOUNT: str = Field(default="", repr=False)
    FCM_TOPIC: str = Field(
        default="alertas_sismo", pattern=r"^[A-Za-z0-9_.~%-]{1,100}$"
    )
    FCM_API_URL: str = "https://fcm.googleapis.com"
    FCM_IID_URL: str = "https://iid.googleapis.com"

    @property
    def origenes(self):
        return [
            origen.strip() for origen in self.WEB_ORIGINS.split(",") if origen.strip()
        ]

    @property
    def brevo(self):
        """``"api"`` (REST), ``"smtp"`` (relé) o ``None`` según la clave de Brevo."""
        if not self.BREVO_API_KEY:
            return None
        return "smtp" if self.BREVO_API_KEY.startswith("xsmtpsib-") else "api"

    @property
    def correo_configurado(self):
        return bool(self.SMTP_HOST or self.brevo)

    @property
    def cuenta_firebase(self):
        return (
            json.loads(self.FIREBASE_SERVICE_ACCOUNT)
            if self.FIREBASE_SERVICE_ACCOUNT
            else None
        )

    @field_validator(
        "BREVO_API_KEY",
        "BREVO_SENDER_EMAIL",
        "BREVO_SENDER_NAME",
        "BREVO_SMTP_LOGIN",
        "SMTP_FROM",
        mode="before",
    )
    @classmethod
    def limpiar_credencial(cls, valor):
        """Quita espacios, saltos de línea y comillas que se cuelan al pegar en un panel."""
        return valor.strip().strip("\"'").strip() if isinstance(valor, str) else valor

    @model_validator(mode="after")
    def validar_urls(self):
        if urlsplit(self.DATABASE_URL).scheme not in ("postgres", "postgresql"):
            raise ValueError("DATABASE_URL debe identificar una base PostgreSQL")
        if not self.origenes or any(
            urlsplit(o).scheme not in ("http", "https")
            or not urlsplit(o).netloc
            or any(
                (
                    urlsplit(o).path,
                    urlsplit(o).query,
                    urlsplit(o).fragment,
                    urlsplit(o).username,
                )
            )
            for o in self.origenes
        ):
            raise ValueError("WEB_ORIGINS debe contener orígenes explícitos sin rutas")
        if self.FIREBASE_SERVICE_ACCOUNT:
            try:
                cuenta = json.loads(self.FIREBASE_SERVICE_ACCOUNT)
            except ValueError:
                raise ValueError("FIREBASE_SERVICE_ACCOUNT debe ser JSON") from None
            if not isinstance(cuenta, dict) or not all(
                isinstance(cuenta.get(campo), str) and cuenta[campo]
                for campo in ("project_id", "client_email", "private_key")
            ):
                raise ValueError(
                    "FIREBASE_SERVICE_ACCOUNT debe ser la cuenta de servicio de Firebase"
                )
        if self.QR_SECRET and len(self.QR_SECRET) < 32:
            raise ValueError("QR_SECRET debe tener al menos 32 caracteres")
        enlace = urlsplit(self.RESET_PASSWORD_URL)
        if enlace.scheme not in ("http", "https") or not enlace.netloc:
            raise ValueError("RESET_PASSWORD_URL debe ser una URL HTTP o HTTPS")
        # Sin SMTP la API funciona y la recuperación por correo responde 503 hasta
        # configurarlo (algunos proveedores gratuitos bloquean los puertos SMTP).
        if self.NODE_ENV == "production" and (
            enlace.scheme != "https"
            or any(not o.startswith("https://") for o in self.origenes)
        ):
            raise ValueError("Producción requiere HTTPS")
        return self


def cargar_configuracion():
    load_dotenv(RAIZ / ".env")
    try:
        return Configuracion.model_validate(os.environ)
    except ValidationError as error:
        campos = ", ".join(
            ".".join(map(str, fallo["loc"])) or fallo["msg"]
            for fallo in error.errors(include_input=False)
        )
        raise RuntimeError(f"Configuración inválida: {campos}") from None

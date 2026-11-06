"""Configuración compartida con la instalación existente de Xentinel."""

import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, model_validator

RAIZ = Path(__file__).resolve().parents[1]


class Configuracion(BaseModel):
    NODE_ENV: Literal["development", "test", "production"] = "development"
    HOST: str = "0.0.0.0"
    PORT: int = Field(default=8000, ge=1, le=65535)
    DATABASE_URL: str = Field(repr=False)
    JWT_SECRET: str = Field(min_length=64, repr=False)
    MAIL_ENCRYPTION_KEY: str = Field(pattern=r"^[a-fA-F0-9]{64}$", repr=False)
    JWT_TTL_SECONDS: int = Field(default=900, ge=60, le=3600)
    RESET_TTL_MINUTES: int = Field(default=20, ge=5, le=60)
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

    @property
    def origenes(self):
        return [
            origen.strip() for origen in self.WEB_ORIGINS.split(",") if origen.strip()
        ]

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
        enlace = urlsplit(self.RESET_PASSWORD_URL)
        if enlace.scheme not in ("http", "https") or not enlace.netloc:
            raise ValueError("RESET_PASSWORD_URL debe ser una URL HTTP o HTTPS")
        if self.NODE_ENV == "production" and (
            enlace.scheme != "https"
            or any(not o.startswith("https://") for o in self.origenes)
            or not self.SMTP_HOST
        ):
            raise ValueError("Producción requiere HTTPS y SMTP")
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

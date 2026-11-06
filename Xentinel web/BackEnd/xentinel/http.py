"""Respuestas, errores y parámetros comunes del contrato HTTP de Xentinel."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Path, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .base_datos import BaseDatos

ENTERO_MAXIMO = 2147483647
Id = Annotated[int, Field(gt=0, le=ENTERO_MAXIMO)]
IdRuta = Annotated[int, Path(gt=0, le=ENTERO_MAXIMO)]
Limite = Annotated[int, Query(ge=1, le=100)]


class Entrada(BaseModel):
    model_config = ConfigDict(extra="forbid")


def texto(minimo, maximo):
    return Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=minimo, max_length=maximo),
    ]


class ErrorAPI(Exception):
    def __init__(self, estado, codigo, mensaje, cabeceras=None):
        super().__init__(mensaje)
        self.estado = estado
        self.codigo = codigo
        self.cabeceras = cabeceras


def codificar(datos):
    return jsonable_encoder(
        datos,
        custom_encoder={
            datetime: lambda fecha: (
                (fecha.astimezone(UTC) if fecha.tzinfo else fecha.replace(tzinfo=UTC))
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
            ),
        },
    )


def responder(datos, estado=200, meta=None, *, legado=False):
    cuerpo = datos if legado else {"data": datos}
    if meta is not None:
        cuerpo["meta"] = {
            clave: valor
            for clave, valor in meta.items()
            if valor is not None or clave == "siguiente"
        }
    return JSONResponse(codificar(cuerpo), status_code=estado)


def paginacion(limit: Limite = 25, offset: Annotated[int, Query(ge=0, le=100000)] = 0):
    return {"limit": limit, "offset": offset}


def base_de_datos(solicitud: Request):
    return solicitud.app.state.base


Paginacion = Annotated[dict, Depends(paginacion)]
Base = Annotated[BaseDatos, Depends(base_de_datos)]

"""Carga masiva de personas desde CSV o Excel: revisión previa, importación y resumen.

La web lee el archivo y envía las filas como texto. El servidor las revisa contra la base
(documentos y correos ya registrados, fichas y programas) y, al confirmar, crea las
cuentas y vincula a los aprendices con su ficha en una sola transacción.

Las cuentas importadas no reciben una contraseña conocida: cada persona la crea con
«¿Olvidaste tu contraseña?» y el código que llega a su correo.
"""

import re
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import Field, StrictBool, TypeAdapter, ValidationError

from .autenticacion import Correo
from .fichas import vincular
from .http import Base, Entrada, responder
from .seguridad import Administrador

rutas = APIRouter(prefix="/usuarios", tags=["Carga masiva"])
MAXIMO_FILAS = 1000
TIPOS_DOCUMENTO = ("CC", "TI", "CE", "PA", "PEP", "PPT")
DOCUMENTO = re.compile(r"^[A-Za-z0-9-]{3,20}$")
NUMERO_FICHA = re.compile(r"^[A-Za-z0-9-]{1,15}$")
TELEFONO = re.compile(r"^[0-9+()\s-]{0,20}$")
CORREO = TypeAdapter(Correo)
# Marca de cuenta sin contraseña: no es un hash bcrypt, así que nunca valida un ingreso.
SIN_CONTRASENA = "!activar-con-codigo!"
SINONIMOS_ROL = {"funcionario": "funcionarios", "visitante": "visitantes"}
Texto = Annotated[str | None, Field(default=None, max_length=300)]


class FilaImportacion(Entrada):
    nombres_completos: Texto = None
    tipo_documento: Texto = None
    numero_documento: Texto = None
    correo: Texto = None
    telefono: Texto = None
    fecha_nacimiento: Texto = None
    rol: Texto = None
    numero_ficha: Texto = None
    programa: Texto = None


class Importacion(Entrada):
    filas: Annotated[
        list[FilaImportacion], Field(min_length=1, max_length=MAXIMO_FILAS)
    ]
    simular: StrictBool = True


def limpio(valor):
    return " ".join((valor or "").split())


def leer_fecha(texto):
    """Acepta 2008-05-31, 31/05/2008 y 31-05-2008."""
    if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", texto):
        anio, mes, dia = texto.split("-")
    elif re.fullmatch(r"\d{1,2}[/-]\d{1,2}[/-]\d{4}", texto):
        dia, mes, anio = re.split(r"[/-]", texto)
    else:
        return None
    try:
        fecha = date(int(anio), int(mes), int(dia))
    except ValueError:
        return None
    return fecha if date(1900, 1, 1) <= fecha < date.today() else None


def revisar(conexion, filas):
    """Normaliza cada fila y devuelve sus errores y avisos, sin escribir en la base."""
    roles = {
        fila["nombre_rol"].lower(): fila
        for fila in conexion.filas("SELECT id_rol,nombre_rol FROM rol")
    }
    documentos = [limpio(f.numero_documento) for f in filas]
    correos = [limpio(f.correo).lower() for f in filas]
    numeros = [limpio(f.numero_ficha).lower() for f in filas if f.numero_ficha]
    programas_pedidos = [limpio(f.programa).lower() for f in filas if f.programa]
    registrados = {
        fila["numero_documento"]
        for fila in conexion.filas(
            "SELECT numero_documento FROM usuarios WHERE numero_documento=ANY(%s)",
            documentos,
        )
    }
    correos_usados = {
        fila["correo"]
        for fila in conexion.filas(
            """SELECT lower(btrim(correo)) AS correo FROM usuarios
            WHERE lower(btrim(correo))=ANY(%s)""",
            correos,
        )
    }
    fichas = {
        fila["numero"]: fila
        for fila in conexion.filas(
            """SELECT f.id_ficha,f.numero_ficha,lower(f.numero_ficha) AS numero,
            p.id_programa,p.nombre_programa FROM ficha f JOIN programa p USING(id_programa)
            WHERE lower(f.numero_ficha)=ANY(%s)""",
            numeros,
        )
    }
    programas = {
        fila["nombre"]: fila
        for fila in conexion.filas(
            """SELECT id_programa,nombre_programa,activo,lower(btrim(nombre_programa)) AS nombre
            FROM programa WHERE lower(btrim(nombre_programa))=ANY(%s)""",
            programas_pedidos,
        )
    }
    vistos_documento, vistos_correo, revisadas = {}, {}, []
    for posicion, fila in enumerate(filas, start=1):
        errores, avisos = [], []
        datos = {
            "nombres_completos": limpio(fila.nombres_completos),
            "tipo_documento": limpio(fila.tipo_documento).upper() or "CC",
            "numero_documento": limpio(fila.numero_documento).replace(" ", ""),
            "correo": limpio(fila.correo).lower(),
            "telefono": limpio(fila.telefono),
            "fecha_nacimiento": None,
            "rol": None,
            "numero_ficha": limpio(fila.numero_ficha).upper() or None,
            "programa": limpio(fila.programa) or None,
        }
        if not limpio(fila.tipo_documento):
            avisos.append("Sin tipo de documento: se usará CC")
        nombre = datos["nombres_completos"]
        if len(nombre) < 2:
            errores.append("Falta el nombre completo")
        elif len(nombre) > 150:
            errores.append("El nombre supera 150 caracteres")
        if datos["tipo_documento"] not in TIPOS_DOCUMENTO:
            errores.append(
                f"Tipo de documento no válido: usa {', '.join(TIPOS_DOCUMENTO)}"
            )
        documento = datos["numero_documento"]
        if not documento:
            errores.append("Falta el número de documento")
        elif not DOCUMENTO.fullmatch(documento):
            errores.append("Documento no válido: 3 a 20 letras, números o guiones")
        elif documento in vistos_documento:
            errores.append(
                f"Documento repetido en el archivo (fila {vistos_documento[documento]})"
            )
        elif documento in registrados:
            errores.append("Ya existe una persona con este documento")
        else:
            vistos_documento[documento] = posicion
        correo = datos["correo"]
        if not correo:
            errores.append("Falta el correo")
        else:
            try:
                CORREO.validate_python(correo)
            except ValidationError:
                errores.append("Correo no válido")
            else:
                if correo in vistos_correo:
                    errores.append(
                        f"Correo repetido en el archivo (fila {vistos_correo[correo]})"
                    )
                elif correo in correos_usados:
                    errores.append("Ya existe una persona con este correo")
                else:
                    vistos_correo[correo] = posicion
        if not TELEFONO.fullmatch(datos["telefono"]):
            errores.append("Teléfono no válido")
        if limpio(fila.fecha_nacimiento):
            fecha = leer_fecha(limpio(fila.fecha_nacimiento))
            if fecha:
                datos["fecha_nacimiento"] = fecha.isoformat()
            else:
                errores.append(
                    "Fecha de nacimiento no válida: usa AAAA-MM-DD o DD/MM/AAAA"
                )
        rol_pedido = limpio(fila.rol).lower() or "aprendiz"
        rol = roles.get(SINONIMOS_ROL.get(rol_pedido, rol_pedido))
        if rol:
            datos["rol"] = rol["nombre_rol"]
            datos["id_rol"] = rol["id_rol"]
        else:
            errores.append(f"El rol «{limpio(fila.rol)}» no existe")
        if not limpio(fila.rol):
            avisos.append("Sin rol: se registrará como Aprendiz")
        numero = datos["numero_ficha"]
        ficha_nueva = False
        if numero:
            if rol and rol["nombre_rol"].lower() != "aprendiz":
                errores.append("Solo los aprendices se vinculan a una ficha")
            elif not NUMERO_FICHA.fullmatch(numero):
                errores.append("Número de ficha no válido")
            elif numero.lower() in fichas:
                existente = fichas[numero.lower()]
                datos["numero_ficha"] = existente["numero_ficha"]
                datos["id_ficha"] = existente["id_ficha"]
                if (
                    datos["programa"]
                    and datos["programa"].lower()
                    != existente["nombre_programa"].strip().lower()
                ):
                    avisos.append(
                        f"La ficha pertenece a {existente['nombre_programa']}: se conserva ese programa"
                    )
                datos["programa"] = existente["nombre_programa"]
            elif not datos["programa"]:
                errores.append(
                    f"La ficha {numero} no existe: escribe el programa para crearla"
                )
            else:
                programa = programas.get(datos["programa"].lower())
                if not programa:
                    errores.append(f"El programa «{datos['programa']}» no existe")
                elif not programa["activo"]:
                    errores.append(
                        f"El programa «{programa['nombre_programa']}» está desactivado"
                    )
                else:
                    ficha_nueva = True
                    datos["programa"] = programa["nombre_programa"]
                    datos["id_programa"] = programa["id_programa"]
                    avisos.append(f"Se creará la ficha {numero}")
        revisadas.append(
            {
                "fila": posicion,
                "datos": datos,
                "errores": errores,
                "avisos": avisos,
                "valida": not errores,
                "ficha_nueva": ficha_nueva and not errores,
            }
        )
    return revisadas


def resumen_revision(revisadas):
    validas = [fila for fila in revisadas if fila["valida"]]
    fichas = {
        fila["datos"]["numero_ficha"]
        for fila in validas
        if fila["datos"]["numero_ficha"]
    }
    nuevas = {fila["datos"]["numero_ficha"] for fila in validas if fila["ficha_nueva"]}
    return {
        "total": len(revisadas),
        "validas": len(validas),
        "errores": len(revisadas) - len(validas),
        "fichas": len(fichas),
        "fichas_nuevas": len(nuevas),
    }


@rutas.post("/importar")
def importar(datos: Importacion, db: Base, solicitud: Request, sesion: Administrador):
    """Con ``simular`` revisa las filas sin escribir. Sin él, crea las filas válidas,
    omite las que tienen errores y devuelve el resumen."""
    zona = solicitud.app.state.configuracion.ZONA_HORARIA
    with db.transaccion() as conexion:
        if not datos.simular:
            # Dos cargas simultáneas no se pisan: la segunda ve lo que creó la primera.
            conexion.ejecutar("SELECT pg_advisory_xact_lock(91734210)")
        revisadas = revisar(conexion, datos.filas)
        resumen = resumen_revision(revisadas)
        if datos.simular:
            return responder({"resumen": resumen, "filas": revisadas})
        fichas_creadas, por_ficha = {}, {}
        for fila in revisadas:
            if not fila["valida"]:
                continue
            persona = fila["datos"]
            numero = persona["numero_ficha"]
            if fila["ficha_nueva"] and numero not in fichas_creadas:
                fichas_creadas[numero] = conexion.fila(
                    """INSERT INTO ficha(numero_ficha,id_programa) VALUES(%s,%s)
                    RETURNING id_ficha""",
                    numero,
                    persona["id_programa"],
                )["id_ficha"]
            creada = conexion.fila(
                """INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,
                correo,contrasena,telefono,fecha_nacimiento,id_rol,requiere_restablecimiento)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,true) RETURNING id_usuarios""",
                persona["nombres_completos"],
                persona["tipo_documento"],
                persona["numero_documento"],
                persona["correo"],
                SIN_CONTRASENA,
                persona["telefono"] or None,
                persona["fecha_nacimiento"],
                persona["id_rol"],
            )
            fila["id_usuarios"] = creada["id_usuarios"]
            if numero:
                ficha = persona.get("id_ficha") or fichas_creadas[numero]
                por_ficha.setdefault(ficha, []).append(creada["id_usuarios"])
        for ficha, ids in por_ficha.items():
            vincular(conexion, ficha, ids, zona)
    creados = sum(1 for fila in revisadas if fila["valida"])
    return responder(
        {
            "resumen": {
                "creados": creados,
                "fichas_actualizadas": len(por_ficha),
                "fichas_creadas": len(fichas_creadas),
                "omitidos": resumen["errores"],
            },
            "filas": [fila for fila in revisadas if not fila["valida"]],
        },
        201 if creados else 200,
    )

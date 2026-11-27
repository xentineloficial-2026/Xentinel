"""Historial y registro idempotente de entradas y salidas."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import AwareDatetime, StringConstraints, model_validator

from . import alarmas, credenciales
from .http import Base, Entrada, ErrorAPI, Id, Paginacion, responder
from .seguridad import CeladorOAdmin, SesionActual, activo, es_admin

rutas = APIRouter(prefix="/ingresos", tags=["Ingresos y salidas"])
# El ambiente más frecuente en el horario de la ficha `f`, si la persona no tiene aula propia.
AULA_DE_FICHA = """(SELECT h.ambiente FROM horarios h WHERE h.id_ficha=f.id_ficha
    AND h.ambiente IS NOT NULL GROUP BY h.ambiente ORDER BY count(*) DESC,h.ambiente LIMIT 1)"""
# Situaciones formativas con las que el aprendiz deja la ficha y ya no entra a la sede.
SITUACIONES_RETIRO = ("desertado", "retirado")
# La app actual valida en línea. Se conserva el margen para las versiones anteriores que
# aún envían escaneos guardados sin conexión, así no se pierden al actualizar.
ATRASO_MAXIMO_OFFLINE = timedelta(hours=72)
ADELANTO_MAXIMO_RELOJ = timedelta(minutes=2)


class Movimiento(Entrada):
    # id_usuarios para el registro manual y los QR heredados; codigo_qr para el carnet firmado.
    id_usuarios: Id | None = None
    codigo_qr: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
        ]
        | None
    ) = None
    tipo: Literal["ENTRADA", "SALIDA"]
    metodo: Literal["Manual", "QR"]
    request_id: UUID
    # Hora del escaneo en el lector: permite sincronizar movimientos registrados sin conexión.
    escaneado_en: AwareDatetime | None = None

    @model_validator(mode="after")
    def validar_identificacion(self):
        if self.id_usuarios is None and self.codigo_qr is None:
            raise ValueError("Indique id_usuarios o codigo_qr")
        if self.codigo_qr is not None and self.metodo != "QR":
            raise ValueError("codigo_qr requiere metodo QR")
        return self


# Ficha activa del aprendiz (misma regla que la lista de asistencia).
FICHA_ACTIVA = """af.fechasalida IS NULL
    AND lower(af.estado) NOT IN ('inactivo','retirado','finalizado','cancelado','desertado')"""
# Una entrada sin salida de hace más de 16 horas es una salida olvidada: la siguiente
# lectura vuelve a ser una entrada. Cubre también las jornadas que cruzan la medianoche.
SALIDA_OLVIDADA = timedelta(hours=16)
COLUMNAS_ASISTENCIA = "id_asistencia,id_jornada,fecha,hora_entrada,hora_salida,estado"


def registrar_asistencia(conexion, movimiento, zona):
    """Refleja un acceso permitido en la asistencia del día, dentro de la misma transacción.

    Vale para cualquier persona. El aprendiz con ficha activa y jornada queda «Presente» si
    llega hasta la hora de inicio y «Retardo» después. Quien no tiene jornada (otros roles,
    aprendices recién creados o sin ficha) queda «Presente» en una fila sin jornada."""
    local = conexion.fila(
        """SELECT (%s::timestamptz AT TIME ZONE %s)::date AS fecha,
        (%s::timestamptz AT TIME ZONE %s)::time(0) AS hora""",
        movimiento["fechahora"],
        zona,
        movimiento["fechahora"],
        zona,
    )
    valores = {
        "fecha": local["fecha"],
        "hora": local["hora"],
        "usuario": movimiento["id_usuarios"],
    }
    if movimiento["tipo"] == "SALIDA":
        return conexion.fila(
            f"""UPDATE asistencia SET hora_salida=%s WHERE id_asistencia=(
            SELECT id_asistencia FROM asistencia WHERE id_usuarios=%s AND fecha=%s
            ORDER BY hora_entrada DESC NULLS LAST,id_asistencia DESC LIMIT 1)
            RETURNING {COLUMNAS_ASISTENCIA}""",
            local["hora"],
            movimiento["id_usuarios"],
            local["fecha"],
        )
    with conexion.conexion.cursor() as cursor:
        # Vale la jornada vigente (la más reciente) de la ficha activa. Volver a entrar
        # reabre el día y conserva la puntualidad de la primera llegada.
        jornada = cursor.execute(
            f"""SELECT j.id_jornada FROM aprendiz_ficha af
            JOIN jornada j ON j.id_ficha=af.id_ficha
            WHERE af.id_usuarios=%(usuario)s AND {FICHA_ACTIVA}
            ORDER BY af.id_aprendiz_ficha DESC,j.id_jornada DESC LIMIT 1""",
            valores,
        ).fetchone()
        if jornada:
            return cursor.execute(
                f"""INSERT INTO asistencia(id_usuarios,id_jornada,fecha,hora_entrada,estado)
                SELECT %(usuario)s,j.id_jornada,%(fecha)s,%(hora)s,
                CASE WHEN %(hora)s::time<=j.hora_inicio THEN 'Presente' ELSE 'Retardo' END
                FROM jornada j WHERE j.id_jornada=%(jornada)s
                ON CONFLICT (id_usuarios,id_jornada,fecha) DO UPDATE SET
                estado=CASE WHEN asistencia.hora_entrada IS NULL THEN EXCLUDED.estado ELSE asistencia.estado END,
                hora_entrada=coalesce(asistencia.hora_entrada,EXCLUDED.hora_entrada),hora_salida=NULL
                RETURNING {COLUMNAS_ASISTENCIA}""",
                {**valores, "jornada": jornada["id_jornada"]},
            ).fetchone()
        return cursor.execute(
            f"""INSERT INTO asistencia(id_usuarios,fecha,hora_entrada,estado)
            VALUES(%(usuario)s,%(fecha)s,%(hora)s,'Presente')
            ON CONFLICT (id_usuarios,fecha) WHERE id_jornada IS NULL DO UPDATE SET
            estado=CASE WHEN asistencia.hora_entrada IS NULL THEN EXCLUDED.estado ELSE asistencia.estado END,
            hora_entrada=coalesce(asistencia.hora_entrada,EXCLUDED.hora_entrada),hora_salida=NULL
            RETURNING {COLUMNAS_ASISTENCIA}""",
            valores,
        ).fetchone()


def asistencia_del_dia(conexion, identificador, instante, zona):
    """La asistencia vigente del día del movimiento, para repetir la respuesta original."""
    return conexion.fila(
        f"""SELECT {COLUMNAS_ASISTENCIA} FROM asistencia WHERE id_usuarios=%s
        AND fecha=(%s::timestamptz AT TIME ZONE %s)::date
        ORDER BY hora_entrada DESC NULLS LAST,id_asistencia DESC LIMIT 1""",
        identificador,
        instante,
        zona,
    )


def motivo_denegado(persona):
    """Por qué se negó el acceso, en palabras para el punto de control."""
    if not activo(persona):
        return {
            "codigo": "USUARIO_INACTIVO",
            "mensaje": "Usuario inactivo: la cuenta está desactivada",
        }
    return {
        "codigo": "APRENDIZ_RETIRADO",
        "mensaje": "Aprendiz retirado o desertado de la formación",
    }


def datos_persona(conexion, identificador):
    """Lo que el celador necesita ver al autorizar: nombre, documento, ficha y aula."""
    return conexion.fila(
        f"""SELECT u.nombres_completos,u.tipo_documento,u.numero_documento,r.nombre_rol,
        u.estado,f.numero_ficha,p.nombre_programa,
        coalesce(u.ambiente,{AULA_DE_FICHA}) AS ambiente
        FROM usuarios u JOIN rol r USING(id_rol)
        LEFT JOIN LATERAL (SELECT af.id_ficha FROM aprendiz_ficha af
            WHERE af.id_usuarios=u.id_usuarios
            ORDER BY af.fechasalida IS NULL DESC,af.id_aprendiz_ficha DESC LIMIT 1) a ON true
        LEFT JOIN ficha f ON f.id_ficha=a.id_ficha
        LEFT JOIN programa p ON p.id_programa=f.id_programa
        WHERE u.id_usuarios=%s""",
        identificador,
    )


@rutas.get("")
def listar(db: Base, pagina: Paginacion, sesion: SesionActual, id_usuarios: Id = None):
    # El historial general es solo del administrador; los demás consultan sus propios movimientos.
    titular = id_usuarios if es_admin(sesion.usuario) else sesion.id
    return responder(
        db.filas(
            """SELECT a.*,u.nombres_completos FROM acceso a
        JOIN usuarios u ON u.id_usuarios=a.id_usuarios
        WHERE (%s::integer IS NULL OR a.id_usuarios=%s)
        ORDER BY a.fechahora DESC,a.id_acceso DESC LIMIT %s OFFSET %s""",
            titular,
            titular,
            pagina["limit"],
            pagina["offset"],
        ),
        meta=pagina,
    )


@rutas.post(
    "",
    status_code=201,
    responses={200: {"description": "Movimiento registrado previamente"}},
)
def registrar(datos: Movimiento, solicitud: Request, db: Base, sesion: CeladorOAdmin):
    """Registra el movimiento. Un carnet vencido o que no es verídico deja una alarma."""
    alarma = {}
    try:
        return registrar_movimiento(datos, solicitud, db, sesion, alarma)
    except ErrorAPI:
        # La transacción del escaneo ya se revirtió; la alarma se guarda aparte.
        if alarma:
            alarmas.registrar_alarma_qr(
                db,
                contenido=datos.codigo_qr,
                registrado_por=sesion.id,
                tipo=datos.tipo,
                **alarma,
            )
        raise


def registrar_movimiento(datos, solicitud, db, sesion, alarma):
    config = solicitud.app.state.configuracion
    ahora = datetime.now(UTC)
    escaneado = None
    if datos.escaneado_en is not None:
        escaneado = datos.escaneado_en.astimezone(UTC)
        if (
            escaneado > ahora + ADELANTO_MAXIMO_RELOJ
            or escaneado < ahora - ATRASO_MAXIMO_OFFLINE
        ):
            raise ErrorAPI(
                422,
                "INVALID_SCAN_TIME",
                "La hora del escaneo está fuera del rango permitido",
            )
        # Un reloj adelantado nunca deja un movimiento en el futuro.
        escaneado = min(escaneado, ahora)
    with db.transaccion() as conexion:
        # El UUID también se bloquea entre usuarios distintos para detectar reutilización concurrente.
        conexion.ejecutar(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 91734204))",
            str(datos.request_id),
        )
        identificador, paso_qr = datos.id_usuarios, None
        if datos.codigo_qr is not None:
            # Hasta comprobar la firma, cualquier rechazo es un código no verídico (rojo).
            alarma["motivo"] = "QR_INVALIDO"
            if not credenciales.es_codigo_firmado(datos.codigo_qr):
                raise credenciales.qr_invalido()
            identificador, paso_qr = credenciales.verificar_firma(
                conexion, config, datos.codigo_qr
            )
            if datos.id_usuarios is not None and datos.id_usuarios != identificador:
                raise credenciales.qr_invalido()
            alarma.clear()
        elif datos.metodo == "QR" and config.QR_REQUIRE_SIGNED == "true":
            raise ErrorAPI(
                422,
                "QR_UNSIGNED",
                "Este punto de acceso solo acepta el carnet QR firmado de la app",
            )
        persona = conexion.fila(
            "SELECT estado,situacion_formativa FROM usuarios WHERE id_usuarios=%s FOR UPDATE",
            identificador,
        )
        if not persona:
            raise ErrorAPI(404, "NOT_FOUND", "Usuario no encontrado")
        previo = conexion.fila(
            "SELECT * FROM acceso WHERE request_id=%s", datos.request_id
        )
        if previo:
            if (
                previo["id_usuarios"],
                previo["tipo"],
                previo["metodo"],
                previo["registrado_por"],
            ) != (
                identificador,
                datos.tipo,
                datos.metodo,
                sesion.id,
            ):
                raise ErrorAPI(
                    409,
                    "IDEMPOTENCY_CONFLICT",
                    "request_id ya usado para otra operación",
                )
            persona = datos_persona(conexion, identificador)
            return responder(
                {
                    **previo,
                    "persona": persona,
                    "asistencia": asistencia_del_dia(
                        conexion,
                        identificador,
                        previo["fechahora"],
                        config.ZONA_HORARIA,
                    )
                    if previo["estado"] == "Permitido"
                    else None,
                    "motivo": None
                    if previo["estado"] == "Permitido"
                    else motivo_denegado(persona),
                }
            )
        if paso_qr is not None:
            # La vigencia se mide en el instante del escaneo, no en el de la sincronización.
            # Firma auténtica pero vencida: el titular está identificado (amarillo).
            alarma.update(motivo="QR_VENCIDO", id_usuarios=identificador)
            credenciales.comprobar_vigencia(paso_qr, (escaneado or ahora).timestamp())
            alarma.clear()
        retirado = (persona["situacion_formativa"] or "").lower() in SITUACIONES_RETIRO
        estado = "Permitido" if activo(persona) and not retirado else "Denegado"
        if estado == "Permitido":
            anterior = conexion.fila(
                """SELECT tipo,fechahora FROM acceso WHERE id_usuarios=%s AND estado='Permitido'
                AND fechahora<=coalesce(%s::timestamptz,now())
                ORDER BY fechahora DESC,id_acceso DESC LIMIT 1""",
                identificador,
                escaneado,
            )
            esperado = (
                "SALIDA"
                if anterior
                and anterior["tipo"] == "ENTRADA"
                and (escaneado or ahora) - anterior["fechahora"] < SALIDA_OLVIDADA
                else "ENTRADA"
            )
            if datos.tipo != esperado:
                raise ErrorAPI(
                    409,
                    "ACCESS_SEQUENCE",
                    "Debe alternar ENTRADA y SALIDA; registre primero la entrada",
                )
        registro = conexion.fila(
            """INSERT INTO acceso(id_usuarios,tipo,metodo,estado,registrado_por,request_id,fechahora)
            VALUES(%s,%s,%s,%s,%s,%s,coalesce(%s::timestamptz,now())) RETURNING *""",
            identificador,
            datos.tipo,
            datos.metodo,
            estado,
            sesion.id,
            datos.request_id,
            escaneado,
        )
        asistencia = (
            registrar_asistencia(conexion, registro, config.ZONA_HORARIA)
            if estado == "Permitido"
            else None
        )
        persona = datos_persona(conexion, identificador)
    return responder(
        {
            **registro,
            "persona": persona,
            "asistencia": asistencia,
            "motivo": None if estado == "Permitido" else motivo_denegado(persona),
        },
        201,
    )

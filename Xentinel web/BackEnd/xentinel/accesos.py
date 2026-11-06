"""Historial y registro idempotente de entradas y salidas."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request

from .http import Base, Entrada, ErrorAPI, Id, Paginacion, responder
from .seguridad import CeladorOAdmin, SesionActual, activo, es_admin

rutas = APIRouter(prefix="/ingresos", tags=["Ingresos y salidas"])
# El ambiente más frecuente en el horario de la ficha `f`, si la persona no tiene aula propia.
AULA_DE_FICHA = """(SELECT h.ambiente FROM horarios h WHERE h.id_ficha=f.id_ficha
    AND h.ambiente IS NOT NULL GROUP BY h.ambiente ORDER BY count(*) DESC,h.ambiente LIMIT 1)"""
# Situaciones formativas con las que el aprendiz deja la ficha y ya no entra a la sede.
SITUACIONES_RETIRO = ("desertado", "retirado")


class Movimiento(Entrada):
    id_usuarios: Id
    tipo: Literal["ENTRADA", "SALIDA"]
    metodo: Literal["Manual", "QR"]
    request_id: UUID


def registrar_asistencia(conexion, movimiento, zona):
    """Refleja un acceso permitido en la asistencia del aprendiz, dentro de la misma transacción."""
    local = conexion.fila(
        """SELECT (%s::timestamptz AT TIME ZONE %s)::date AS fecha,
        (%s::timestamptz AT TIME ZONE %s)::time(0) AS hora""",
        movimiento["fechahora"],
        zona,
        movimiento["fechahora"],
        zona,
    )
    if movimiento["tipo"] == "ENTRADA":
        # Sólo los aprendices con ficha y jornada generan asistencia. Vale la jornada vigente de
        # la ficha (la más reciente que definió el administrador). A tiempo hasta la hora de inicio.
        # Volver a entrar reabre el día y conserva la puntualidad de la primera llegada.
        with conexion.conexion.cursor() as cursor:
            cursor.execute(
                """INSERT INTO asistencia(id_usuarios,id_jornada,fecha,hora_entrada,estado)
                SELECT af.id_usuarios,j.id_jornada,%(fecha)s,%(hora)s,
                CASE WHEN %(hora)s::time<=j.hora_inicio THEN '✅ Presente' ELSE '⚠️ Tardanza' END
                FROM aprendiz_ficha af JOIN jornada j ON j.id_ficha=af.id_ficha
                WHERE af.id_usuarios=%(usuario)s
                ORDER BY j.id_jornada DESC LIMIT 1
                ON CONFLICT (id_usuarios,id_jornada,fecha) DO UPDATE SET
                estado=CASE WHEN asistencia.hora_entrada IS NULL THEN EXCLUDED.estado ELSE asistencia.estado END,
                hora_entrada=coalesce(asistencia.hora_entrada,EXCLUDED.hora_entrada),hora_salida=NULL""",
                {
                    "fecha": local["fecha"],
                    "hora": local["hora"],
                    "usuario": movimiento["id_usuarios"],
                },
            )
        return
    conexion.ejecutar(
        """UPDATE asistencia SET hora_salida=%s WHERE id_asistencia=(
        SELECT id_asistencia FROM asistencia WHERE id_usuarios=%s AND fecha=%s
        ORDER BY hora_entrada DESC NULLS LAST,id_asistencia DESC LIMIT 1)""",
        local["hora"],
        movimiento["id_usuarios"],
        local["fecha"],
    )


def datos_persona(conexion, identificador):
    """Lo que el celador necesita ver al autorizar: nombre, documento, ficha y aula."""
    return conexion.fila(
        f"""SELECT u.nombres_completos,u.tipo_documento,u.numero_documento,r.nombre_rol,
        f.numero_ficha,coalesce(u.ambiente,{AULA_DE_FICHA}) AS ambiente
        FROM usuarios u JOIN rol r USING(id_rol)
        LEFT JOIN LATERAL (SELECT af.id_ficha FROM aprendiz_ficha af
            WHERE af.id_usuarios=u.id_usuarios
            ORDER BY af.fechasalida IS NULL DESC,af.id_aprendiz_ficha DESC LIMIT 1) a ON true
        LEFT JOIN ficha f ON f.id_ficha=a.id_ficha
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
def registrar(
    datos: Movimiento, solicitud: Request, db: Base, sesion: CeladorOAdmin
):
    with db.transaccion() as conexion:
        # El UUID también se bloquea entre usuarios distintos para detectar reutilización concurrente.
        conexion.ejecutar(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 91734204))",
            str(datos.request_id),
        )
        persona = conexion.fila(
            "SELECT estado,situacion_formativa FROM usuarios WHERE id_usuarios=%s FOR UPDATE",
            datos.id_usuarios,
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
                datos.id_usuarios,
                datos.tipo,
                datos.metodo,
                sesion.id,
            ):
                raise ErrorAPI(
                    409,
                    "IDEMPOTENCY_CONFLICT",
                    "request_id ya usado para otra operación",
                )
            return responder(
                {**previo, "persona": datos_persona(conexion, datos.id_usuarios)}
            )
        retirado = (persona["situacion_formativa"] or "").lower() in SITUACIONES_RETIRO
        estado = "Permitido" if activo(persona) and not retirado else "Denegado"
        if estado == "Permitido":
            anterior = conexion.fila(
                """SELECT tipo FROM acceso WHERE id_usuarios=%s AND estado='Permitido'
                ORDER BY fechahora DESC,id_acceso DESC LIMIT 1""",
                datos.id_usuarios,
            )
            esperado = (
                "SALIDA" if anterior and anterior["tipo"] == "ENTRADA" else "ENTRADA"
            )
            if datos.tipo != esperado:
                raise ErrorAPI(
                    409,
                    "ACCESS_SEQUENCE",
                    "Debe alternar ENTRADA y SALIDA; registre primero la entrada",
                )
        registro = conexion.fila(
            """INSERT INTO acceso(id_usuarios,tipo,metodo,estado,registrado_por,request_id)
            VALUES(%s,%s,%s,%s,%s,%s) RETURNING *""",
            datos.id_usuarios,
            datos.tipo,
            datos.metodo,
            estado,
            sesion.id,
            datos.request_id,
        )
        if estado == "Permitido":
            registrar_asistencia(
                conexion, registro, solicitud.app.state.configuracion.ZONA_HORARIA
            )
        persona = datos_persona(conexion, datos.id_usuarios)
    return responder({**registro, "persona": persona}, 201)

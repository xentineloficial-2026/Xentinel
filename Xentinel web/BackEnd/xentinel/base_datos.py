"""Conexiones PostgreSQL y migraciones compatibles con las de Express."""

from contextlib import contextmanager
from hashlib import sha256

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .configuracion import RAIZ

VERSIONES = (
    "001_base",
    "002_security_realtime",
    "003_programas_admin",
    "004_perfil_asistencia",
    "005_rls_correo_opcional",
    "006_codigos_sismos",
    "007_alarmas_asistencia_correo",
)


class Consultas:
    def __init__(self, conexion):
        self.conexion = conexion

    def filas(self, consulta, *parametros):
        with self.conexion.cursor() as cursor:
            return cursor.execute(consulta, parametros).fetchall()

    def fila(self, consulta, *parametros):
        with self.conexion.cursor() as cursor:
            return cursor.execute(consulta, parametros).fetchone()

    def ejecutar(self, consulta, *parametros):
        with self.conexion.cursor() as cursor:
            return cursor.execute(consulta, parametros or None).rowcount


def configurar_sesion(conexion):
    # Con SET y no con "options" de arranque: los poolers (Supavisor, PgBouncer) no las reenvían.
    conexion.execute("SET timezone TO 'UTC'")
    conexion.execute("SET statement_timeout TO 10000")
    conexion.commit()


class BaseDatos:
    def __init__(self, url, maximo=15):
        self.pool = ConnectionPool(
            url,
            min_size=1,
            max_size=maximo,
            open=False,
            timeout=5,
            configure=configurar_sesion,
            kwargs={"row_factory": dict_row, "connect_timeout": 5},
        )

    @contextmanager
    def transaccion(self):
        # El pool confirma al salir y revierte si la operación falla.
        with self.pool.connection() as conexion:
            yield Consultas(conexion)

    def filas(self, consulta, *parametros):
        with self.transaccion() as db:
            return db.filas(consulta, *parametros)

    def fila(self, consulta, *parametros):
        with self.transaccion() as db:
            return db.fila(consulta, *parametros)

    def ejecutar(self, consulta, *parametros):
        with self.transaccion() as db:
            return db.ejecutar(consulta, *parametros)


def verificar_esquema(db):
    versiones = db.filas(
        "SELECT version FROM schema_migrations WHERE version=ANY(%s)", list(VERSIONES)
    )
    if len(versiones) != len(VERSIONES):
        raise RuntimeError("Ejecute python -m xentinel migrar antes de iniciar")
    # Evita iniciar si faltan tablas o columnas esenciales, aunque el historial exista.
    for consulta in (
        "SELECT auth_version, requiere_restablecimiento FROM usuarios LIMIT 0",
        "SELECT token_hash, token_expiracion, usado_en FROM password_reset_tokens LIMIT 0",
        "SELECT payload_encrypted, siguiente_intento FROM mail_outbox LIMIT 0",
        "SELECT recurso, operacion, propietario_id FROM api_events LIMIT 0",
        "SELECT registrado_por, request_id FROM acceso LIMIT 0",
        "SELECT severidad, fuente, referencia_externa, cerrada_por FROM alertas_emergencia LIMIT 0",
        "SELECT id_reporte, id_usuarios, presente FROM reporte_estudiantes LIMIT 0",
        "SELECT hits, expires_at FROM api_rate_limits LIMIT 0",
        "SELECT activo FROM programa LIMIT 0",
        "SELECT modificado_por, modificado_en FROM asistencia LIMIT 0",
        "SELECT contenido FROM usuario_foto LIMIT 0",
        "SELECT intentos FROM password_reset_tokens LIMIT 0",
        "SELECT evento_id, distancia_km, id_alerta FROM sismos_detectados LIMIT 0",
        "SELECT proposito, correo_nuevo FROM password_reset_tokens LIMIT 0",
        "SELECT motivo, semaforo, huella, atendida_en FROM alarmas_qr LIMIT 0",
    ):
        db.ejecutar(consulta)


def migraciones():
    for version in VERSIONES:
        contenido = (RAIZ / "sql" / f"{version}.sql").read_bytes()
        yield version, contenido.decode("utf-8"), sha256(contenido).hexdigest()


def migrar(base):
    with base.transaccion() as db:
        db.ejecutar("SELECT pg_advisory_xact_lock(91734200)")
        db.ejecutar("""CREATE TABLE IF NOT EXISTS schema_migrations(
            version text PRIMARY KEY, checksum char(64) NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now())""")
        for version, sql, checksum in migraciones():
            anterior = db.fila(
                "SELECT checksum FROM schema_migrations WHERE version=%s", version
            )
            if anterior:
                if anterior["checksum"] != checksum:
                    raise RuntimeError(
                        f"La migración {version} cambió después de aplicarse"
                    )
                continue
            db.ejecutar(sql)
            db.ejecutar(
                "INSERT INTO schema_migrations(version,checksum) VALUES(%s,%s)",
                version,
                checksum,
            )

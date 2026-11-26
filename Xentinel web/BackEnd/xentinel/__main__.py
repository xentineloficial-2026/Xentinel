"""Comandos de arranque, actualización del esquema y alta administrativa inicial."""

import argparse
import os

import uvicorn
from dotenv import load_dotenv
from pydantic import ValidationError

from .base_datos import BaseDatos, migraciones, migrar, verificar_esquema
from .configuracion import RAIZ, cargar_configuracion


def crear_admin(base):
    from .autenticacion import Registro, insertar_usuario
    from .seguridad import hash_clave

    try:
        datos = Registro(
            nombres_completos=os.getenv("ADMIN_NAME"),
            tipo_documento="CC",
            numero_documento=os.getenv("ADMIN_DOCUMENT"),
            correo=os.getenv("ADMIN_EMAIL"),
            contrasena=os.getenv("ADMIN_PASSWORD"),
        )
    except ValidationError:
        raise SystemExit(
            "Revise ADMIN_NAME, ADMIN_DOCUMENT, ADMIN_EMAIL y ADMIN_PASSWORD"
        ) from None
    verificar_esquema(base)
    with base.transaccion() as db:
        db.ejecutar("SELECT pg_advisory_xact_lock(91734202)")
        if db.fila("""SELECT 1 FROM usuarios u JOIN rol r USING(id_rol) WHERE lower(r.nombre_rol)='administrador'
            AND lower(u.estado)='activo' AND NOT requiere_restablecimiento"""):
            raise SystemExit(
                "Ya existe un administrador activo con contraseña válida; use la API autenticada"
            )
        rol = db.fila("SELECT id_rol FROM rol WHERE lower(nombre_rol)='administrador'")
        insertar_usuario(db, datos, hash_clave(datos.contrasena), rol["id_rol"])
    print("Administrador inicial creado")


def exportar_sql(destino):
    from pathlib import Path

    salida = [
        "-- XENTINEL: esquema y catálogos sin datos personales ni credenciales. PostgreSQL 17+.",
        "-- Ejecutar una vez. Las actualizaciones posteriores se aplican con python -m xentinel migrar.",
        "BEGIN;",
        "SELECT pg_advisory_xact_lock(91734200);",
        (
            "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum char(64) NOT NULL, "
            "applied_at timestamptz NOT NULL DEFAULT now());"
        ),
    ]
    for version, sql, checksum in migraciones():
        salida.extend(
            (
                f"\n-- {version}",
                sql,
                f"INSERT INTO schema_migrations(version,checksum) VALUES('{version}','{checksum}');",
            )
        )
    salida.extend(("COMMIT;", ""))
    Path(destino).write_bytes("\n".join(salida).encode())
    print("SQL independiente generado")


def probar_correo(destino):
    """Envía un correo de prueba con la configuración actual y muestra la causa si falla."""
    from .correo import FalloCorreo, enviar_prueba, transporte

    config = cargar_configuracion()
    medio = transporte(config)
    if not medio:
        raise SystemExit(
            "Correo sin configurar: define BREVO_API_KEY y BREVO_SENDER_EMAIL (Brevo) "
            "o SMTP_HOST, SMTP_USER y SMTP_PASS (SMTP)."
        )
    print(f"Enviando por {medio}…")
    try:
        enviar_prueba(destino, config)
    except FalloCorreo as fallo:
        raise SystemExit(f"No se envió ({fallo.codigo}): {fallo.detalle}") from None
    print(
        "Correo de prueba enviado. Revisa la bandeja de entrada y la carpeta de spam."
    )


def ejecutar():
    analizador = argparse.ArgumentParser(description=__doc__)
    comandos = analizador.add_subparsers(dest="comando", required=True)
    servidor = comandos.add_parser("servir")
    servidor.add_argument("--recargar", action="store_true")
    comandos.add_parser("migrar")
    comandos.add_parser("crear-admin")
    prueba = comandos.add_parser("probar-correo")
    prueba.add_argument("destino", help="Correo que recibirá el mensaje de prueba")
    exportacion = comandos.add_parser("exportar-sql")
    exportacion.add_argument(
        "destino", nargs="?", default=RAIZ / "sql" / "Xentinel_completo.sql"
    )
    opciones = analizador.parse_args()
    if opciones.comando == "exportar-sql":
        exportar_sql(opciones.destino)
        return
    if opciones.comando == "probar-correo":
        probar_correo(opciones.destino)
        return
    if opciones.comando == "servir":
        config = cargar_configuracion()
        uvicorn.run(
            "xentinel.main:crear_aplicacion",
            factory=True,
            host=config.HOST,
            port=config.PORT,
            proxy_headers=False,
            reload=opciones.recargar,
            timeout_graceful_shutdown=15,
            server_header=False,
            # Canal /api/v1/tiempo-real: mensajes pequeños y detección de conexiones caídas
            # (redes móviles que cambian de antena o de Wi-Fi a datos).
            ws="websockets-sansio",
            ws_max_size=64 * 1024,
            ws_ping_interval=20,
            ws_ping_timeout=20,
        )
        return

    load_dotenv(RAIZ / ".env")
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("Falta DATABASE_URL")
    base = BaseDatos(url)
    try:
        base.pool.open(wait=True)
        if opciones.comando == "migrar":
            migrar(base)
            print("Migraciones verificadas y aplicadas")
        else:
            crear_admin(base)
    finally:
        base.pool.close()


if __name__ == "__main__":
    ejecutar()

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


def ejecutar():
    analizador = argparse.ArgumentParser(description=__doc__)
    comandos = analizador.add_subparsers(dest="comando", required=True)
    servidor = comandos.add_parser("servir")
    servidor.add_argument("--recargar", action="store_true")
    comandos.add_parser("migrar")
    comandos.add_parser("crear-admin")
    exportacion = comandos.add_parser("exportar-sql")
    exportacion.add_argument(
        "destino", nargs="?", default=RAIZ / "sql" / "Xentinel_completo.sql"
    )
    opciones = analizador.parse_args()
    if opciones.comando == "exportar-sql":
        exportar_sql(opciones.destino)
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

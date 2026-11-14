"""Prueba piloto: la contraseña de cada usuario pasa a ser su número de documento.

Usa el mismo cifrado bcrypt del backend y cierra las sesiones abiertas.
Haz un respaldo antes de ejecutarlo:  python scripts/contrasenas_documento.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from xentinel.base_datos import BaseDatos  # noqa: E402
from xentinel.configuracion import cargar_configuracion  # noqa: E402
from xentinel.seguridad import hash_clave  # noqa: E402


def ejecutar():
    base = BaseDatos(cargar_configuracion().DATABASE_URL)
    base.pool.open(wait=True)
    try:
        with base.transaccion() as db:
            usuarios = db.filas("SELECT id_usuarios, numero_documento FROM usuarios")
            for usuario in usuarios:
                db.ejecutar(
                    """UPDATE usuarios SET contrasena=%s, requiere_restablecimiento=false,
                    auth_version=auth_version+1 WHERE id_usuarios=%s""",
                    hash_clave(usuario["numero_documento"]),
                    usuario["id_usuarios"],
                )
        print(f"Contraseñas actualizadas: {len(usuarios)}")
    finally:
        base.pool.close()


if __name__ == "__main__":
    ejecutar()

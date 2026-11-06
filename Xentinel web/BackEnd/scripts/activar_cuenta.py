"""Define una contraseña y quita el bloqueo de restablecimiento de una cuenta.

Uso, desde BackEnd:  .\\.venv\\Scripts\\python.exe scripts\\activar_cuenta.py NUMERO_DOCUMENTO
La contraseña se pide oculta; no queda en el historial ni en este archivo.
"""

import sys
from getpass import getpass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from xentinel.base_datos import BaseDatos  # noqa: E402
from xentinel.configuracion import cargar_configuracion  # noqa: E402
from xentinel.seguridad import comprobar_clave, hash_clave  # noqa: E402

MINIMO = 8


def activar(conexion, documento, clave):
    """Devuelve la persona actualizada, o None si el documento no existe."""
    fila = conexion.fila(
        """UPDATE usuarios SET contrasena=%s,requiere_restablecimiento=false
        WHERE numero_documento=%s
        RETURNING id_usuarios,nombres_completos,estado,contrasena""",
        hash_clave(clave),
        documento,
    )
    if fila and not comprobar_clave(clave, fila["contrasena"]):
        raise RuntimeError("El hash guardado no valida la contraseña")
    return fila


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    documento = sys.argv[1].strip()
    clave = getpass("Nueva contraseña: ")
    if len(clave) < MINIMO:
        sys.exit(f"Usa al menos {MINIMO} caracteres.")
    if clave != getpass("Repítela: "):
        sys.exit("Las contraseñas no coinciden.")
    base = BaseDatos(cargar_configuracion().DATABASE_URL)
    base.pool.open(wait=True)
    try:
        with base.transaccion() as conexion:
            fila = activar(conexion, documento, clave)
    finally:
        base.pool.close()
    if not fila:
        sys.exit(f"No existe un usuario con documento {documento}.")
    print(f"Listo: {fila['nombres_completos']} (id {fila['id_usuarios']}, {fila['estado']}).")
    print("Ya puede iniciar sesión con esa contraseña.")


if __name__ == "__main__":
    main()

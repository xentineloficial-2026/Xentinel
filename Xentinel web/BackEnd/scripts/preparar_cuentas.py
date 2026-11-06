"""Activa las cuentas bloqueadas con contraseñas aleatorias y completa el aula desde el horario.

Uso, desde BackEnd:  .\\.venv\\Scripts\\python.exe scripts\\preparar_cuentas.py RUTA_PRIVADA.csv
Guarda las contraseñas en texto claro en ese CSV: debe quedar fuera del proyecto y sin compartirse.
Solo cambia cuentas con requiere_restablecimiento y aulas vacías; repetirlo no altera lo ya activo.
"""

import csv
import secrets
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from xentinel.base_datos import BaseDatos  # noqa: E402
from xentinel.configuracion import cargar_configuracion  # noqa: E402
from xentinel.seguridad import hash_clave  # noqa: E402

ALFABETO = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
# El ambiente más frecuente en el horario de cada ficha es su aula.
AULA_FICHA = """(SELECT h.ambiente FROM horarios h WHERE h.id_ficha=af.id_ficha
    AND h.ambiente IS NOT NULL GROUP BY h.ambiente ORDER BY count(*) DESC,h.ambiente LIMIT 1)"""


def clave_aleatoria():
    return "".join(secrets.choice(ALFABETO) for _ in range(14))


def completar_aulas(conexion):
    aprendices = conexion.ejecutar(
        f"""UPDATE usuarios u SET ambiente=d.aula FROM (
            SELECT DISTINCT ON (af.id_usuarios) af.id_usuarios,{AULA_FICHA} AS aula
            FROM aprendiz_ficha af ORDER BY af.id_usuarios,af.id_aprendiz_ficha DESC) d
        WHERE u.id_usuarios=d.id_usuarios AND u.ambiente IS NULL AND d.aula IS NOT NULL"""
    )
    instructores = conexion.ejecutar(
        """UPDATE usuarios u SET ambiente=d.aula FROM (
            SELECT DISTINCT ON (id_instructor) id_instructor,ambiente AS aula
            FROM horarios WHERE ambiente IS NOT NULL
            GROUP BY id_instructor,ambiente ORDER BY id_instructor,count(*) DESC,ambiente) d
        WHERE u.id_usuarios=d.id_instructor AND u.ambiente IS NULL"""
    )
    return aprendices, instructores


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    destino = Path(sys.argv[1]).resolve()
    if destino.exists():
        sys.exit(f"Ya existe {destino}; no se sobrescribe. Indica otro nombre.")
    if RAIZ.parents[1] in destino.parents:
        sys.exit("El CSV contiene contraseñas: guárdalo fuera de la carpeta del proyecto.")
    base = BaseDatos(cargar_configuracion().DATABASE_URL)
    base.pool.open(wait=True)
    try:
        cuentas = base.filas(
            """SELECT u.id_usuarios,r.nombre_rol,u.nombres_completos,u.tipo_documento,u.numero_documento
            FROM usuarios u JOIN rol r USING(id_rol)
            WHERE u.requiere_restablecimiento ORDER BY r.nombre_rol,u.nombres_completos"""
        )
        # bcrypt es lento a propósito: se calcula antes de abrir la transacción.
        for cuenta in cuentas:
            cuenta["clave"] = clave_aleatoria()
            cuenta["hash"] = hash_clave(cuenta["clave"])
        destino.parent.mkdir(parents=True, exist_ok=True)
        with destino.open("x", newline="", encoding="utf-8-sig") as archivo:
            salida = csv.writer(archivo, delimiter=";")
            salida.writerow(["Rol", "Nombre", "Tipo", "Documento", "Contraseña"])
            for c in cuentas:
                salida.writerow(
                    [
                        c["nombre_rol"],
                        c["nombres_completos"],
                        c["tipo_documento"],
                        c["numero_documento"],
                        c["clave"],
                    ]
                )
        with base.transaccion() as conexion:
            for c in cuentas:
                conexion.ejecutar(
                    """UPDATE usuarios SET contrasena=%s,requiere_restablecimiento=false
                    WHERE id_usuarios=%s AND requiere_restablecimiento""",
                    c["hash"],
                    c["id_usuarios"],
                )
            aprendices, instructores = completar_aulas(conexion)
    finally:
        base.pool.close()
    print(f"Cuentas activadas: {len(cuentas)}")
    print(f"Aula completada: {aprendices} aprendices, {instructores} instructores")
    print(f"Contraseñas en: {destino}")


if __name__ == "__main__":
    main()

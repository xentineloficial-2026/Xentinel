"""Inicia el Backend FastAPI real sobre una base PostgreSQL temporal para probar la app.

Uso (con el entorno virtual del Backend):

    python scripts/fastapi-smoke-server.py RUTA_AL_BACKEND postgresql://postgres@127.0.0.1:55439/postgres

Crea una base desechable con tres cuentas ficticias (administrador, aprendiz y celador),
escucha solo en 127.0.0.1:18924 y elimina la base al terminar (Ctrl+C o «stop»). Nunca
lee el .env ni se conecta a la base de la aplicación.
"""

import os
import secrets
import signal
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit, urlunsplit

PUERTO = 18924
CLAVE = "Mobile-Prueba-2026!"


def main():
    backend, url = os.path.abspath(sys.argv[1]), sys.argv[2]
    partes = urlsplit(url)
    if partes.hostname != "127.0.0.1" or partes.path != "/postgres":
        raise SystemExit("Use un cluster desechable local: 127.0.0.1/postgres")
    sys.path.insert(0, backend)
    import bcrypt
    import psycopg

    nombre = f"xentinel_movil_{os.getpid()}_{int(time.time())}"
    with psycopg.connect(url, autocommit=True) as raiz:
        raiz.execute(f'CREATE DATABASE "{nombre}"')
    prueba = urlunsplit(partes._replace(path=f"/{nombre}"))
    entorno = {
        **os.environ,
        "NODE_ENV": "test",
        "DATABASE_URL": prueba,
        "JWT_SECRET": secrets.token_hex(32),
        "MAIL_ENCRYPTION_KEY": secrets.token_hex(32),
        "WEB_ORIGINS": "http://localhost:5173",
        "RESET_PASSWORD_URL": "http://localhost:8000/restablecer-contrasena",
        "HOST": "127.0.0.1",
        "PORT": str(PUERTO),
    }
    servidor = None
    try:
        subprocess.run(
            [sys.executable, "-m", "xentinel", "migrar"],
            cwd=backend,
            env=entorno,
            check=True,
        )
        hash_clave = bcrypt.hashpw(CLAVE.encode(), bcrypt.gensalt(12)).decode()
        with psycopg.connect(prueba, autocommit=True) as db:
            for documento, rol, nombre_persona in (
                ("90001", "Administrador", "María Prueba"),
                ("90002", "Aprendiz", "Andrés Prueba"),
                ("90003", "Celador", "Lucía Portería"),
            ):
                db.execute(
                    """INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,
                    correo,contrasena,id_rol) SELECT %s,'CC',%s,%s,%s,id_rol FROM rol
                    WHERE nombre_rol=%s""",
                    (
                        nombre_persona,
                        documento,
                        f"{documento}@mobile-test.example",
                        hash_clave,
                        rol,
                    ),
                )
        servidor = subprocess.Popen(
            [sys.executable, "-m", "xentinel", "servir"], cwd=backend, env=entorno
        )
        print(
            f"SMOKE_READY http://127.0.0.1:{PUERTO}/api/v1 (escriba stop para terminar)",
            flush=True,
        )
        detener = threading.Event()
        # SIGTERM o SIGINT (también en segundo plano) detienen y limpian la base.
        for senal in (signal.SIGTERM, signal.SIGINT):
            signal.signal(senal, lambda *_: detener.set())
        threading.Thread(
            target=lambda: (sys.stdin.readline(), detener.set()), daemon=True
        ).start()
        while not detener.is_set() and servidor.poll() is None:
            detener.wait(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        if servidor and servidor.poll() is None:
            servidor.terminate()
            servidor.wait(timeout=20)
        with psycopg.connect(url, autocommit=True) as raiz:
            raiz.execute(f'DROP DATABASE IF EXISTS "{nombre}" WITH (FORCE)')


if __name__ == "__main__":
    main()

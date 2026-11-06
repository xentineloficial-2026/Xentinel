# API de Xentinel lista para cualquier proveedor que ejecute contenedores.
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Solo lo necesario para ejecutar: los secretos llegan como variables de entorno.
COPY xentinel ./xentinel
COPY public ./public
COPY sql ./sql

RUN useradd --create-home xentinel
USER xentinel

# HOST y PORT los define el proveedor; las migraciones corren antes de iniciar.
CMD ["sh", "-c", "python -m xentinel migrar && python -m xentinel servir"]

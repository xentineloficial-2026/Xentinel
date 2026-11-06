# Verificación de entrega — 22 de octubre de 2026

Resultado: **19 pruebas aprobadas, 0 fallidas, 0 omitidas**. Duración de la última ejecución: aproximadamente 15 segundos. PostgreSQL 17.9 en un cluster temporal separado, escuchando únicamente en 127.0.0.1:55439. La base operativa no fue modificada.

Se verificó:

- Instalación nueva, repetición de migraciones con checksum e instalación mediante el SQL independiente.
- Restauración del dump original y conservación de cantidades de usuarios, ingresos y asignaciones.
- CORS Web, clientes sin Origin, preflight, permisos, JWT inválido y JWT vencido.
- Nombres reales en login/perfil, alias para la Web y actualización del saludo sin cerrar sesión.
- Registro sin escalada de privilegios, hash bcrypt y unicidad del correo normalizado.
- Ingresos con permisos, alternancia entrada/salida y reintentos concurrentes sin duplicación.
- Alertas sísmicas/meteorológicas, varias activas, emisor autenticado, cierre e historial.
- Validación y privacidad SOS; reportes normalizados con pertenencia a ficha.
- SSE desde cambios SQL externos, privacidad de eventos, cursores y rollback sin publicación.
- Recuperación genérica, cola cifrada, token almacenado como hash, correo destinatario, vencimiento, concurrencia, consumo único y revocación.
- Cambios de credenciales por SQL que revocan JWT y recuperación.
- Página de recuperación, ausencia de publicación de archivos históricos, errores uniformes y límites de solicitudes.

Comprobaciones adicionales: `node --check` sobre los módulos; `npm run format:check`; `npm audit --omit=dev --audit-level=high` con **0 vulnerabilidades** reportadas. `package-lock.json` fija las versiones instaladas.

Para repetir: configurar `TEST_DATABASE_URL` apuntando a PostgreSQL desechable; opcionalmente `ORIGINAL_DUMP_PATH` al dump y `PSQL_PATH` al ejecutable psql. Ejecutar `npm test`. Las pruebas crean/eliminan sus propias bases con nombres exclusivos. No usar una URL de producción.

El SMTP se verificó mediante transporte simulado; no se enviaron correos reales. No se probó una app móvil en dispositivo ni se adaptó toda la Web anterior. La entrega no incluye fuente oficial automática de alertas ni notificaciones FCM/APNs para una aplicación cerrada. El contrato y los pasos de integración están en `API.md` y `README.md`.

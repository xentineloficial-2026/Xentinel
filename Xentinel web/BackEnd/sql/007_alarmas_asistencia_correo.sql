-- Estados de asistencia: «Retrasado» pasa a llamarse «Retardo» y se agrega «Ausente».
-- «Sin registro» se conserva: es el día sin escaneo que todavía nadie calificó.
UPDATE asistencia SET estado = 'Retardo' WHERE estado = 'Retrasado';

-- Cambio de correo con código: el mismo almacén de códigos sirve para recuperar la
-- contraseña y para confirmar un correo nuevo; la cola de correo no cambia.
ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS proposito varchar(20) NOT NULL DEFAULT 'recuperacion',
  ADD COLUMN IF NOT EXISTS correo_nuevo varchar(254);
ALTER TABLE password_reset_tokens DROP CONSTRAINT IF EXISTS password_reset_proposito;
ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_proposito CHECK (
  (proposito = 'recuperacion' AND correo_nuevo IS NULL)
  OR (proposito = 'cambio_correo' AND correo_nuevo IS NOT NULL)
);

-- Alarmas por escaneo: un carnet QR vencido (amarillo) o que no es verídico (rojo).
-- No se guarda el contenido leído, solo su huella SHA-256 para agrupar repeticiones.
CREATE TABLE IF NOT EXISTS alarmas_qr (
  id_alarma bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  motivo varchar(20) NOT NULL CHECK (motivo IN ('QR_VENCIDO', 'QR_INVALIDO')),
  semaforo varchar(10) NOT NULL CHECK (semaforo IN ('rojo', 'amarillo')),
  -- Titular comprobado por la firma (solo en un carnet auténtico vencido).
  id_usuarios integer REFERENCES usuarios(id_usuarios) ON DELETE SET NULL,
  -- Lo que el código dice ser, sin verificar: orienta la revisión, no identifica.
  id_reclamado bigint,
  tipo_movimiento varchar(10) CHECK (tipo_movimiento IN ('ENTRADA', 'SALIDA')),
  detalle varchar(300) NOT NULL,
  huella char(64) NOT NULL,
  registrado_por integer REFERENCES usuarios(id_usuarios) ON DELETE SET NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  atendida_en timestamptz,
  atendida_por integer REFERENCES usuarios(id_usuarios) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS alarmas_qr_pendientes_idx ON alarmas_qr(creado_en DESC) WHERE atendida_en IS NULL;
CREATE INDEX IF NOT EXISTS alarmas_qr_huella_idx ON alarmas_qr(huella, creado_en DESC);
ALTER TABLE alarmas_qr ENABLE ROW LEVEL SECURITY;
-- La web y la app de control se enteran al instante, como con las demás tablas.
CREATE OR REPLACE TRIGGER xentinel_change AFTER INSERT OR UPDATE OR DELETE ON alarmas_qr
  FOR EACH ROW EXECUTE FUNCTION xentinel_emit_event('id_alarma');
CREATE OR REPLACE TRIGGER xentinel_truncate AFTER TRUNCATE ON alarmas_qr
  FOR EACH STATEMENT EXECUTE FUNCTION xentinel_emit_event();

-- Los simulacros de la API de riesgos se guardan aparte de los reportes reales.
ALTER TABLE sismos_detectados DROP CONSTRAINT IF EXISTS sismos_detectados_fuente_check;
ALTER TABLE sismos_detectados ADD CONSTRAINT sismos_detectados_fuente_check
  CHECK (fuente IN ('EMSC', 'USGS', 'PRUEBA'));

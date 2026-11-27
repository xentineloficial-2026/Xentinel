-- Asistencia para todas las personas y gestión completa de fichas.

-- Toda persona que entra a la sede deja su asistencia del día, tenga o no una ficha con
-- jornada. Sin jornada no hay hora de inicio contra la cual medir el retardo: queda
-- «Presente» y la fila no apunta a ninguna jornada.
ALTER TABLE asistencia ALTER COLUMN id_jornada DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asistencia_sin_jornada_idx
  ON asistencia(id_usuarios, fecha) WHERE id_jornada IS NULL;

-- Las entradas permitidas que no dejaron asistencia (personas sin ficha o sin jornada)
-- se recuperan: primera entrada y última salida de cada día, en hora de Bogotá.
INSERT INTO asistencia(id_usuarios, fecha, hora_entrada, hora_salida, estado)
SELECT m.id_usuarios, m.fecha,
  min(m.hora) FILTER (WHERE m.tipo = 'ENTRADA'),
  max(m.hora) FILTER (WHERE m.tipo = 'SALIDA'),
  'Presente'
FROM (
  SELECT id_usuarios, tipo,
    (fechahora AT TIME ZONE 'America/Bogota')::date AS fecha,
    (fechahora AT TIME ZONE 'America/Bogota')::time(0) AS hora
  FROM acceso WHERE estado = 'Permitido'
) m
WHERE NOT EXISTS (
  SELECT 1 FROM asistencia a WHERE a.id_usuarios = m.id_usuarios AND a.fecha = m.fecha
)
GROUP BY m.id_usuarios, m.fecha
HAVING count(*) FILTER (WHERE m.tipo = 'ENTRADA') > 0
ON CONFLICT DO NOTHING;

-- Nombre descriptivo de la ficha; el número sigue siendo su identificador único.
ALTER TABLE ficha ADD COLUMN IF NOT EXISTS nombre_ficha varchar(150);

-- Un aprendiz figura una sola vez en cada ficha: volver a ella reabre la misma fila y
-- el historial de traslados queda en fechaingreso y fechasalida.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aprendiz_ficha ON aprendiz_ficha(id_usuarios, id_ficha);
CREATE INDEX IF NOT EXISTS aprendiz_ficha_activa_idx
  ON aprendiz_ficha(id_ficha) WHERE fechasalida IS NULL;

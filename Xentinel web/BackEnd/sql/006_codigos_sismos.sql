-- Recuperación con código de 6 dígitos: cada código admite 5 intentos fallidos.
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS intentos integer NOT NULL DEFAULT 0;

-- Las alertas automáticas (sismos) no tienen una persona que las emita.
ALTER TABLE alertas_emergencia ALTER COLUMN emisor_id DROP NOT NULL;

-- Sismos reportados por EMSC y USGS. La pareja (fuente, evento_id) evita repetir un mismo
-- reporte; la cercanía en tiempo y distancia agrupa el mismo sismo informado por dos agencias.
CREATE TABLE IF NOT EXISTS sismos_detectados (
 id_sismo bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 fuente varchar(10) NOT NULL CHECK (fuente IN ('EMSC', 'USGS')),
 evento_id varchar(120) NOT NULL,
 magnitud numeric(3,1) NOT NULL,
 lugar varchar(200) NOT NULL,
 latitud numeric(8,4) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
 longitud numeric(8,4) NOT NULL CHECK (longitud BETWEEN -180 AND 180),
 profundidad_km numeric(6,1),
 distancia_km numeric(7,1) NOT NULL,
 ocurrido_en timestamptz NOT NULL,
 recibido_en timestamptz NOT NULL DEFAULT now(),
 id_alerta integer REFERENCES alertas_emergencia(id_alerta) ON DELETE SET NULL,
 UNIQUE (fuente, evento_id)
);
CREATE INDEX IF NOT EXISTS sismos_ocurrido_idx ON sismos_detectados(ocurrido_en DESC);
ALTER TABLE sismos_detectados ENABLE ROW LEVEL SECURITY;

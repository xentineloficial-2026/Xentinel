-- El estado de catálogo es independiente de las fichas, horarios y relaciones históricas.
ALTER TABLE programa ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS programa_activo_orden ON programa(activo, id_programa);
CREATE INDEX IF NOT EXISTS ficha_programa_orden ON ficha(id_programa, id_ficha);
CREATE INDEX IF NOT EXISTS horarios_ficha_orden ON horarios(id_ficha, id_horario);

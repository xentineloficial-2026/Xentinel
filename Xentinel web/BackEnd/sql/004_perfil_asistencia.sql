-- Estados de asistencia unificados, edición manual con autoría y fotos de perfil.

-- Un solo vocabulario para la base, la web y los reportes.
UPDATE asistencia SET estado = 'Retrasado'
WHERE estado ILIKE '%tard%' OR estado ILIKE '%retra%';
UPDATE asistencia SET estado = 'Presente'
WHERE estado NOT IN ('Retrasado', 'Sin registro');

-- Quién cambió el estado a mano y cuándo, para atender reclamos.
ALTER TABLE asistencia
  ADD COLUMN IF NOT EXISTS modificado_por integer REFERENCES usuarios(id_usuarios) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modificado_en timestamptz;

-- La foto vive en la base: no se pierde al reiniciar el servidor.
CREATE TABLE IF NOT EXISTS usuario_foto (
  id_usuarios integer PRIMARY KEY REFERENCES usuarios(id_usuarios) ON DELETE CASCADE,
  contenido bytea NOT NULL,
  tipo varchar(20) NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png', 'image/gif')),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuario_foto_tamano CHECK (octet_length(contenido) <= 3145728)
);

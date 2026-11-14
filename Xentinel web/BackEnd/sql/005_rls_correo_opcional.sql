-- Las bases creadas desde el volcado anterior exigían correo y asignaban el rol 1 por
-- omisión; el esquema actual admite el correo vacío y exige indicar el rol.
ALTER TABLE usuarios ALTER COLUMN correo DROP NOT NULL;
ALTER TABLE usuarios ALTER COLUMN id_rol DROP DEFAULT;
-- La API es el único cliente de la base. Sin políticas, RLS niega el acceso directo de
-- cualquier otro rol (p. ej. la API de datos de Supabase); el dueño de las tablas no cambia.
DO $$
DECLARE tabla record;
BEGIN
 FOR tabla IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=current_schema() AND c.relkind IN ('r','p') AND pg_get_userbyid(c.relowner)=current_user
 LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla.relname);
 END LOOP;
END $$;

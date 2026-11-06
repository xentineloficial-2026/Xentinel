-- No elimina ingresos, asistencias ni duplicados. Una anomalía hace rollback y exige revisión.
CREATE UNIQUE INDEX IF NOT EXISTS rol_nombre_normalizado_idx ON rol(lower(nombre_rol));
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url varchar(255);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_pos varchar(120);
ALTER TABLE usuarios ALTER COLUMN correo TYPE varchar(254);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS requiere_restablecimiento boolean NOT NULL DEFAULT false;
CREATE FUNCTION xentinel_revoke_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.contrasena IS DISTINCT FROM OLD.contrasena OR NEW.correo IS DISTINCT FROM OLD.correo
 OR NEW.id_rol IS DISTINCT FROM OLD.id_rol OR NEW.estado IS DISTINCT FROM OLD.estado THEN
  NEW.auth_version=OLD.auth_version+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER xentinel_credentials BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION xentinel_revoke_sessions();
-- Las contraseñas expuestas en el dump no se reutilizan. Su recuperación se realiza por correo.
UPDATE usuarios SET contrasena='!reset-required!', requiere_restablecimiento=true, auth_version=auth_version+1
 WHERE contrasena !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$';
UPDATE usuarios SET correo=NULLIF(lower(btrim(correo)), '');
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_normalizado ON usuarios(lower(btrim(correo))) WHERE correo IS NOT NULL;
CREATE INDEX IF NOT EXISTS usuarios_rol_idx ON usuarios(id_rol);
ALTER TABLE acceso ADD COLUMN IF NOT EXISTS registrado_por integer REFERENCES usuarios(id_usuarios);
ALTER TABLE acceso ADD COLUMN IF NOT EXISTS request_id uuid UNIQUE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='acceso' AND column_name='fechahora' AND data_type='timestamp without time zone') THEN
  ALTER TABLE acceso ALTER COLUMN fechahora TYPE timestamptz USING fechahora AT TIME ZONE 'America/Bogota';
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='estado_aprendiz' AND column_name='fechahoraingreso' AND data_type='timestamp without time zone') THEN
  ALTER TABLE estado_aprendiz ALTER COLUMN fechahoraingreso TYPE timestamptz USING fechahoraingreso AT TIME ZONE 'America/Bogota';
 END IF;
END $$;
ALTER TABLE acceso ADD CONSTRAINT acceso_tipo_valido CHECK (tipo IN ('ENTRADA','SALIDA'));
ALTER TABLE acceso ADD CONSTRAINT acceso_estado_valido CHECK (estado IN ('Permitido','Denegado'));
ALTER TABLE acceso ADD CONSTRAINT acceso_metodo_valido CHECK (metodo IN ('Manual','QR'));
CREATE INDEX IF NOT EXISTS acceso_usuario_fecha_idx ON acceso(id_usuarios,fechahora DESC);
CREATE INDEX IF NOT EXISTS acceso_fecha_idx ON acceso(fechahora DESC);
CREATE UNIQUE INDEX IF NOT EXISTS asistencia_unica_idx ON asistencia(id_usuarios,id_jornada,fecha);
CREATE INDEX IF NOT EXISTS asistencia_jornada_idx ON asistencia(id_jornada,fecha);
CREATE INDEX IF NOT EXISTS aprendiz_ficha_usuario_idx ON aprendiz_ficha(id_usuarios,id_ficha);
CREATE INDEX IF NOT EXISTS aprendiz_ficha_ficha_idx ON aprendiz_ficha(id_ficha);
CREATE INDEX IF NOT EXISTS instructor_ficha_usuario_idx ON instructor_ficha(id_usuarios,id_ficha);
CREATE INDEX IF NOT EXISTS instructor_ficha_ficha_idx ON instructor_ficha(id_ficha);
ALTER TABLE aprendiz_ficha ADD CONSTRAINT aprendiz_fechas_validas CHECK (fechasalida IS NULL OR fechaingreso IS NULL OR fechasalida>=fechaingreso);
ALTER TABLE ficha ADD CONSTRAINT ficha_fechas_validas CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin>=fecha_inicio);
ALTER TABLE horarios ADD CONSTRAINT horarios_horas_validas CHECK (hora_fin>hora_inicio);
CREATE UNIQUE INDEX IF NOT EXISTS horarios_no_duplicados_idx ON horarios(id_ficha,dia_semana,hora_inicio,nombre_clase);
CREATE INDEX IF NOT EXISTS horarios_instructor_idx ON horarios(id_instructor);
CREATE INDEX IF NOT EXISTS ficha_programa_idx ON ficha(id_programa);
CREATE INDEX IF NOT EXISTS jornada_ficha_idx ON jornada(id_ficha);
ALTER TABLE solicitudes_horario ADD COLUMN IF NOT EXISTS respuesta_admin text;
ALTER TABLE solicitudes_horario ADD COLUMN IF NOT EXISTS fecha_respuesta timestamptz;
ALTER TABLE solicitudes_horario ADD COLUMN IF NOT EXISTS id_admin integer REFERENCES usuarios(id_usuarios);
ALTER TABLE solicitudes_horario ADD COLUMN IF NOT EXISTS leida_instructor boolean NOT NULL DEFAULT false;
-- El rol de asistencia se obtiene de usuarios; si una instalación antigua aún tiene la columna,
-- se conserva para revisión histórica pero deja de ser obligatoria para las nuevas escrituras.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asistencia' AND column_name='id_rol') THEN
  ALTER TABLE asistencia ALTER COLUMN id_rol DROP NOT NULL;
  COMMENT ON COLUMN asistencia.id_rol IS 'Obsoleta: usar usuarios.id_rol. Se conserva sólo para revisión histórica.';
 END IF;
END $$;
ALTER TABLE alertas_emergencia ADD COLUMN IF NOT EXISTS severidad varchar(20) NOT NULL DEFAULT 'alta';
ALTER TABLE alertas_emergencia ADD COLUMN IF NOT EXISTS fuente varchar(120) NOT NULL DEFAULT 'Operador SENA';
ALTER TABLE alertas_emergencia ADD COLUMN IF NOT EXISTS referencia_externa varchar(200);
ALTER TABLE alertas_emergencia ADD COLUMN IF NOT EXISTS cerrada_por integer REFERENCES usuarios(id_usuarios);
ALTER TABLE alertas_emergencia ADD CONSTRAINT alerta_severidad_valida CHECK (severidad IN ('informativa','moderada','alta','critica'));
ALTER TABLE alertas_emergencia ADD CONSTRAINT alerta_fechas_validas CHECK (fecha_fin IS NULL OR fecha_fin>=fecha_inicio);
CREATE UNIQUE INDEX IF NOT EXISTS alerta_fuente_referencia_idx ON alertas_emergencia(fuente,referencia_externa) WHERE referencia_externa IS NOT NULL;
CREATE INDEX IF NOT EXISTS alerta_fecha_idx ON alertas_emergencia(fecha_inicio DESC);
CREATE INDEX IF NOT EXISTS alerta_activa_idx ON alertas_emergencia(id_alerta) WHERE activa;
ALTER TABLE ubicaciones_sos ALTER COLUMN latitud TYPE numeric(9,6) USING latitud::numeric;
ALTER TABLE ubicaciones_sos ALTER COLUMN longitud TYPE numeric(9,6) USING longitud::numeric;
ALTER TABLE ubicaciones_sos ADD CONSTRAINT sos_latitud_valida CHECK (latitud BETWEEN -90 AND 90);
ALTER TABLE ubicaciones_sos ADD CONSTRAINT sos_longitud_valida CHECK (longitud BETWEEN -180 AND 180);
-- Lista normalizada con claves foráneas; el texto antiguo se conserva exclusivamente para auditoría.
CREATE TABLE reporte_estudiantes (
 id_reporte integer NOT NULL REFERENCES reportes_pase_lista(id_reporte) ON DELETE CASCADE,
 id_usuarios integer NOT NULL REFERENCES usuarios(id_usuarios), presente boolean NOT NULL,
 PRIMARY KEY(id_reporte,id_usuarios)
);
COMMENT ON COLUMN reportes_pase_lista.estudiantes_presentes IS 'Legado sin confianza: no consumir desde API; usar reporte_estudiantes. Reconciliar nombres antiguos manualmente.';
CREATE TABLE password_reset_tokens (
 id_token bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_usuarios integer NOT NULL REFERENCES usuarios(id_usuarios) ON DELETE CASCADE,
 token_hash char(64) NOT NULL UNIQUE, token_expiracion timestamptz NOT NULL,
 creado_en timestamptz NOT NULL DEFAULT now(), usado_en timestamptz,
 CHECK(token_expiracion>creado_en)
);
CREATE INDEX password_reset_usuario_idx ON password_reset_tokens(id_usuarios);
CREATE INDEX password_reset_expiracion_idx ON password_reset_tokens(token_expiracion) WHERE usado_en IS NULL;
CREATE FUNCTION xentinel_invalidate_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.contrasena IS DISTINCT FROM OLD.contrasena OR NEW.correo IS DISTINCT FROM OLD.correo OR NEW.estado IS DISTINCT FROM OLD.estado THEN
  UPDATE password_reset_tokens SET usado_en=now() WHERE id_usuarios=NEW.id_usuarios AND usado_en IS NULL;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER xentinel_recovery AFTER UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION xentinel_invalidate_recovery();
CREATE TABLE mail_outbox (
 id_mail bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_token bigint NOT NULL REFERENCES password_reset_tokens(id_token) ON DELETE CASCADE,
 payload_encrypted text, intentos integer NOT NULL DEFAULT 0,
 siguiente_intento timestamptz NOT NULL DEFAULT now(), enviado_en timestamptz, error_codigo varchar(50)
);
CREATE INDEX mail_pendiente_idx ON mail_outbox(siguiente_intento) WHERE enviado_en IS NULL;
CREATE TABLE api_rate_limits (key char(64) PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX rate_limit_expiry_idx ON api_rate_limits(expires_at);
-- Repara relaciones ausentes también cuando las tablas ya existían antes de las migraciones.
DO $$
DECLARE item record; source_att smallint; target_att smallint;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('usuarios','id_rol','rol','id_rol'),('ficha','id_programa','programa','id_programa'),
 ('jornada','id_ficha','ficha','id_ficha'),('acceso','id_usuarios','usuarios','id_usuarios'),
 ('acceso','registrado_por','usuarios','id_usuarios'),('aprendiz_ficha','id_usuarios','usuarios','id_usuarios'),
 ('aprendiz_ficha','id_ficha','ficha','id_ficha'),('instructor_ficha','id_usuarios','usuarios','id_usuarios'),
 ('instructor_ficha','id_ficha','ficha','id_ficha'),('estado_aprendiz','id_usuarios','usuarios','id_usuarios'),
 ('estado_aprendiz','id_ficha','ficha','id_ficha'),('asistencia','id_usuarios','usuarios','id_usuarios'),
 ('asistencia','id_jornada','jornada','id_jornada'),('horarios','id_ficha','ficha','id_ficha'),
 ('horarios','id_instructor','usuarios','id_usuarios'),('horario_archivo','id_ficha','ficha','id_ficha'),
 ('horario_archivo','id_usuarios','usuarios','id_usuarios'),('solicitudes_horario','id_horario','horarios','id_horario'),
 ('solicitudes_horario','id_ficha','ficha','id_ficha'),('solicitudes_horario','id_instructor','usuarios','id_usuarios'),
 ('solicitudes_horario','id_admin','usuarios','id_usuarios'),('alertas_emergencia','emisor_id','usuarios','id_usuarios'),
 ('alertas_emergencia','cerrada_por','usuarios','id_usuarios'),('reportes_pase_lista','id_alerta','alertas_emergencia','id_alerta'),
 ('reportes_pase_lista','id_instructor','usuarios','id_usuarios'),('reportes_pase_lista','id_ficha','ficha','id_ficha'),
 ('ubicaciones_sos','id_alerta','alertas_emergencia','id_alerta'),('ubicaciones_sos','id_aprendiz','usuarios','id_usuarios')
 ) t(tabla,columna,destino,pk)
 LOOP
  SELECT attnum INTO source_att FROM pg_attribute WHERE attrelid=item.tabla::regclass AND attname=item.columna;
  SELECT attnum INTO target_att FROM pg_attribute WHERE attrelid=item.destino::regclass AND attname=item.pk;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid=item.tabla::regclass
    AND confrelid=item.destino::regclass AND conkey=ARRAY[source_att] AND confkey=ARRAY[target_att]) THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(%I) REFERENCES %I(%I)',item.tabla,'fk_api_'||item.tabla||'_'||item.columna,item.columna,item.destino,item.pk);
  END IF;
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(%I)','idx_fk_'||item.tabla||'_'||item.columna,item.tabla,item.columna);
 END LOOP;
END $$;
CREATE TABLE api_events (
 id_evento bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 recurso text NOT NULL, operacion text NOT NULL, registro_id text, propietario_id integer,
 creado_en timestamptz NOT NULL DEFAULT now()
);
-- Sólo metadatos. Nunca publicar contraseñas, correos, coordenadas o tokens en el canal.
CREATE FUNCTION xentinel_emit_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; owner_id integer; record_id text;
BEGIN
 -- Orden de confirmación igual al cursor SSE, incluso con transacciones concurrentes.
 PERFORM pg_advisory_xact_lock(91734201);
 IF TG_OP <> 'TRUNCATE' THEN
  IF TG_OP='DELETE' THEN row_data=to_jsonb(OLD); ELSE row_data=to_jsonb(NEW); END IF;
  record_id=row_data->>TG_ARGV[0];
  IF TG_NARGS>1 THEN owner_id=(row_data->>TG_ARGV[1])::integer; END IF;
 END IF;
 INSERT INTO api_events(recurso,operacion,registro_id,propietario_id) VALUES(TG_TABLE_NAME,TG_OP,record_id,owner_id);
 RETURN NULL;
END $$;
DO $$
DECLARE item record;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('usuarios','id_usuarios','id_usuarios'),('acceso','id_acceso','id_usuarios'),
 ('alertas_emergencia','id_alerta',''),('asistencia','id_asistencia','id_usuarios'),
 ('reportes_pase_lista','id_reporte','id_instructor'),('reporte_estudiantes','id_reporte','id_usuarios'),
 ('ubicaciones_sos','id_sos','id_aprendiz'),('aprendiz_ficha','id_aprendiz_ficha','id_usuarios'),
 ('instructor_ficha','id_instructor_ficha','id_usuarios'),('estado_aprendiz','id_estado_aprendiz_ficha','id_usuarios'),
 ('ficha','id_ficha',''),('programa','id_programa',''),('rol','id_rol',''),('jornada','id_jornada',''),
 ('horarios','id_horario',''),('horario_archivo','id_archivo','id_usuarios'),('solicitudes_horario','id_solicitud','id_instructor')
 ) AS t(tabla,pk,owner_col)
 LOOP
  EXECUTE format('CREATE TRIGGER xentinel_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION xentinel_emit_event(%L%s)',
    item.tabla,item.pk,CASE WHEN item.owner_col='' THEN '' ELSE ','||quote_literal(item.owner_col) END);
  EXECUTE format('CREATE TRIGGER xentinel_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION xentinel_emit_event()', item.tabla);
 END LOOP;
END $$;

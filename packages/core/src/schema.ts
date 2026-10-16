/**
 * Esquema PostgreSQL 16 del Banco de Evaluaciones.
 *
 * El mismo SQL se ejecuta en el servidor (PostgreSQL real) y en el demo del
 * navegador (PGlite, PostgreSQL compilado a WebAssembly), así que no hay dos
 * implementaciones distintas de la base de datos.
 */
export const SCHEMA_SQL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() no es IMMUTABLE; este envoltorio permite usarla en índices.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ===== Catálogo curricular (en el SGA real viene del componente Currículum) =====
CREATE TABLE career (
  id    serial PRIMARY KEY,
  code  text NOT NULL UNIQUE,
  name  text NOT NULL,
  taxonomy text NOT NULL DEFAULT 'bloom'
);

CREATE TABLE module (
  id    serial PRIMARY KEY,
  career_id int NOT NULL REFERENCES career(id),
  code  text NOT NULL UNIQUE,
  name  text NOT NULL,
  program_version text NOT NULL
);

CREATE TABLE outcome (
  id    serial PRIMARY KEY,
  module_id int NOT NULL REFERENCES module(id),
  code  text NOT NULL,
  text  text NOT NULL,
  UNIQUE (module_id, code)
);

CREATE TABLE criterion (
  id    serial PRIMARY KEY,
  outcome_id int NOT NULL REFERENCES outcome(id),
  code  text NOT NULL,
  text  text NOT NULL,
  UNIQUE (outcome_id, code)
);

-- ===== Identidad (en el SGA real: proveedor de identidad institucional) =====
CREATE TABLE app_user (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  role  text NOT NULL CHECK (role IN ('docente','jefatura','revisor','area_curricular','uta','admin')),
  career_id int REFERENCES career(id)
);

-- ===== Banco de ítems =====
CREATE TABLE item (
  id          serial PRIMARY KEY,
  author_id   int NOT NULL REFERENCES app_user(id),
  status      text NOT NULL DEFAULT 'borrador'
              CHECK (status IN ('borrador','recepcionado','en_revision','devuelto','visado')),
  archived    boolean NOT NULL DEFAULT false,
  current_version int,
  published_version int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cada guardado confirmado crea una versión INMUTABLE (RF-06).
CREATE TABLE item_version (
  id          serial PRIMARY KEY,
  item_id     int NOT NULL REFERENCES item(id),
  version_no  int NOT NULL,
  author_id   int NOT NULL REFERENCES app_user(id),
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  type        text NOT NULL CHECK (type IN ('seleccion_multiple','verdadero_falso','respuesta_breve','pareados','desarrollo')),
  stem        text NOT NULL,
  payload     jsonb NOT NULL,
  points      numeric(5,2) NOT NULL CHECK (points > 0),
  module_id   int NOT NULL REFERENCES module(id),
  outcome_id  int NOT NULL REFERENCES outcome(id),
  criterion_id int REFERENCES criterion(id),
  bloom_level smallint NOT NULL CHECK (bloom_level BETWEEN 1 AND 6),
  difficulty  smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  program_version text NOT NULL,
  ai_generated boolean NOT NULL DEFAULT false,
  search_text text GENERATED ALWAYS AS (lower(f_unaccent(stem))) STORED,
  UNIQUE (item_id, version_no)
);

ALTER TABLE item ADD FOREIGN KEY (current_version) REFERENCES item_version(id);
ALTER TABLE item ADD FOREIGN KEY (published_version) REFERENCES item_version(id);

CREATE INDEX item_version_trgm ON item_version USING gin (search_text gin_trgm_ops);
CREATE INDEX item_version_item ON item_version (item_id);

-- La inmutabilidad se garantiza en la base de datos, no solo en la interfaz:
-- ni la API ni un acceso directo pueden modificar o borrar una versión.
CREATE OR REPLACE FUNCTION forbid_version_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las versiones de ítems son inmutables (RF-06)';
END $$;

CREATE TRIGGER item_version_immutable
  BEFORE UPDATE OR DELETE ON item_version
  FOR EACH ROW EXECUTE FUNCTION forbid_version_change();

CREATE TABLE observation (
  id         serial PRIMARY KEY,
  item_id    int NOT NULL REFERENCES item(id),
  author_id  int NOT NULL REFERENCES app_user(id),
  text       text NOT NULL CHECK (length(trim(text)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Consulta a un par experto cuando revisor/a y docente discrepan (la decide o asigna la jefatura).
CREATE TABLE consultation (
  id           serial PRIMARY KEY,
  item_id      int NOT NULL REFERENCES item(id),
  requested_by int NOT NULL REFERENCES app_user(id),
  reason       text NOT NULL CHECK (length(trim(reason)) > 0),
  status       text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','asignada','resuelta')),
  assigned_to  int REFERENCES app_user(id),
  verdict      text CHECK (verdict IN ('clave_correcta','clave_incorrecta','pregunta_ambigua')),
  opinion      text,
  resolved_by  int REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
-- Una sola consulta abierta por ítem.
CREATE UNIQUE INDEX consultation_open ON consultation (item_id) WHERE status <> 'resuelta';

-- Sugerencias del asesor: quedan visibles para el revisor (RF-04).
CREATE TABLE advisor_decision (
  id          serial PRIMARY KEY,
  item_version_id int NOT NULL REFERENCES item_version(id),
  rule        text NOT NULL,
  message     text NOT NULL,
  decision    text NOT NULL CHECK (decision IN ('aceptada','descartada','modificada')),
  user_id     int NOT NULL REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ===== Instrumentos (pruebas) =====
CREATE TABLE instrument (
  id         serial PRIMARY KEY,
  title      text NOT NULL,
  module_id  int NOT NULL REFERENCES module(id),
  author_id  int NOT NULL REFERENCES app_user(id),
  seed       int NOT NULL DEFAULT 2026,
  exigency   numeric(4,2) NOT NULL DEFAULT 0.60 CHECK (exigency > 0 AND exigency < 1),
  minutes    int NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tabla de especificaciones: peso esperado por resultado de aprendizaje.
CREATE TABLE instrument_spec (
  instrument_id int NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  outcome_id    int NOT NULL REFERENCES outcome(id),
  weight        numeric(5,2) NOT NULL CHECK (weight >= 0 AND weight <= 100),
  PRIMARY KEY (instrument_id, outcome_id)
);

-- El instrumento fija la VERSIÓN de cada ítem (RF-06).
CREATE TABLE instrument_item (
  instrument_id   int NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  item_version_id int NOT NULL REFERENCES item_version(id),
  position        int NOT NULL,
  PRIMARY KEY (instrument_id, item_version_id)
);

-- ===== Respuestas del Aula Virtual (primer intento) para el análisis de ítems =====
CREATE TABLE attempt (
  id            serial PRIMARY KEY,
  instrument_id int NOT NULL REFERENCES instrument(id),
  student_code  text NOT NULL,           -- código anónimo, sin datos personales
  source        text NOT NULL DEFAULT 'simulado' CHECK (source IN ('simulado','hojas','moodle')),
  UNIQUE (instrument_id, student_code)
);

CREATE TABLE answer (
  attempt_id      int NOT NULL REFERENCES attempt(id) ON DELETE CASCADE,
  item_version_id int NOT NULL REFERENCES item_version(id),
  choice          text,                  -- alternativa elegida (A, B, C...) si aplica
  score           numeric(5,2) NOT NULL,
  PRIMARY KEY (attempt_id, item_version_id)
);

-- ===== Auditoría =====
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    int REFERENCES app_user(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  int,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ===== Uso del asistente de IA (modelo, tokens, costo estimado) =====
CREATE TABLE ai_usage (
  id         serial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    int NOT NULL REFERENCES app_user(id),
  provider   text NOT NULL,
  model      text NOT NULL,
  tokens_in  int NOT NULL,
  tokens_out int NOT NULL,
  cost_clp   numeric(10,2) NOT NULL,
  accepted   int NOT NULL,
  discarded  int NOT NULL
);

-- ===== Parámetros institucionales (modificables sin desplegar código) =====
CREATE TABLE setting (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
`;

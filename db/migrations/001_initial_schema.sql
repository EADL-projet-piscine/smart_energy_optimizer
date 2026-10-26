-- 001 — schéma initial EnerVision.
--
-- Tables : sites, users, roles, role_user, current, predictions.
-- current est temporaire : le modèle de données préparé pour le Machine Learning
-- n'est pas encore figé. Les historiques de /api/v1/readings ne sont pas stockés.
--
-- Les droits des rôles enervision_app et enervision_ml sont dans db/init/03_grants.sql.
-- Ce script reste applicable sans ces rôles (la CI, par exemple).

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (btrim(email) <> '' AND position('@' IN email) > 1),
  CONSTRAINT users_display_name_not_blank CHECK (btrim(display_name) <> ''),
  -- Jamais le mot de passe en clair : un condensé bcrypt ou argon2 dépasse 20 caractères.
  CONSTRAINT users_password_is_hash CHECK (
    char_length(password_hash) >= 20 AND password_hash <> email
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS roles (
  id smallserial PRIMARY KEY,
  code text NOT NULL,
  label text NOT NULL,
  CONSTRAINT roles_code_unique UNIQUE (code),
  CONSTRAINT roles_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT roles_label_not_blank CHECK (btrim(label) <> '')
);

INSERT INTO roles (code, label)
VALUES
  ('admin', 'Administrateur'),
  ('operator', 'Exploitant'),
  ('viewer', 'Lecteur')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_user (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id smallint NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS role_user_role_id_idx ON role_user (role_id);

CREATE TABLE IF NOT EXISTS sites (
  site_id text PRIMARY KEY,
  site_name text NOT NULL,
  site_type text,
  capacity_kw numeric(12, 3),
  -- L'API source ne fournit pas le client. Le lien reste vide tant que l'application ne l'affecte pas.
  client_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sites_site_id_not_blank CHECK (btrim(site_id) <> ''),
  CONSTRAINT sites_name_not_blank CHECK (btrim(site_name) <> ''),
  CONSTRAINT sites_capacity_non_negative CHECK (capacity_kw IS NULL OR capacity_kw >= 0)
);

-- Une base déjà amorcée (site_id et site_type seulement) reçoit les colonnes manquantes.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_name text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS capacity_kw numeric(12, 3);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS client_user_id uuid;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE sites ALTER COLUMN site_type DROP NOT NULL;
UPDATE sites SET site_name = site_id WHERE site_name IS NULL;
UPDATE sites SET created_at = updated_at WHERE created_at IS NULL;
ALTER TABLE sites ALTER COLUMN site_name SET NOT NULL;
ALTER TABLE sites ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE sites ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_site_id_not_blank') THEN
    ALTER TABLE sites ADD CONSTRAINT sites_site_id_not_blank CHECK (btrim(site_id) <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_name_not_blank') THEN
    ALTER TABLE sites ADD CONSTRAINT sites_name_not_blank CHECK (btrim(site_name) <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_capacity_non_negative') THEN
    ALTER TABLE sites
      ADD CONSTRAINT sites_capacity_non_negative CHECK (capacity_kw IS NULL OR capacity_kw >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_client_user_id_fkey') THEN
    ALTER TABLE sites
      ADD CONSTRAINT sites_client_user_id_fkey
      FOREIGN KEY (client_user_id) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sites_client_user_id_idx
ON sites (client_user_id)
WHERE client_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS sites_set_updated_at ON sites;
CREATE TRIGGER sites_set_updated_at
BEFORE UPDATE ON sites
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Mesure courante : une ligne par site, remplacée à chaque synchronisation.
-- Les colonnes reprennent /api/v1/sites/{id}/current et les champs de /api/v1/stats/summary
-- qui ne sont pas déjà portés par sites. Une valeur absente reste NULL.
CREATE TABLE IF NOT EXISTS current (
  site_id text PRIMARY KEY REFERENCES sites (site_id) ON DELETE CASCADE,
  measured_at timestamptz NOT NULL,
  consumption_kw numeric(12, 3),
  consumption_kwh numeric(12, 3),
  voltage_v numeric(8, 3),
  current_a numeric(10, 3),
  power_factor numeric(5, 3),
  temperature_celsius numeric(6, 2),
  humidity_percent numeric(6, 2),
  load_percent numeric(6, 2),
  data_quality text,
  null_reasons text[] NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS current_measured_at_idx ON current (measured_at);

DROP TRIGGER IF EXISTS current_set_updated_at ON current;
CREATE TRIGGER current_set_updated_at
BEFORE UPDATE ON current
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Reprise d'un essai antérieur nommé current_readings : une ligne par site, puis suppression.
DO $$
BEGIN
  IF to_regclass('public.current_readings') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $migrate$
    INSERT INTO current (
      site_id,
      measured_at,
      consumption_kw,
      consumption_kwh,
      voltage_v,
      current_a,
      power_factor,
      temperature_celsius,
      humidity_percent,
      data_quality,
      null_reasons,
      fetched_at
    )
    SELECT DISTINCT ON (site_id)
      site_id,
      measured_at,
      consumption_kw::numeric(12, 3),
      consumption_kwh::numeric(12, 3),
      voltage_v::numeric(8, 3),
      current_a::numeric(10, 3),
      power_factor::numeric(5, 3),
      temperature_celsius::numeric(6, 2),
      humidity_percent::numeric(6, 2),
      data_quality,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(null_reasons)), '{}'),
      collected_at
    FROM current_readings
    ORDER BY site_id, measured_at DESC
    ON CONFLICT (site_id) DO NOTHING
  $migrate$;

  EXECUTE 'DROP TABLE current_readings';
END $$;

CREATE TABLE IF NOT EXISTS predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites (site_id) ON DELETE CASCADE,
  predicted_kw numeric(12, 3) NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  model_name text,
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT predictions_period_order CHECK (period_end > period_start),
  CONSTRAINT predictions_value_non_negative CHECK (predicted_kw >= 0),
  CONSTRAINT predictions_site_period_model_unique
    UNIQUE NULLS NOT DISTINCT (site_id, period_start, period_end, model_version)
);

CREATE INDEX IF NOT EXISTS predictions_site_period_idx
ON predictions (site_id, period_start);

DROP TRIGGER IF EXISTS predictions_set_updated_at ON predictions;
CREATE TRIGGER predictions_set_updated_at
BEFORE UPDATE ON predictions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- En mise à jour, un type ou une capacité non renseignés ne remplacent pas la valeur déjà connue :
-- /stats/summary et /sites/{id}/current ne portent pas les mêmes champs.
CREATE OR REPLACE FUNCTION upsert_site(
  p_site_id text,
  p_site_name text,
  p_site_type text,
  p_capacity_kw numeric
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO sites (site_id, site_name, site_type, capacity_kw)
  VALUES (p_site_id, p_site_name, p_site_type, p_capacity_kw)
  ON CONFLICT (site_id) DO UPDATE SET
    site_name = EXCLUDED.site_name,
    site_type = COALESCE(EXCLUDED.site_type, sites.site_type),
    capacity_kw = COALESCE(EXCLUDED.capacity_kw, sites.capacity_kw);
$$;

-- Remplace toute la mesure du site. NULL est une mesure absente, pas « champ ignoré ».
-- Le site doit déjà exister (upsert_site d'abord).
CREATE OR REPLACE FUNCTION upsert_current(
  p_site_id text,
  p_measured_at timestamptz,
  p_consumption_kw numeric,
  p_consumption_kwh numeric,
  p_voltage_v numeric,
  p_current_a numeric,
  p_power_factor numeric,
  p_temperature_celsius numeric,
  p_humidity_percent numeric,
  p_load_percent numeric,
  p_data_quality text,
  p_null_reasons text[]
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO current (
    site_id,
    measured_at,
    consumption_kw,
    consumption_kwh,
    voltage_v,
    current_a,
    power_factor,
    temperature_celsius,
    humidity_percent,
    load_percent,
    data_quality,
    null_reasons
  )
  VALUES (
    p_site_id,
    p_measured_at,
    p_consumption_kw,
    p_consumption_kwh,
    p_voltage_v,
    p_current_a,
    p_power_factor,
    p_temperature_celsius,
    p_humidity_percent,
    p_load_percent,
    p_data_quality,
    COALESCE(p_null_reasons, '{}')
  )
  ON CONFLICT (site_id) DO UPDATE SET
    measured_at = EXCLUDED.measured_at,
    consumption_kw = EXCLUDED.consumption_kw,
    consumption_kwh = EXCLUDED.consumption_kwh,
    voltage_v = EXCLUDED.voltage_v,
    current_a = EXCLUDED.current_a,
    power_factor = EXCLUDED.power_factor,
    temperature_celsius = EXCLUDED.temperature_celsius,
    humidity_percent = EXCLUDED.humidity_percent,
    load_percent = EXCLUDED.load_percent,
    data_quality = EXCLUDED.data_quality,
    null_reasons = EXCLUDED.null_reasons,
    fetched_at = now();
$$;

-- Période couverte par la prévision : début inclus, fin exclue.
-- La même période et la même version de modèle mettent la valeur à jour.
CREATE OR REPLACE FUNCTION upsert_prediction(
  p_site_id text,
  p_predicted_kw numeric,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_model_name text,
  p_model_version text
)
RETURNS uuid
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO predictions (
    site_id,
    predicted_kw,
    period_start,
    period_end,
    model_name,
    model_version
  )
  VALUES (
    p_site_id,
    p_predicted_kw,
    p_period_start,
    p_period_end,
    p_model_name,
    p_model_version
  )
  ON CONFLICT ON CONSTRAINT predictions_site_period_model_unique DO UPDATE SET
    predicted_kw = EXCLUDED.predicted_kw,
    model_name = EXCLUDED.model_name
  RETURNING id;
$$;

COMMENT ON TABLE sites IS
  'Référentiel des sites. site_id, site_name et capacity_kw viennent de /stats/summary ; site_type de /current.';
COMMENT ON COLUMN sites.client_user_id IS
  'Client rattaché au site. Absent de l''API source, renseigné par l''application.';
COMMENT ON TABLE users IS
  'Comptes de l''application. password_hash est un condensé, jamais le mot de passe.';
COMMENT ON TABLE roles IS 'Rôles applicatifs. Les trois rôles initiaux sont admin, operator et viewer.';
COMMENT ON TABLE role_user IS 'Association plusieurs-à-plusieurs entre utilisateurs et rôles.';
COMMENT ON TABLE current IS
  'Mesure courante, une ligne par site. Table temporaire, en attendant le modèle préparé pour le ML.';
COMMENT ON COLUMN current.measured_at IS
  'Horodatage de la source, en UTC. /stats/summary le donne parfois sans fuseau : l''interpréter comme UTC.';
COMMENT ON COLUMN current.consumption_kw IS
  'consumption_kw de /current, ou current_consumption_kw de /stats/summary. NULL si la mesure manque.';
COMMENT ON COLUMN current.data_quality IS
  'Valeurs vues : good, partial, degraded, critical. Non contrainte, la source peut en ajouter.';
COMMENT ON TABLE predictions IS
  'Prévisions du bloc ML, rattachées à un site, avec la période couverte et la version du modèle.';
COMMENT ON COLUMN predictions.period_start IS 'Début de la période prédite, inclus, en UTC.';
COMMENT ON COLUMN predictions.period_end IS 'Fin de la période prédite, exclue, en UTC.';
COMMENT ON COLUMN predictions.model_version IS
  'Version ou identifiant de run (MLflow) du modèle. NULL tant que le modèle n''est pas versionné.';

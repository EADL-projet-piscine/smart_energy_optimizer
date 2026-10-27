-- 002 : origine des prévisions.
--
-- Ajoute à `predictions` ce qui manquait pour servir la bonne prévision :
-- `forecast_origin`, l'instant jusqu'auquel le modèle avait vu les données.
-- Pour un même créneau, deux prévisions coexistent — celle de 10 h et celle
-- de 16 h — et c'est la plus récemment informée qu'il faut servir.
-- `created_at` ne suffit pas : un rattrapage insère aujourd'hui des prévisions
-- d'origine ancienne, qui remonteraient en tête à tort.
--
-- Rejouable : chaque objet est supprimé avant d'être recréé.

BEGIN;

-- ── Nettoyage préalable, pour que la migration se rejoue ───────────────────
-- `horizon` est supprimée avant les contraintes qui s'y réfèrent, sans quoi
-- PostgreSQL refuserait de la retirer.
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_site_origin_model_unique;
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_horizon_range;
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_origin_before_period;
DROP INDEX IF EXISTS predictions_read_idx;
ALTER TABLE predictions DROP COLUMN IF EXISTS horizon;

-- ── L'origine de la prévision ──────────────────────────────────────────────
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS forecast_origin timestamptz;

-- La table est vide au moment où cette migration est écrite. Sur une base qui
-- porterait des lignes antérieures, les dater de leur insertion est le seul
-- repli honnête : c'est faux pour un rattrapage, mais rien d'autre n'est connu.
UPDATE predictions SET forecast_origin = created_at WHERE forecast_origin IS NULL;

ALTER TABLE predictions ALTER COLUMN forecast_origin SET NOT NULL;

-- Une prévision porte sur l'avenir du modèle, jamais sur son passé.
ALTER TABLE predictions
  ADD CONSTRAINT predictions_origin_before_period
  CHECK (forecast_origin < period_start);

COMMENT ON COLUMN predictions.forecast_origin IS
  'Instant jusqu''auquel le modèle avait vu les données, en UTC. '
  'Départage deux prévisions portant sur le même créneau : la plus récente l''emporte.';

-- ── L'horizon, déduit et non saisi ─────────────────────────────────────────
-- Le ticket demande la colonne ; la calculer plutôt que la recevoir lui
-- interdit de contredire `forecast_origin` et `period_start`. Le service ML
-- n'a rien de plus à envoyer, et personne ne peut enregistrer un horizon de 3
-- sur un créneau situé sept heures plus loin.
ALTER TABLE predictions
  ADD COLUMN horizon smallint GENERATED ALWAYS AS (
    (EXTRACT(EPOCH FROM (period_start - forecast_origin)) / 3600)::smallint
  ) STORED;

ALTER TABLE predictions
  ADD CONSTRAINT predictions_horizon_range CHECK (horizon BETWEEN 1 AND 24);

COMMENT ON COLUMN predictions.horizon IS
  'Nombre d''heures entre l''origine et le début du créneau prédit, de 1 à 24. '
  'Calculée à partir des deux autres colonnes, jamais saisie.';

-- ── Unicité ────────────────────────────────────────────────────────────────
-- Une origine, un horizon, un modèle : une seule ligne. Réécrire la même
-- prévision met la ligne à jour au lieu d'en créer une seconde.
-- NULLS NOT DISTINCT : `model_name` et `model_version` sont facultatifs, et
-- deux lignes sans modèle doivent se télescoper plutôt que s'empiler.
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_site_period_model_unique;
ALTER TABLE predictions
  ADD CONSTRAINT predictions_site_origin_model_unique
  UNIQUE NULLS NOT DISTINCT (site_id, forecast_origin, horizon, model_name, model_version);

-- ── Index de lecture ───────────────────────────────────────────────────────
-- Dessert la requête du service : un site, un créneau, l'origine la plus
-- récente d'abord. L'ancien index (site_id, period_start) en est le préfixe :
-- le garder ferait payer deux fois chaque écriture pour rien.
CREATE INDEX predictions_read_idx
  ON predictions (site_id, period_start, forecast_origin DESC);
DROP INDEX IF EXISTS predictions_site_period_idx;

-- ── La fonction d'écriture ─────────────────────────────────────────────────
-- La signature change : l'ancienne version ne connaît pas `forecast_origin`,
-- donc le service ML ne pourrait pas le renseigner. Elle est supprimée plutôt
-- que surchargée, pour qu'aucun appelant ne puisse écrire sans origine.
DROP FUNCTION IF EXISTS upsert_prediction(text, numeric, timestamptz, timestamptz, text, text);

CREATE OR REPLACE FUNCTION upsert_prediction(
  p_site_id text,
  p_predicted_kw numeric,
  p_forecast_origin timestamptz,
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
    forecast_origin,
    period_start,
    period_end,
    model_name,
    model_version
  )
  VALUES (
    p_site_id,
    p_predicted_kw,
    p_forecast_origin,
    p_period_start,
    p_period_end,
    p_model_name,
    p_model_version
  )
  -- `period_start` et le modèle font partie de l'identité de la ligne : seules
  -- la valeur prévue et la fin du créneau peuvent changer d'une écriture à
  -- l'autre.
  ON CONFLICT ON CONSTRAINT predictions_site_origin_model_unique DO UPDATE SET
    predicted_kw = EXCLUDED.predicted_kw,
    period_end = EXCLUDED.period_end
  RETURNING id;
$$;

COMMENT ON TABLE predictions IS
  'Prévisions du bloc ML, rattachées à un site. Une ligne par origine, horizon '
  'et modèle : pour un même créneau, plusieurs prévisions coexistent et la '
  'lecture sert celle dont l''origine est la plus récente.';

-- ── Droits ─────────────────────────────────────────────────────────────────
-- Aucun ici, volontairement. `db/init/01_schema.sh` applique les migrations
-- AVANT que `02_roles.sh` ne crée `enervision_app` et `enervision_ml` : un
-- GRANT à cet endroit échouerait sur une base neuve, et l'initialisation
-- s'arrêterait là. Les droits sur `predictions` et sur la nouvelle signature
-- de `upsert_prediction` sont dans `db/init/03_grants.sql`, qui s'exécute en
-- dernier. Sur une base déjà créée, rejouer ce fichier-là met les droits à
-- jour.

COMMIT;

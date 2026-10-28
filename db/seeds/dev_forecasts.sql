-- Jeu de données de développement — PAS une migration.
--
-- À appliquer à la main, jamais depuis db/init ni db/migrations. Le dossier
-- n'étant pas monté dans le conteneur — et il ne doit pas l'être —, le fichier
-- passe par l'entrée standard :
--   docker exec -i enervision-db psql -U enervision -d enervision \
--     -v ON_ERROR_STOP=1 < db/seeds/dev_forecasts.sql
--
-- Produit deux lots de prévisions pour chaque site :
--   • une origine ancienne (il y a 6 h), volontairement moins bonne ;
--   • une origine courante, qui doit l'emporter à la lecture.
-- Les créneaux communs aux deux lots sont ce qui rend la règle visible : si
-- l'écran affiche les valeurs du lot ancien, la requête de lecture est fausse.
--
-- Rejouable : upsert_site et upsert_prediction mettent à jour au lieu
-- d'empiler.

BEGIN;

-- ── Les sites ──────────────────────────────────────────────────────────────
-- Aucun code n'alimente encore `sites` : le seed doit donc les créer, sinon la
-- clé étrangère de `predictions` refuse tout.
--
-- Noms et capacités relevés sur /api/consommations le 27/10/2026. La capacité
-- compte : la courbe ci-dessous en est une proportion, et c'est sur le rapport
-- consommation/capacité que les alertes se déclenchent.
--
-- Le type reste NULL : /stats/summary ne le donne pas, et le déduire du nom
-- serait l'inventer. Il viendra de /api/v1/sites quand un code l'alimentera.
SELECT upsert_site('SITE001', 'Bureau Paris La Défense', NULL, 200);
SELECT upsert_site('SITE002', 'Usine Lyon Vénissieux', NULL, 1000);
SELECT upsert_site('SITE003', 'Data Center Marseille', NULL, 800);
SELECT upsert_site('SITE004', 'Centre Commercial Lille', NULL, 400);
SELECT upsert_site('SITE005', 'Hôpital Toulouse Purpan', NULL, 600);
SELECT upsert_site('SITE006', 'Bureau Bordeaux Centre', NULL, 180);
SELECT upsert_site('SITE007', 'Usine Nantes Rezé', NULL, 950);

-- ── Les prévisions ─────────────────────────────────────────────────────────
-- La courbe suit l'heure du créneau : creux la nuit, bosse en milieu de
-- journée. Rien de savant — il s'agit d'avoir à l'écran quelque chose qui
-- ressemble à une consommation plutôt qu'une droite.
--
-- `generate_series` fournit les 24 horizons ; le CROSS JOIN sur `sites` les
-- applique à chaque site. Passer par upsert_prediction plutôt que par un
-- INSERT direct exerce la fonction au passage : si sa signature change encore,
-- ce fichier le dira.
-- Le facteur par site fait couvrir au parc les quatre situations que l'écran
-- sait distinguer : un site qui dépassera sa capacité, un qui entrera en
-- alerte critique, un en alerte moyenne, et les autres au calme. Sans lui,
-- toutes les courbes culminaient à 75 % et aucun seuil n'était jamais
-- franchi — un jeu d'essai qui n'exerce aucun cas limite ne prouve rien.
WITH origines AS (
  SELECT
    date_trunc('hour', now()) - interval '6 hours' AS ancienne,
    date_trunc('hour', now())                     AS courante
)
SELECT upsert_prediction(
  sites.site_id,
  -- Le lot ancien est décalé de 8 % : l'écart entre les deux lots doit se voir.
  ROUND((
    sites.capacity_kw
    * (0.45 + 0.30 * sin(pi() * (EXTRACT(HOUR FROM origine.depart + make_interval(hours => h)) - 6) / 14))
    * CASE sites.site_id
        WHEN 'SITE003' THEN 1.47  -- culmine vers 110 % : dépassement
        WHEN 'SITE007' THEN 1.27  -- vers 95 %  : alerte critique
        WHEN 'SITE002' THEN 1.17  -- vers 88 %  : sous le seuil, de peu
        ELSE 0.93                 -- vers 70 %  : rien à signaler
      END
    * CASE WHEN origine.rang = 0 THEN 1.08 ELSE 1.0 END
  )::numeric, 3),
  origine.depart,
  origine.depart + make_interval(hours => h),
  origine.depart + make_interval(hours => h + 1),
  'consumption_forecast',
  'dev'
)
FROM sites
CROSS JOIN generate_series(1, 24) AS h
CROSS JOIN (
  SELECT 0 AS rang, ancienne AS depart FROM origines
  UNION ALL
  SELECT 1 AS rang, courante AS depart FROM origines
) AS origine
WHERE sites.capacity_kw IS NOT NULL;

COMMIT;

-- ── Vérification ───────────────────────────────────────────────────────────
-- Deux origines, 24 horizons, 7 sites : 336 lignes.
SELECT count(*) AS lignes, count(DISTINCT forecast_origin) AS origines FROM predictions;

-- Ce que la lecture doit servir pour un site : une ligne par créneau, toujours
-- celle de l'origine la plus récente.
SELECT DISTINCT ON (site_id, period_start)
  period_start,
  predicted_kw,
  forecast_origin,
  horizon
FROM predictions
WHERE site_id = 'SITE001'
  AND period_start >= now()
ORDER BY site_id, period_start, forecast_origin DESC, model_version DESC, created_at DESC
LIMIT 5;

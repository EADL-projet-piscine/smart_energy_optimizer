-- Droits des rôles créés par 02_roles.sh.
-- enervision_app : l'API métier. Lecture et écriture du schéma, sauf les
--   prévisions et le référentiel de recommandations, qu'elle lit seulement.
-- enervision_ml  : les traitements et le service ML (sites, mesure courante, prévisions).
--   Pas d'accès aux utilisateurs, pas de suppression.
-- Le super-utilisateur enervision reste seul habilité à migrer le schéma.

GRANT CONNECT ON DATABASE enervision TO enervision_app, enervision_ml;
GRANT USAGE ON SCHEMA public TO enervision_app, enervision_ml;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM enervision_app, enervision_ml;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM enervision_app, enervision_ml;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM enervision_app, enervision_ml;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO enervision_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO enervision_app;

-- Les prévisions sont écrites par le service ML seul : l'API métier les lit.
-- Ce retrait vient après le GRANT global ci-dessus, qui sinon le défait.
REVOKE INSERT, UPDATE, DELETE ON predictions FROM enervision_app;

-- Le référentiel de recommandations est posé par migration : l'API le lit.
-- L'édition en ligne prévue en V2 passera par un rôle dédié, pas par celui
-- qui sert les requêtes du dashboard.
REVOKE INSERT, UPDATE, DELETE ON recommendations, recommendation_rules
  FROM enervision_app;

GRANT SELECT, INSERT, UPDATE ON sites, current, predictions TO enervision_ml;

GRANT EXECUTE ON FUNCTION
  upsert_site(text, text, text, numeric),
  upsert_current(
    text,
    timestamptz,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    text,
    text[]
  )
TO enervision_app, enervision_ml;

-- Écrire une prévision est le fait du service ML seul, d'où une ligne à part.
GRANT EXECUTE ON FUNCTION
  upsert_prediction(text, numeric, timestamptz, timestamptz, timestamptz, text, text)
TO enervision_ml;

-- Les prochaines tables créées par le super-utilisateur restent accessibles à l'application.
-- Le rôle ML n'est pas inclus : chaque nouvelle table doit recevoir un droit explicite.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO enervision_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO enervision_app;

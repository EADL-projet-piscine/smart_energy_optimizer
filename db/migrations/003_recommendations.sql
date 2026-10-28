-- Référentiel des recommandations affichées avec les alertes de capacité.
--
-- Deux tables et non une : le même conseil sert plusieurs couples (situation,
-- type de site) — « investiguer la cause » apparaît six fois — et une édition
-- en ligne est prévue. Un conseil reformulé doit l'être à un seul endroit.
--
-- Les droits ne sont PAS posés ici : une migration tourne avant la création
-- des rôles sur une base neuve, et le GRANT échouerait. Voir db/init/03_grants.sql.

BEGIN;

-- Le vocabulaire : un conseil, son texte, son explication facultative.
CREATE TABLE IF NOT EXISTS recommendations (
    id          bigserial PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    action      text NOT NULL,
    detail      text,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE recommendations IS
    'Conseils proposés avec une alerte. Un conseil retiré est désactivé, pas supprimé.';
COMMENT ON COLUMN recommendations.code IS
    'Identifiant stable, référencé par recommendation_rules et lisible en SQL.';

-- La correspondance : quel conseil pour quelle situation, sur quel type de
-- site, et dans quel ordre.
CREATE TABLE IF NOT EXISTS recommendation_rules (
    situation          text NOT NULL,
    site_type          text NOT NULL,
    recommendation_id  bigint NOT NULL REFERENCES recommendations (id) ON DELETE RESTRICT,
    priority           smallint NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    -- Aucun rang occupé deux fois dans une même liste.
    PRIMARY KEY (situation, site_type, priority),

    -- Un même conseil ne peut pas apparaître deux fois dans la même liste.
    -- La clé primaire ne l'interdit pas : deux rangs différents suffiraient.
    CONSTRAINT recommendation_rules_once_per_list
        UNIQUE (situation, site_type, recommendation_id),

    CONSTRAINT recommendation_rules_priority_positive
        CHECK (priority > 0),

    -- Les valeurs admises vivent en base, pas dans la tête de celui qui écrit
    -- l'INSERT. Ajouter une situation demandera une migration : c'est voulu,
    -- elles correspondent à du code côté back, pas à du contenu libre.
    CONSTRAINT recommendation_rules_situation
        CHECK (situation IN ('capacite_moyenne', 'capacite_critique')),

    -- Types servis par l'API source, plus « unknown » en repli.
    CONSTRAINT recommendation_rules_site_type
        CHECK (site_type IN ('office', 'factory', 'datacenter', 'retail', 'hospital', 'unknown'))
);

COMMENT ON TABLE recommendation_rules IS
    'Quels conseils s''appliquent à quelle situation, pour quel type de site.';

-- updated_at tenu par la base : une colonne que l'application doit penser à
-- mettre à jour finit par mentir. Inutile tant que seule la migration écrit,
-- indispensable dès la première modification en ligne.
--
-- set_updated_at() vient de 001_initial_schema.sql, comme pour users, sites,
-- current et predictions.

DROP TRIGGER IF EXISTS recommendations_set_updated_at ON recommendations;
CREATE TRIGGER recommendations_set_updated_at
BEFORE UPDATE ON recommendations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS recommendation_rules_set_updated_at ON recommendation_rules;
CREATE TRIGGER recommendation_rules_set_updated_at
BEFORE UPDATE ON recommendation_rules
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


-- Contenu initial.
--
-- Il fait partie du produit : il doit exister en production, il n'a donc pas
-- sa place dans db/seeds/, qui ne s'exécute jamais tout seul.
--
-- Aucun conseil ne reprend la mesure ni le pourcentage : le bandeau d'alerte
-- les porte déjà.

INSERT INTO recommendations (code, action, detail) VALUES
    ('reporter_operations',
     'Reporter les opérations non urgentes',
     'Recharges, lavages, tout ce qui peut attendre les heures creuses'),
    ('verifier_equipements',
     'Vérifier les équipements restés en marche',
     'Un équipement oublié explique souvent la montée'),
    ('decaler_production',
     'Décaler un cycle de production vers les heures creuses',
     'Si le planning de production le permet'),
    ('surveiller_evolution',
     'Surveiller l''évolution sur l''heure qui vient',
     NULL),
    ('verifier_non_critiques',
     'Vérifier les équipements non critiques',
     'Hors soins et locaux techniques'),
    ('verifier_charge_baies',
     'Vérifier la charge répartie entre les baies',
     NULL),
    ('delester_non_essentiels',
     'Délester les usages non essentiels',
     'Éclairage de zones inoccupées, climatisation hors locaux techniques'),
    ('mode_economie',
     'Passer le site en mode économie d''énergie',
     NULL),
    ('interrompre_production',
     'Décaler ou interrompre un cycle de production',
     NULL),
    ('verifier_groupes',
     'Vérifier la disponibilité des groupes électrogènes',
     NULL),
    ('verifier_redondance',
     'Vérifier la redondance d''alimentation et l''état des onduleurs',
     NULL),
    ('alerter_astreinte',
     'Alerter l''astreinte technique',
     NULL),
    ('investiguer_hausse',
     'Investiguer la cause de cette hausse anormale',
     'Un dépassement prolongé de la capacité expose l''installation'),
    ('prevenir_exploitant',
     'Prévenir l''exploitant du site',
     NULL)
ON CONFLICT (code) DO NOTHING;

-- Les règles référencent les conseils par leur code : la jointure retrouve
-- l'identifiant, qui n'est jamais écrit en dur.
--
-- hospital et datacenter ne se voient proposer aucune réduction de
-- consommation. C'est délibéré : la continuité d'alimentation prime, et
-- conseiller un délestage y serait une faute.

INSERT INTO recommendation_rules (situation, site_type, recommendation_id, priority)
SELECT regle.situation, regle.site_type, r.id, regle.priority
FROM (VALUES
    ('capacite_moyenne',  'office',     'reporter_operations',     1::smallint),
    ('capacite_moyenne',  'office',     'verifier_equipements',    2),
    ('capacite_moyenne',  'retail',     'reporter_operations',     1),
    ('capacite_moyenne',  'retail',     'verifier_equipements',    2),
    ('capacite_moyenne',  'factory',    'decaler_production',      1),
    ('capacite_moyenne',  'factory',    'verifier_equipements',    2),
    ('capacite_moyenne',  'hospital',   'surveiller_evolution',    1),
    ('capacite_moyenne',  'hospital',   'verifier_non_critiques',  2),
    ('capacite_moyenne',  'datacenter', 'surveiller_evolution',    1),
    ('capacite_moyenne',  'datacenter', 'verifier_charge_baies',   2),
    ('capacite_moyenne',  'unknown',    'surveiller_evolution',    1),
    ('capacite_moyenne',  'unknown',    'verifier_equipements',    2),

    ('capacite_critique', 'office',     'delester_non_essentiels', 1),
    ('capacite_critique', 'office',     'mode_economie',           2),
    ('capacite_critique', 'office',     'investiguer_hausse',      3),
    ('capacite_critique', 'retail',     'delester_non_essentiels', 1),
    ('capacite_critique', 'retail',     'mode_economie',           2),
    ('capacite_critique', 'retail',     'investiguer_hausse',      3),
    ('capacite_critique', 'factory',    'interrompre_production',  1),
    ('capacite_critique', 'factory',    'delester_non_essentiels', 2),
    ('capacite_critique', 'factory',    'investiguer_hausse',      3),
    ('capacite_critique', 'hospital',   'verifier_groupes',        1),
    ('capacite_critique', 'hospital',   'alerter_astreinte',       2),
    ('capacite_critique', 'hospital',   'investiguer_hausse',      3),
    ('capacite_critique', 'datacenter', 'verifier_redondance',     1),
    ('capacite_critique', 'datacenter', 'alerter_astreinte',       2),
    ('capacite_critique', 'datacenter', 'investiguer_hausse',      3),
    ('capacite_critique', 'unknown',    'investiguer_hausse',      1),
    ('capacite_critique', 'unknown',    'prevenir_exploitant',     2)
) AS regle (situation, site_type, code, priority)
JOIN recommendations r ON r.code = regle.code
ON CONFLICT DO NOTHING;

COMMIT;

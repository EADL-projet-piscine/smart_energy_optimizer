# Conventions du back-end

Ce document décrit comment est organisé `app/back`. Il est à lire avant
d'écrire du code dans ce dossier.

## Principe

Le back-end est un **monolithe modulaire** : un seul programme déployé d'un
bloc, mais découpé en modules isolés. Chaque module correspond à un domaine
métier, pas à une couche technique.

Concrètement : on ne range pas tous les endpoints ensemble puis toutes les
requêtes SQL ensemble. On range ensemble tout ce qui concerne les sites,
puis tout ce qui concerne les prévisions, et ainsi de suite.

La raison : une évolution porte presque toujours sur un domaine. Si tout ce
qui concerne les prévisions est au même endroit, une seule personne peut y
travailler sans toucher au reste.

## Structure d'un module

Chaque module vit dans `src/smart_energy_app/<domaine>/` et contient :

| Fichier | Rôle |
|---|---|
| `__init__.py` | Déclare ce que le module expose aux autres |
| `routes.py` | Les endpoints HTTP. Reçoit, appelle le service, répond. |
| `service.py` | Les règles métier. C'est ici que se prennent les décisions. |
| `repository.py` | Le seul endroit qui parle à la base de données. |
| `client.py` | Les appels à une API extérieure, s'il y en a. |
| `planificateur.py` | La tâche périodique du module, s'il en a une. |
| `models.py` | Les tables SQLAlchemy. |
| `schemas.py` | Les formats d'entrée et de sortie de l'API (Pydantic). |

Tous ne sont pas obligatoires. Un module qui ne lit rien en base n'a pas de
`repository.py` ni de `models.py`.

Un domaine peut porter **plusieurs services** quand il couvre des usages
distincts. `consommation` a ainsi `service.py` pour la mesure courante et
`historique.py` pour les dernières 24 heures : deux sources, deux cadences,
deux modes de défaillance. Les fusionner dans un seul fichier rendrait les
deux plus difficiles à lire et à tester. Dans ce cas, le fichier porte le
nom de l'usage, pas un suffixe technique.

`alertes` suit la même règle : sa seule règle aujourd'hui vit dans
`capacite.py`, et une règle future sur la perte de transmission vivra dans
son propre fichier plutôt que de grossir celui-là. Un module peut donc
n'avoir ni `routes.py` ni `service.py` : il expose son état, et c'est un
autre module qui le sert.

À l'inverse, `previsions` n'a **pas de `service.py`** : sa seule règle — quelle
prévision servir quand plusieurs couvrent le même créneau — est une clause
`ORDER BY`, et la séparer de la requête qu'elle gouverne obligerait à lire
deux fichiers pour comprendre un tri. Le jour où une décision s'ajoutera
sans toucher au SQL, elle aura son service.

### Pourquoi séparer `models.py` et `schemas.py`

`models.py` décrit la base de données. `schemas.py` décrit le contrat de
l'API. Ce sont deux choses différentes : une table peut contenir des
colonnes techniques que l'API n'expose pas, et l'API peut renvoyer des
champs calculés qui n'existent dans aucune table.

Les mélanger revient à exposer la structure interne de la base à
l'extérieur, et à ne plus pouvoir changer l'une sans casser l'autre.

## La règle d'isolation

Un module n'accède à un autre module **que par son `__init__.py`**.

```python
# Autorisé
from smart_energy_app.sites import get_site

# Interdit
from smart_energy_app.sites.repository import select_site
from smart_energy_app.sites.models import Site
```

Si vous avez besoin de quelque chose qu'un module n'expose pas, la réponse
n'est pas de contourner son interface : c'est d'étendre cette interface,
en concertation avec la personne qui porte ce module.

Exemple d'interface :

```python
# sites/__init__.py
from .service import get_site, list_sites

__all__ = ["get_site", "list_sites"]
```

Un module qui n'expose qu'un objet d'état suit la même règle :

```python
# alertes/__init__.py
from .capacite import capacity_alerts

__all__ = ["capacity_alerts"]
```

> Cette règle se contourne sans effort et sans erreur visible : un import
> direct fonctionne parfaitement. Rien ne l'attrape, ni ruff, ni les tests.
> Seule la relecture la voit — d'où l'intérêt de la vérifier avant d'ouvrir
> une pull request : `grep -rn "from smart_energy_app\.[a-z]*\." src/` ne
> doit remonter que des imports de `commun` et du module courant.

> **Deux violations connues, non corrigées.** `consommation/routes.py` et
> `consommation/planificateur.py` importent
> `from smart_energy_app.alertes.capacite import capacity_alerts` au lieu de
> passer par `alertes/__init__.py`, qui l'expose pourtant. Elles n'ont rien
> cassé — c'est justement le problème de cette règle. Un ticket est ouvert.

## Ce qui vit hors des modules

| Fichier | Rôle |
|---|---|
| `main.py` | Assemble l'application et monte les routeurs. Pas de logique. |
| `config.py` | Tous les paramètres, lus depuis l'environnement. |
| `db.py` | Moteur SQLAlchemy et sessions. |
| `commun/` | Ce qui sert à plusieurs modules : adresses de l'API source (`enervision.py`), erreurs, pagination, conversion de fuseaux. |

Le schéma PostgreSQL est versionné dans `db/migrations` et décrit dans
`db/README.md` (tables, relations, rôles). `db.py` ne fait qu'ouvrir la
connexion : il ne crée pas les tables.

`commun/` est à utiliser avec parcimonie. Dès qu'on y met de la logique
métier, il devient un fourre-tout dont tout le monde dépend.

`commun/enervision.py` porte les chemins de l'API EnerVision sous forme de
constantes. Aucun module ne réécrit une URL de la source à la main : il
importe la constante correspondante.

## Ajouter un module

```bash
cd app/back/src/smart_energy_app
mkdir <domaine>
touch <domaine>/{__init__.py,routes.py,service.py,schemas.py}
```

Puis monter le routeur dans `main.py` :

```python
from smart_energy_app.<domaine>.routes import router as <domaine>_router

app.include_router(<domaine>_router, prefix="/api/<domaines>", tags=["<Domaines>"])
```

Le préfixe est au **pluriel** : c'est lui qui porte la collection (voir
« Nommage des endpoints » plus bas). Le dossier du module reste au
singulier, comme tous les dossiers du projet.

Un module se crée **quand son ticket est pris**, pas à l'avance. Des
dossiers vides créés par anticipation envoient les autres sur de fausses
pistes.

## Modules

| Module | Rôle | Source |
|---|---|---|
| `sites` | Référentiel des sites : nom, type, capacité, rattachement client | — |
| `consommation` | Mesure courante et historique de consommation | API EnerVision |
| `previsions` | Prévisions produites par le service ML | PostgreSQL |
| `alertes` | Alertes levées, leur sévérité et leur état | calculées |
| `commun` | Adresses de l'API source, erreurs, pagination, conversion de fuseaux | — |

`consommation` regroupe la mesure instantanée et l'historique : c'est la
même grandeur, seule la source diffère — l'API EnerVision pour l'instant
présent (`client.py`), la base pour le passé (`repository.py`, à venir ;
aujourd'hui l'historique passe encore par l'API source).

`previsions` est le **premier module servi par PostgreSQL** et non par l'API
EnerVision. Le service ML écrit dans la table `predictions`, l'API métier y
lit. C'est aussi pour cela qu'il porte un `repository.py` quand les autres
n'en ont pas encore.

Les alertes gardent leur module : elles sont signalées depuis plusieurs
domaines (un dépassement prévu, une coupure constatée, un capteur
défaillant) et ont leur propre cycle de vie — levée, consultée, acquittée.

La collecte et l'ingestion ne figurent pas dans cette liste : elles sont
portées par Azure Data Factory, hors du back-end.

## Endpoints exposés

| Endpoint | Module | Source |
|---|---|---|
| `GET /health` | — | état du service et de la base |
| `GET /api/consommations` | `consommation` | `/api/v1/stats/summary` |
| `GET /api/consommations/historique` | `consommation` | `/api/v1/readings` |
| `GET /api/consommations/sites` | `consommation` | `/api/v1/sites/{id}/current` × 7 |
| `GET /api/consommations/sites/{site_id}` | `consommation` | `/api/v1/sites/{id}/current` |
| `GET /api/previsions` | `previsions` | table `predictions` |
| `GET /api/previsions/{site_id}` | `previsions` | table `predictions` |

`/api/consommations` renvoie, à côté de la mesure :

| Champ | Rôle |
|---|---|
| `fetched_at` | Heure de la mesure |
| `next_at` | Heure de la prochaine mesure, pour que le client s'y cale |
| `stale` | Vrai si la mesure dépasse `CONSUMPTION_STALENESS_S` |
| `last_readings` | Dernière consommation réellement mesurée de chaque site, avec son heure |
| `alertes` | Alertes de capacité en cours, calculées depuis la charge constatée |

`next_at` évite au front de sonder à l'aveugle : il planifie son appel juste
après l'heure annoncée, et reçoit chaque mesure quelques secondes après
qu'elle existe, pour un seul appel par cycle.

`last_readings` et `alertes` vivent **à côté** de `data`, jamais dedans :
`data` est le résumé de la source, relayé tel quel, et y glisser nos propres
calculs les rendrait indiscernables de ce que la source a envoyé.

## Les prévisions

Le service ML écrit dans `predictions` ; `previsions/repository.py` y lit.
Rien n'est mis en mémoire : la requête est directe, à chaque appel.

### Quelle prévision servir

Pour un site et un créneau donnés, **plusieurs prévisions coexistent** : le
modèle tourne plusieurs fois par jour, et chaque passage produit sa version
des heures à venir. On sert celle dont `forecast_origin` — l'instant jusqu'
auquel le modèle avait vu les données — est le plus récent. Une prévision
faite à 16 h pour 18 h a vu la consommation de 16 h ; celle faite à 10 h non.

Départage complet : `forecast_origin`, puis `model_version`, puis
`created_at`.

**`created_at` seul ne convient pas.** C'est la date d'insertion : un
rattrapage insère aujourd'hui des prévisions calculées hier, qui
remonteraient en tête alors qu'elles ont vu moins de données. Elle ne sert
qu'à départager deux lignes que tout le reste égalise.

L'ancienne prévision n'est pas effacée par la nouvelle. Les deux restent en
base : c'est ce qui permettra un jour de comparer ce que le modèle annonçait
à ce qui s'est produit.

### Ce que la table garantit

| Contrainte | Effet |
|---|---|
| unicité `(site_id, forecast_origin, horizon, model_name, model_version)` | réécrire la même prévision met la ligne à jour, n'en crée pas une seconde |
| `horizon` **colonne générée** depuis `period_start - forecast_origin` | l'horizon ne peut pas contredire les deux colonnes dont il découle |
| `CHECK (horizon BETWEEN 1 AND 24)` | une prévision à 25 h est refusée par la base |
| `CHECK (forecast_origin < period_start)` | une prévision ne porte jamais sur son propre instant |
| `CHECK (predicted_kw >= 0)` | pas de consommation négative |

Le service ML n'envoie donc **pas** l'horizon : il est calculé. Écrire
`upsert_prediction` sans `forecast_origin` est impossible, l'ancienne
signature ayant été supprimée plutôt que surchargée.

### Droits

`enervision_ml` écrit, `enervision_app` lit seulement. Les `GRANT` vivent
dans `db/init/03_grants.sql` et **jamais dans une migration** :
`db/init/01_schema.sh` applique les migrations avant que `02_roles.sh` ne
crée les rôles, donc un `GRANT` dans une migration échoue sur une base neuve
et interrompt toute l'initialisation.

### Réponse

Une absence de prévision n'est pas une panne : le modèle n'a peut-être pas
encore tourné. `/api/previsions` renvoie alors `sites: {}` avec un 200, et
`/api/previsions/{site_id}` une liste vide — pas un 404, qui affirmerait à
tort que le site n'existe pas. Seule une base injoignable donne 503.

Chaque point porte `forecast_origin`, `model_name` et `model_version`. Le
front n'en affiche rien, mais une prévision dont on ne peut pas dire d'où
elle sort n'est pas vérifiable.

`FORECAST_HOURS` (défaut 24) borne la profondeur servie. La contrainte en
base plafonne l'horizon à 24 : demander davantage ne rendrait rien de plus.

## La mémoire des dernières mesures

La source renvoie `null` dès qu'un site cesse de transmettre, et le cycle
suivant écrase la valeur précédente. Sans mémoire, l'écran n'a plus aucun
chiffre à montrer alors que l'historique prouve que le site consommait deux
heures plus tôt.

`consommation/last_readings.py` retient donc la dernière consommation **non
nulle** de chaque site. Toute la règle tient en une phrase : *une valeur
absente n'est pas une valeur nulle, et n'a donc aucune raison d'écraser ce
qu'on savait déjà.*

Ce n'est pas un cache. Un cache expire et se reconstruit depuis sa source ;
ici la valeur est conservée précisément parce que la source ne sait plus la
donner. Deux limites à connaître :

- la mémoire **part vide à chaque redémarrage** : un site déjà muet au
  démarrage n'y figure pas tant qu'il n'a pas transmis une fois ;
- elle **ne survit pas au conteneur**. C'est à cela que servira la base, le
  jour où ce sera un ticket.

## Les alertes de capacité

`alertes/capacite.py` évalue à chaque cycle, depuis le résumé déjà en
mémoire, sans appel réseau supplémentaire. Trois seuils, tous en
configuration :

| Seuil | Défaut | Effet |
|---|---|---|
| `ALERT_CRITICAL_PCT` | 100 | lève une alerte critique |
| `ALERT_MEDIUM_PCT` | 90 | lève une alerte moyenne |
| `ALERT_CLEAR_PCT` | 85 | éteint l'alerte |

**Le seuil d'extinction est volontairement plus bas que celui de levée.**
Avec un seuil unique, un site qui oscille autour de 90 % verrait son alerte
clignoter à chaque minute. Entre 85 et 90, rien ne change : une alerte déjà
levée le reste, une situation calme le reste aussi.

Deux règles qui se discutent et qu'il faut pouvoir défendre :

**Une charge inconnue ne lève rien et n'éteint rien.** Perdre la mesure ne
prouve pas que la surcharge a cessé. Éteindre l'alerte reviendrait à
affirmer que tout va bien alors qu'on ne sait plus. Conséquence visible : un
site muet garde son alerte, avec la dernière charge connue.

**Un changement de gravité est un nouvel événement.** L'alerte garde son
horodatage de levée tant qu'elle ne change pas de sévérité ; elle en prend
un nouveau quand elle passe de moyenne à critique ou l'inverse. En revanche
`load_percent` suit la charge courante — c'est ce qui dit si la situation
empire. Les deux ne décrivent donc pas le même instant, et un client qui les
présenterait comme un seul fait mentirait.

> **Ces seuils ne sont pas exposés par l'API**, et le front les a recopiés
> pour colorer la pointe prévue. Les changer ici sans changer `format.ts`
> ferait mentir l'écran sans qu'aucun test ne le voie. Un ticket est ouvert
> pour les faire remonter dans la réponse de `/api/consommations`.

### Nommage des endpoints

**Les collections sont au pluriel, les vues calculées sur une collection au
singulier.**

| Chemin | Ce que c'est |
|---|---|
| `/api/consommations` | la collection : consommation courante de tous les sites |
| `/api/consommations/historique` | une vue sur cette collection : les 24 dernières heures |

Il n'y a qu'un seul historique, comme il n'y a qu'un seul résumé : mettre
ces vues au pluriel par réflexe produit des chemins qui ne désignent rien.

**Le pluriel est porté une seule fois, par le préfixe du routeur.** Dans
`main.py` le préfixe vaut `/api/consommations` ; dans `routes.py` les
chemins sont relatifs à lui. Répéter le mot des deux côtés donne
`/api/consommation/consommations`.

**Le chemin de la collection est `""`, pas `"/"`.** Avec un préfixe, `"/"`
produit une URL à barre finale et une redirection 307 que le client suit —
donc deux appels au lieu d'un.

```python
# routes.py
@router.get("", summary="Consommation courante de tous les sites")
@router.get("/historique", summary="Consommation des dernières 24 heures")
```

> Renommer un endpoint touche plus de fichiers qu'il n'y paraît : le front,
> les tests des deux côtés, le script de charge, le README et ce document.
> Le vérifier d'un `grep -rn "/api/"` avant de pousser, et regarder `/docs`
> après : Swagger affiche les URL complètes, préfixe compris.

## Règles de réponse

**Pas de valeur de repli inventée.** Quand l'API source ne répond pas,
l'endpoint renvoie une erreur franche : 502 si la source a répondu mais a
refusé, 503 si elle est injoignable. Des chiffres plausibles servis en cas
de panne sont pires qu'une erreur, parce que rien ne les distingue des
vrais.

**Une mesure absente reste `null`.** Jamais zéro : zéro est une mesure,
l'absence de mesure n'en est pas une.

**Une collection vide n'est pas une erreur.** Un parc sans prévision renvoie
200 et une collection vide : le modèle n'a pas encore tourné, le service va
bien. Réserver les codes d'erreur à ce qui est réellement en panne.

**Les horodatages de la source sont relayés tels quels**, sans reformatage.
Les retoucher au passage fait perdre la trace de ce que la source a
réellement envoyé.

## Pièges de l'API source

Ces comportements ont été établis par la mesure, pas par la documentation.
Le script `ml/scripts/probe_readings.py` les reproduit.

**`limit` ne plafonne pas, il fixe le pas.** Sur `/api/v1/readings`, ce
paramètre découpe la plage demandée et divise le quota entre les sites.
Mesuré sur 24 heures et 7 sites :

| `limit` | points/site | pas |
|---|---|---|
| 100 (défaut) | 14 | 103 min |
| **168** | **24** | **60 min** |
| 500 | 71 | 20 min |
| 1000 | 142 | 10 min |

D'où `limit = heures × sites`, calculé et jamais écrit en dur. Avec la
valeur par défaut, on recevrait un point toutes les 1 h 43 sans qu'aucune
erreur ne le signale.

Conséquence : le pas horaire sur 7 jours exigerait 1 176 points, au-dessus
du plafond de 1 000. Une fenêtre plus longue que 5 jours impose soit un pas
plus grossier, soit un appel par site.

> 24 points espacés d'une heure couvrent **23 heures** d'amplitude, pas 24 :
> ils délimitent 23 intervalles. La courbe couvre bien ses 24 heures parce
> que le front y ajoute la mesure courante.

**Les bornes doivent être en UTC sans fuseau.** La source raisonne en UTC et
refuse toute borne dans le futur :

```
400 — Impossible de générer ou d'accéder à des données dans le futur.
```

Envoyer `datetime.now()` depuis une machine à l'heure de Paris produit cette
erreur, puisque la source voit une demande deux heures en avance. Utiliser
`datetime.now(UTC).replace(tzinfo=None)` et retrancher une marge pour
l'écart d'horloge.

**Deux conventions de fuseau dans la même API.** `/readings` date ses points
avec un `Z`, `/stats/summary` sans rien — alors qu'il s'agit d'UTC dans les
deux cas. Un client qui lit l'horodatage nu comme de l'heure locale affiche
deux heures de moins, sans erreur.

**`consumption_kw` et `consumption_kwh` sont toujours égaux.**
Simplification du simulateur, confirmée par le formateur. Une énergie ne
peut donc pas être lue directement : elle doit être intégrée à partir des
puissances.

**Les alertes de `/alerts` sont décorrélées des mesures.** Elles sont
générées indépendamment de la consommation réelle, et régénérées à chaque
appel. Les afficher à côté de nos propres courbes produirait des
contradictions visibles. Nos badges et seuils sont dérivés des mesures, pas
de cet endpoint.

**Aucun seuil contractuel n'existe dans cette API.** Ni dans `/sites`, ni
dans `/stats/summary`, ni ailleurs. Ce qui existe est `capacity_kw`, la
capacité technique de l'installation, présente dans les deux. Le `threshold`
que porte une alerte de `/alerts` est le seuil de détection interne du
simulateur — 135 kW pour un site de 200 kW de capacité — et non un
engagement commercial : l'afficher sous le nom « seuil contractuel » ferait
passer l'un pour l'autre.

**`/sensors/status` donne l'inventaire complet des capteurs.** Cinq par
site : `consumption`, `electrical`, `temperature`, `humidity`, `network`.
Ce sont exactement les cinq codes que `null_reasons` peut contenir
(`consumption_sensor_failure`, `electrical_sensor_failure`,
`temperature_sensor_failure`, `humidity_sensor_failure`, `network_loss`) —
c'est la seule source qui permette d'affirmer que la liste est complète.

L'endpoint porte aussi `failing_until`, l'heure de rétablissement prévue.
Peu exploitable en l'état : les pannes du simulateur durent quelques
secondes, là où notre boucle tourne à la minute. L'information serait
périmée avant d'être affichée.

**`/readings` n'est pas reproductible.** Deux appels identiques renvoient
des valeurs différentes : la source régénère son historique à chaque fois.
Toute ingestion vers la base doit donc être idempotente — contrainte
d'unicité site + horodatage, et `ON CONFLICT DO NOTHING`.

## Nommage

**Les identifiants sont en anglais** : variables, fonctions, classes,
paramètres. `get_site`, `refresh`, `CurrentState`, `is_stale`.

**Les dossiers restent en français**, parce qu'ils portent le vocabulaire
métier du projet : `consommation`, `previsions`, `alertes`. Les imports
sont donc mixtes, et c'est assumé :

```python
from smart_energy_app.consommation.client import fetch_summary
```

**Les docstrings, commentaires et documentation sont en français.** Ce qui
compte est que l'équipe comprenne vite.

**Les noms de colonnes en base** suivent ceux de l'API source quand ils en
proviennent (`consumption_kw`, `data_quality`), pour qu'une valeur se trace
de bout en bout sans table de correspondance.

> `db.py` est encore en français (`creer_moteur`), reste d'avant cette
> convention. Un ticket est ouvert pour l'aligner. Ne pas s'en inspirer.
> Les tests, eux, sont passés en anglais : seules restent en français les
> chaînes attendues qui viennent de l'application — textes d'interface et
> messages de journal. Les traduire ferait échouer les tests sans rien
> changer au code, et un commentaire le signale sur place.

## Cycle de vie de l'application

`main.py` lance la boucle de rafraîchissement dans le `lifespan` et
l'arrête à la fermeture :

```python
task = asyncio.create_task(refresh_loop())
try:
    yield
finally:
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
```

Annuler ne suffit pas : sans attendre la tâche, asyncio signale au mieux
« Task was destroyed but it is pending » à l'arrêt, au pire interrompt un
appel HTTP en cours.

Les prévisions ne passent pas par cette boucle : elles sont lues en base à
la demande, sans état en mémoire à rafraîchir.

## Tests

Les tests suivent la même organisation que le code, un fichier par fichier :

```
tests/
├── conftest.py            Fixtures partagées, dont `schema`
├── schema_tools.py        Application des migrations depuis les tests
├── test_config.py
├── test_health.py
├── test_schema.py
├── alertes/
│   └── test_capacite.py
├── consommation/
│   ├── test_client.py
│   ├── test_details.py
│   ├── test_historique.py
│   ├── test_last_readings.py
│   ├── test_routes.py
│   └── test_service.py
└── previsions/
    └── test_previsions.py
```

Les dossiers de `tests/` n'ont **pas** de `__init__.py` : pytest les trouve
sans. En ajouter un à un seul dossier crée une asymétrie que rien ne
justifie. Contrepartie : deux fichiers de test ne peuvent pas porter le même
nom dans deux dossiers différents.

Un test ne doit pas dépendre du lancement de Docker ni d'un appel réseau
réel. Si une fonction a besoin de la base, le test remplace le repository ;
si elle appelle une API extérieure, le test lance un serveur local qui
imite les réponses attendues (voir la fixture `fake_api`).

### La fixture `schema`

En CI, la base démarre **vide** : aucun script d'initialisation n'y tourne.
C'est donc le premier fichier de test qui s'exécute qui doit savoir
construire le schéma — d'où `schema_tools.py` et la fixture `schema`,
déclarée dans `conftest.py` et partagée par tous les fichiers.

Ce partage n'est pas une élégance : pytest parcourt les dossiers par ordre
alphabétique, donc `tests/previsions/` passe **avant** `tests/test_schema.py`.
Tant que la construction du schéma vivait dans ce dernier, les tests de
prévisions tournaient sur une base vide et échouaient en CI alors qu'ils
passaient en local, où la base avait déjà tout.

Deux pièges que `schema_tools.py` traite :

- il applique **toutes** les migrations du dossier, triées par nom, comme le
  fait `db/init/01_schema.sh` sur une base neuve. S'arrêter à la première laisserait un schéma
  incomplet, avec toutes ses tables ;
- il filtre les `BEGIN`/`COMMIT` des fichiers de migration. Rejoué depuis
  SQLAlchemy, qui a déjà ouvert une transaction, ce `COMMIT` validerait celle
  du test et ferait sauter le rollback — les tests se contamineraient entre
  eux, de façon intermittente.

Un test qui doit **commiter** pour que la route voie ses lignes — la route
ouvre sa propre connexion — ne peut pas compter sur un rollback. Il nettoie
alors par une suppression explicite, comme la fixture `seeded` de
`test_previsions.py`.

Les tests marqués `db` sont ignorés quand aucune base n'est joignable. **En
CI, `REQUIRE_DB=1` doit être positionné** : un test `db` doit alors échouer
plutôt qu'être ignoré, sinon une base absente rendrait la CI verte à tort.

### Ce qu'un test gagne à vérifier

Un test gagne à garder un piège plutôt qu'à vérifier une évidence. Les plus
utiles de cette suite vérifient que les bornes envoyées à la source sont en
UTC et dans le passé, que `limit` vaut bien `heures × sites`, que `next_at`
reflète la cadence configurée, qu'une valeur absente n'efface pas la
dernière mesure connue, qu'une charge inconnue n'éteint pas une alerte, et
que la lecture des prévisions sert bien l'origine la plus récente — six
erreurs qui ont réellement coûté du temps, ou qui auraient pu.

Un piège qui mérite son test : **`bool` est une sous-classe de `int` en
Python.** Sans garde-fou explicite, un `true` reçu de la source passerait
pour une consommation de 1 kW. `commun` n'a pas vocation à porter ce genre
de contrôle : la lecture défensive du résumé vit dans
`consommation/payload.py`, et les modules qui en ont besoin l'importent.

Un autre, propre à PostgreSQL : **un `NULL` non typé empêche la résolution
d'une fonction.** `upsert_site(…, NULL, …)` échoue avec
`function upsert_site(text, text, unknown, numeric) does not exist`, alors
que `NULL::text` passe. Le comportement dépend de la version, d'où un test
qui passait en local et échouait en CI.

### Tester sur une base neuve

Votre base locale porte un historique que le runner n'a pas. Trois échecs de
CI d'affilée venaient de là, invisibles en local. Avant de pousser quoi que
ce soit qui touche au schéma :

```bash
docker compose down -v
docker compose up -d db
sleep 15
cd app/back
DATABASE_URL="postgresql+psycopg://enervision:enervision@localhost:5433/enervision" \
  REQUIRE_DB=1 pytest -q
```

## Avant de pousser

```bash
cd app/back
ruff check .
ruff format --check .
pytest
```

Ce sont exactement les trois commandes que lance la CI. Les passer en local
évite de découvrir l'échec après le push — et de bloquer les autres, la CI
étant commune à toutes les branches.

Les deux premières sont lancées automatiquement à chaque commit si vous avez
installé `pre-commit` :

```bash
cd ~/smart_energy_optimizer
pre-commit install
pre-commit install --hook-type pre-push
```

**À faire une fois par personne.** La CI a déjà échoué plusieurs fois sur du
code poussé sans ces hooks, bloquant les pull requests d'autres membres de
l'équipe.

Les relancer à la main reste utile avant d'ouvrir une pull request : le hook
ne vérifie que les fichiers que vous avez modifiés, alors que la CI passe
sur tout le dépôt — y compris sur le travail des autres, qui peut faire
échouer votre pipeline sans que vous y soyez pour quelque chose.

> Si `pytest` est introuvable alors que le venv est actif, c'est que les
> dépendances de développement ne sont pas installées :
> `pip install -e "./app/back[dev]"` depuis la racine. Le `-e` n'est pas
> optionnel — sans lui, Python importe une copie figée dans
> `site-packages` et aucune de vos modifications n'atteint le serveur.

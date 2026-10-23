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

## Ce qui vit hors des modules

| Fichier | Rôle |
|---|---|
| `main.py` | Assemble l'application et monte les routeurs. Pas de logique. |
| `config.py` | Tous les paramètres, lus depuis l'environnement. |
| `db.py` | Moteur SQLAlchemy et sessions. |
| `commun/` | Ce qui sert à plusieurs modules : adresses de l'API source (`enervision.py`), erreurs, pagination, conversion de fuseaux. |

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

app.include_router(<domaine>_router, prefix="/api/<domaine>", tags=["<Domaine>"])
```

Un module se crée **quand son ticket est pris**, pas à l'avance. Des
dossiers vides créés par anticipation envoient les autres sur de fausses
pistes.

## Modules

| Module | Rôle |
|---|---|
| `sites` | Référentiel des sites : nom, type, capacité, rattachement client |
| `consommation` | Mesure courante et historique de consommation |
| `previsions` | Prévisions du service ML et recommandations qui en découlent |
| `alertes` | Alertes levées, leur sévérité et leur état |
| `commun` | Adresses de l'API source, erreurs, pagination, conversion de fuseaux |

`consommation` regroupe la mesure instantanée et l'historique : c'est la
même grandeur, seule la source diffère — l'API EnerVision pour l'instant
présent (`client.py`), la base pour le passé (`repository.py`, à venir ;
aujourd'hui l'historique passe encore par l'API source).

Les recommandations vivent dans `previsions` parce qu'elles en découlent
directement. Elles en sortiront le jour où elles seront déclenchées par
autre chose qu'une prévision.

Les alertes gardent leur module : elles sont signalées depuis plusieurs
domaines (un dépassement prévu, une coupure constatée, un capteur
défaillant) et ont leur propre cycle de vie — levée, consultée, acquittée.

La collecte et l'ingestion ne figurent pas dans cette liste : elles sont
portées par Azure Data Factory, hors du back-end.

## Endpoints exposés

| Endpoint | Module | Source |
|---|---|---|
| `GET /health` | — | état du service et de la base |
| `GET /api/consommation/resume` | `consommation` | `/api/v1/stats/summary` |
| `GET /api/consommation/historique` | `consommation` | `/api/v1/readings` |

Les noms des endpoints reprennent ceux de l'API source quand ils en
dérivent (`resume` pour `summary`), pour qu'on sache immédiatement d'où
vient une donnée quand on débogue.

`/resume` renvoie, à côté de la mesure :

| Champ | Rôle |
|---|---|
| `fetched_at` | Heure de la mesure |
| `next_at` | Heure de la prochaine mesure, pour que le client s'y cale |
| `stale` | Vrai si la mesure dépasse `CONSUMPTION_STALENESS_S` |

`next_at` évite au front de sonder à l'aveugle : il planifie son appel juste
après l'heure annoncée, et reçoit chaque mesure quelques secondes après
qu'elle existe, pour un seul appel par cycle.

## Règles de réponse

**Pas de valeur de repli inventée.** Quand l'API source ne répond pas,
l'endpoint renvoie une erreur franche : 502 si la source a répondu mais a
refusé, 503 si elle est injoignable. Des chiffres plausibles servis en cas
de panne sont pires qu'une erreur, parce que rien ne les distingue des
vrais.

**Une mesure absente reste `null`.** Jamais zéro : zéro est une mesure,
l'absence de mesure n'en est pas une.

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
générées indépendamment de la consommation réelle. Les afficher à côté de
nos propres courbes produirait des contradictions visibles. Nos badges et
seuils sont dérivés des mesures, pas de cet endpoint.

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

> `db.py` et `tests/test_health.py` sont encore en français
> (`creer_moteur`, `reponse`, `duree`). C'est un reste d'avant cette
> convention, et un ticket est ouvert pour l'aligner. Ne pas s'en inspirer.

## Tests

Les tests suivent la même organisation que le code, un fichier par fichier :

```
tests/
├── conftest.py
├── test_health.py
└── consommation/
    ├── test_client.py
    ├── test_historique.py
    ├── test_routes.py
    └── test_service.py
```

Un test ne doit pas dépendre du lancement de Docker ni d'un appel réseau
réel. Si une fonction a besoin de la base, le test remplace le repository ;
si elle appelle une API extérieure, le test lance un serveur local qui
imite les réponses attendues (voir la fixture `fake_api`).

Les tests marqués `db` sont ignorés quand aucune base n'est joignable. **En
CI, `REQUIRE_DB=1` doit être positionné** : un test `db` doit alors échouer
plutôt qu'être ignoré, sinon une base absente rendrait la CI verte à tort.

Un test gagne à garder un piège plutôt qu'à vérifier une évidence. Les plus
utiles de cette suite vérifient que les bornes envoyées à la source sont en
UTC et dans le passé, que `limit` vaut bien `heures × sites`, et que
`next_at` reflète la cadence configurée — trois erreurs qui ont réellement
coûté du temps.

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

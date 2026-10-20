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
| `models.py` | Les tables SQLAlchemy. |
| `schemas.py` | Les formats d'entrée et de sortie de l'API (Pydantic). |

Tous ne sont pas obligatoires. Un module qui ne lit rien en base n'a pas de
`repository.py` ni de `models.py`.

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
from smart_energy_app.sites import obtenir_site

# Interdit
from smart_energy_app.sites.repository import requete_site
from smart_energy_app.sites.models import Site
```

Si vous avez besoin de quelque chose qu'un module n'expose pas, la réponse
n'est pas de contourner son interface : c'est d'étendre cette interface,
en concertation avec la personne qui porte ce module.

Exemple d'interface :

```python
# sites/__init__.py
from .service import lister_sites, obtenir_site

__all__ = ["lister_sites", "obtenir_site"]
```

## Ce qui vit hors des modules

| Fichier | Rôle |
|---|---|
| `main.py` | Assemble l'application et monte les routeurs. Pas de logique. |
| `config.py` | Tous les paramètres, lus depuis l'environnement. |
| `db.py` | Moteur SQLAlchemy et sessions. |
| `commun/` | Ce qui sert à plusieurs modules : erreurs, pagination, conversion de fuseaux. |

`commun/` est à utiliser avec parcimonie. Dès qu'on y met de la logique
métier, il devient un fourre-tout dont tout le monde dépend.

## Ajouter un module

```bash
cd app/back/src/smart_energy_app
mkdir <domaine>
touch <domaine>/{__init__.py,routes.py,service.py,schemas.py}
```

Puis monter le routeur dans `main.py` :

```python
from smart_energy_app.<domaine>.routes import router as routeur_<domaine>

app.include_router(routeur_<domaine>, prefix="/api/<domaine>", tags=["<Domaine>"])
```

Un module se crée **quand son ticket est pris**, pas à l'avance. Des
dossiers vides créés par anticipation envoient les autres sur de fausses
pistes.

## Modules prévus

| Module | Rôle |
|---|---|
| `sites` | Référentiel des sites |
| `mesures` | Historique de consommation |
| `previsions` | Lecture des prévisions produites par le service ML |
| `recommandations` | Actions proposées aux exploitants |
| `alertes` | Alertes levées et leur état |
| `temps_reel` | Relais vers l'API EnerVision pour l'affichage instantané |

La collecte et l'ingestion ne figurent pas dans cette liste : elles sont
portées par Azure Data Factory, hors du back-end.

## Nommage

- Dossiers, fichiers, fonctions et variables en français, en minuscules,
  avec des tirets bas : `obtenir_site`, `taux_completude`.
- Les noms techniques imposés par les bibliothèques restent en anglais :
  `router`, `app`, `session`.
- Les noms de colonnes en base suivent les noms de l'API source quand ils
  en proviennent (`consumption_kw`, `data_quality`), pour qu'on puisse
  tracer une valeur de bout en bout sans table de correspondance.

## Tests

Les tests suivent la même organisation que le code :

```
tests/
├── sites/
│   └── test_service.py
└── temps_reel/
    └── test_routes.py
```

Un test ne doit pas dépendre du lancement de Docker. Si une fonction a
besoin de la base, le test remplace le repository plutôt que de se
connecter réellement.

# Smart Energy Optimizer — Service Machine Learning

> Projet Piscine EADL · Service de prévision de consommation électrique

## 1. Présentation

Le répertoire `ml/` regroupe les composants de Machine Learning du projet **Smart Energy Optimizer**, développé dans le cadre de la Piscine EADL.

Le service vise à exploiter les données de consommation énergétique des sites EnerVision pour construire, évaluer et utiliser des modèles de prévision. L'objectif métier est d'estimer la consommation électrique pour les horizons **H+1 à H+24**, afin de faciliter l'analyse et l'anticipation des besoins énergétiques.

Il s'inscrit dans une **architecture découplée** : l'application principale, le service ML, les traitements ponctuels et le suivi des modèles disposent de responsabilités distinctes. Le code est maintenu dans le monorepo `smart_energy_optimizer`.

### État du projet

| Fonctionnalité | État |
| --- | --- |
| API REST FastAPI et contrôle de santé | Disponible |
| Exploration des données et comparaison de modèles | Réalisées |
| Entraînement conteneurisé avec `ml-train` | Opérationnel |
| Suivi et enregistrement des modèles dans MLflow | Opérationnel |
| Prédiction conteneurisée avec `ml-predict` | Opérationnelle en exécution manuelle |
| Construction, publication et déploiement des images via GitHub Actions | Opérationnels |
| Enregistrement des prédictions dans PostgreSQL | À vérifier / finaliser |
| Exécution quotidienne planifiée | Non activée |

> **Périmètre de validation :** les workflows manuels d'entraînement et de prédiction ont été exécutés avec succès sur l'infrastructure Azure. La persistance des prédictions en base n'est pas encore considérée comme validée.

## 2. Stack technique

| Technologie | Utilisation |
| --- | --- |
| Python 3.12 | Langage du service ML |
| FastAPI | API REST |
| Uvicorn | Serveur ASGI |
| Scikit-learn | Modèles de régression et évaluation |
| MLflow | Suivi des expérimentations et registre des modèles |
| PostgreSQL 16 | Base de données applicative et cible de persistance |
| Psycopg / SQLAlchemy | Accès PostgreSQL via `DATABASE_URL` |
| Docker et Docker Compose | Construction et exécution des services et traitements |
| GitHub Actions | Tests, publication des images, déploiement et exécutions manuelles |
| GitHub Container Registry (GHCR) | Registre des images Docker |
| Azure VM | Hébergement des services déployés |
| Pytest, HTTPX | Tests automatisés et tests HTTP |
| Ruff | Analyse statique et formatage |
| Setuptools | Packaging Python |
| Jupyter | Exploration et expérimentation |

## 3. Architecture et responsabilités

Le service ML distingue une API disponible en continu de deux traitements ponctuels : l'entraînement et l'inférence.

```text
Données énergétiques / API EnerVision
                │
                ▼
       Préparation des données
                │
          ┌─────┴─────┐
          ▼           ▼
      ml-train    ml-predict
          │           │
          ▼           ▼
        MLflow     Prédictions
    (suivi et      │
     registre)     └──► PostgreSQL (persistance à valider)
          ▲
          │
      Service ML / API FastAPI
```

Ce schéma est une vue fonctionnelle simplifiée : le traitement de prédiction utilise le modèle enregistré dans MLflow, tandis que le service FastAPI est déployé séparément. Il ne représente pas tous les échanges réseau ni les dépendances de démarrage.

### Organisation du répertoire

```text
ml/
├── src/
│   └── smart_energy_ml/
│       ├── api/             # API REST FastAPI
│       ├── ingestion/       # Acquisition des données
│       ├── preprocessing/   # Préparation et transformations
│       ├── training/        # Entraînement et évaluation
│       └── inference/       # Inférence
├── scripts/
│   ├── train.py             # Point d'entrée du job d'entraînement
│   └── predict.py           # Point d'entrée du job de prédiction
├── data/
│   └── processed/          # Données préparées pour l'entraînement
├── tests/                   # Tests automatisés
├── notebooks/               # Expérimentations
├── configs/                 # Configurations, si présentes
├── Dockerfile               # Image du service ML
├── Dockerfile.train         # Image d'entraînement
├── Dockerfile.predict       # Image de prédiction
├── Dockerfile.mlflow        # Image MLflow
├── pyproject.toml           # Dépendances et configuration Python
└── README.md
```

Les répertoires décrivent l'organisation logique du service ; leur contenu précis peut évoluer avec les développements.

## 4. Installation et développement local

### Prérequis

- Python 3.12 ;
- Git ;
- Docker et Docker Compose pour les exécutions conteneurisées ;
- un éditeur compatible Python (VS Code, par exemple).

Depuis `ml/`, créer et activer un environnement virtuel.

**Windows PowerShell**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

**Linux / macOS**

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
```

L'installation éditable (`-e`) permet de modifier le code source sans réinstaller le package après chaque changement.

### Démarrer l'API FastAPI

Depuis `ml/`, environnement virtuel activé :

```bash
python -m uvicorn smart_energy_ml.api.main:app --reload
```

En développement local, l'API est accessible sur `http://127.0.0.1:8000`.

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/health` | Vérification de disponibilité |
| GET | `/docs` | Documentation Swagger UI |
| GET | `/openapi.json` | Spécification OpenAPI |

Exemple de réponse attendue pour `/health` :

```json
{
  "status": "ok"
}
```

L'option `--reload` est réservée au développement.

## 5. Environnement Docker

Le fichier `docker-compose.yml`, situé à la racine du monorepo, décrit les services applicatifs et leurs dépendances.

| Service Compose | Rôle | Mode d'exécution |
| --- | --- | --- |
| `ml` | API ML | Service permanent |
| `mlflow` | Tracking et registre de modèles | Service permanent |
| `ml-train` | Entraînement et enregistrement du modèle | Job ponctuel (`jobs`) |
| `ml-predict` | Exécution des prédictions | Job ponctuel (`jobs`) |
| `db` | PostgreSQL | Service permanent |

Les jobs `ml-train` et `ml-predict` appartiennent au profil Compose `jobs` et ne sont pas destinés à rester actifs en permanence.

### Exécution locale avec Compose

Depuis la racine du dépôt, après avoir configuré les variables nécessaires :

```bash
docker compose up -d db mlflow ml
```

Pour lancer un entraînement ponctuel :

```bash
docker compose --profile jobs run --rm ml-train
```

Pour lancer une prédiction ponctuelle à partir de l'API :

```bash
docker compose --profile jobs run --rm ml-predict --source api
```

> Ces commandes supposent que les services dépendants sont disponibles et que les variables de configuration requises sont renseignées. Elles utilisent les images de développement définies par le Compose local ; les workflows de production utilisent des images GHCR versionnées.

## 6. Entraînement du modèle — `ml-train`

### Objectif

Le job `ml-train` prépare les données nécessaires, entraîne le modèle, évalue ses performances et publie les informations du modèle dans MLflow. Le point d'entrée conteneurisé est `scripts/train.py`.

L'image d'entraînement est construite à partir de `Dockerfile.train`. Elle embarque notamment :

- le package Python du service ;
- `scripts/train.py` ;
- le dataset préparé `data/processed/readings_hourly_20250101_20260701.parquet`.

### Suivi dans MLflow

MLflow permet de conserver les résultats des entraînements et de gérer les versions de modèles. Le pipeline utilise le registre de modèles, avec une logique de sélection du modèle de référence par alias `champion`.

Le modèle global Random Forest est enregistré sous le nom `smart-energy-rf-global` dans les exécutions observées.

Les métriques de suivi comprennent notamment la **MAE**, la **RMSE** et la **WAPE**.

### Entraînement sur Azure via GitHub Actions

Le workflow **`ML - Train Model`** est déclenché manuellement (`workflow_dispatch`) et s'exécute sur le runner `self-hosted` de production.

Son fonctionnement :

1. Récupérer l'image `ml` effectivement exécutée en production et en déduire son SHA.
2. Construire les références des images GHCR correspondant à cette même version.
3. Charger la configuration Compose de production et les variables d'environnement nécessaires.
4. Valider la configuration avec `docker compose config --quiet`.
5. Télécharger l'image `ml-train` correspondante.
6. Exécuter `ml-train` avec `TRAIN_ENVIRONMENT=production`.
7. Terminer et supprimer le conteneur de job après son exécution.

Cette stratégie évite d'entraîner un modèle avec une image provenant d'une autre version que celle déployée.

## 7. Prédictions — `ml-predict`

Le job `ml-predict` réalise l'inférence à partir du modèle disponible dans MLflow. Son point d'entrée est `scripts/predict.py`, embarqué dans l'image construite avec `Dockerfile.predict`.

### Exécution manuelle sur Azure

Le workflow **`ML - Daily Predictions`** est actuellement déclenché à la demande (`workflow_dispatch`).

Il :

1. Identifie le SHA de l'image `ml` en cours d'exécution sur Azure.
2. Prépare les références des images GHCR de cette version.
3. Charge les variables de production et valide la configuration Compose.
4. Lance un conteneur ponctuel `ml-predict` avec l'argument `--source api`.

La commande principale est :

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.deploy.yml \
  --env-file "$HOME/enervision/.env" \
  run --rm ml-predict --source api
```

Cette commande illustre le fonctionnement du workflow sur le runner Azure ; les variables d'images GHCR et les secrets nécessaires doivent également être disponibles dans son environnement.

### Planification

Une planification quotidienne est prévue, mais **elle n'est pas activée** à ce stade. Le workflow contient une configuration `schedule` commentée :

```yaml
# schedule:
#   - cron: "0 1 * * *"
```

La fréquence et l'horaire définitifs devront être validés avant activation. Les expressions cron GitHub Actions utilisent UTC par défaut.

### Persistance des prédictions

La configuration de `ml-predict` fournit une variable `DATABASE_URL` vers PostgreSQL. Toutefois, la réussite du workflow ne constitue pas à elle seule une preuve d'insertion en base.

**Reste à vérifier :** le schéma cible, les permissions du rôle ML, le code d'écriture, la gestion des doublons et les tests d'intégration associés. Cette étape n'est donc pas annoncée comme terminée.

## 8. Configuration et secrets

Les services Docker utilisent des variables d'environnement pour leur configuration.

| Variable | Usage |
| --- | --- |
| `MLFLOW_TRACKING_URI` | Adresse du serveur MLflow, par exemple `http://mlflow:5000` dans Compose |
| `MLFLOW_EXPERIMENT_NAME` | Nom de l'expérience MLflow |
| `DATABASE_URL` | Connexion PostgreSQL utilisée par les composants concernés |
| `TRAIN_ENVIRONMENT` | Contexte d'exécution de l'entraînement |
| `POSTGRES_PASSWORD` | Mot de passe du compte administrateur PostgreSQL |
| `APP_DB_PASSWORD` | Mot de passe du rôle applicatif |
| `ML_DB_PASSWORD` | Mot de passe du rôle ML |

Dans Docker Compose, une connexion ML peut prendre la forme :

```text
postgresql+psycopg://enervision_ml:${ML_DB_PASSWORD}@db:5432/enervision
```

Les secrets ne doivent **jamais** être committés. En production, les workflows utilisent les secrets GitHub Actions et le fichier d'environnement de la VM (`$HOME/enervision/.env`).

L'option `--env-file` de Compose intervient lors de l'interpolation des variables dans les fichiers Compose. Elle ne doit pas être confondue avec l'attribut `env_file` d'un service, qui fournit des variables à son conteneur.

## 9. Intégration continue et déploiement

Le monorepo utilise GitHub Actions pour contrôler la qualité, construire les images et déployer une version cohérente.

### CI et publication

Le workflow **`CI`** comprend, selon les fichiers modifiés et les conditions d'exécution :

- les contrôles de qualité et les tests ;
- la construction des images Docker ;
- leur analyse de sécurité ;
- les tests de performance ;
- la publication des images validées dans GHCR.

Les images concernées sont `back`, `ml`, `ml-predict`, `ml-train`, `mlflow` et `front`.

Chaque image publiée porte le **SHA du commit Git**, ce qui permet de retrouver précisément la version du code utilisée.

### Déploiement Azure

Le workflow **`Deploy to Azure VM`** recherche le commit le plus récent de `main` pour lequel **les six images** sont disponibles dans GHCR. Il ne déploie donc pas un ensemble incomplet d'images.

Le déploiement utilise `docker-compose.yml` et `docker-compose.deploy.yml`, puis effectue des vérifications de disponibilité du site depuis l'extérieur de la VM.

Les workflows d'entraînement et de prédiction utilisent eux aussi les images correspondant à la version déployée. Ils partagent un groupe de concurrence avec le déploiement pour éviter des exécutions simultanées incompatibles.

## 10. Tests et qualité

Depuis `ml/`, avec les dépendances de développement installées :

```bash
python -m pytest -v
python -m ruff check .
python -m ruff format --check .
```

Pour appliquer les corrections de style :

```bash
python -m ruff check . --fix
python -m ruff format .
```

Depuis la racine du monorepo, les modifications de workflows GitHub Actions peuvent également être vérifiées avec `actionlint`, si cet outil est installé :

```bash
actionlint .github/workflows/*.yml
```

Les contrôles doivent être validés avant intégration dans `main`. Les tests locaux ne remplacent pas les vérifications effectuées par la CI et les tests d'intégration sur l'infrastructure cible.

## 11. Expérimentations et évaluation

### Objectif expérimental

Évaluer la faisabilité de la prévision de consommation électrique des sites pour les horizons **H+1 à H+24**, à partir des historiques de consommation et des caractéristiques temporelles.

### Méthodologie

Les expérimentations ont d'abord été réalisées dans des notebooks Jupyter avant intégration progressive du code validé dans le service Python.

Les travaux ont notamment porté sur :

- l'exploration et le nettoyage des données ;
- l'agrégation des relevés à une granularité horaire ;
- le *feature engineering* temporel et historique ;
- des références (*baselines*) à H-24 et H-168 ;
- la comparaison entre régression linéaire et Random Forest ;
- la comparaison de modèles globaux et spécialisés par type de site ;
- une validation chronologique sur l'historique 2023–2024.

### Résultats expérimentaux

| Jeu de données | Modèle | MAE | RMSE |
| --- | --- | ---: | ---: |
| Relevés sur 30 jours | Baseline H-168 | 6,78 kW | 10,48 kW |
| Relevés sur 30 jours | Random Forest globale | 6,21 kW | 9,61 kW |
| Historique 2023–2024, test indépendant | Baseline H-168 | 95,99 kW | 215,53 kW |
| Historique 2023–2024, test indépendant | Random Forest globale | 74,70 kW | 163,29 kW |

Sur le jeu de test historique indépendant, la Random Forest globale réduit la MAE d'environ **22,18 %** par rapport à la baseline hebdomadaire.

Ces chiffres correspondent à des **expérimentations identifiées**, et non à une promesse de performance en production. Ils ne doivent pas être confondus avec les métriques des entraînements plus récents enregistrés dans MLflow.

### Limites

Les données expérimentales sont synthétiques et portent sur sept sites. Les deux jeux de données ne sont pas directement comparables en valeur absolue.

Les principales limites concernent la représentativité des données, la disponibilité d'un historique suffisant, les valeurs manquantes, les dérives de consommation et la généralisation à de nouveaux sites.

## 12. Versionnement et bonnes pratiques

Le service ML fait partie du monorepo `smart_energy_optimizer`, mais possède son propre package Python et ses dépendances.

Les environnements virtuels, secrets, caches, notebooks temporaires et artefacts de modèles ne doivent pas être ajoutés au dépôt sans nécessité explicite. Les données volumineuses font l'objet d'une politique de versionnement adaptée ; **le dataset préparé requis par `Dockerfile.train` constitue une exception connue**, puisqu'il est embarqué dans l'image d'entraînement.

Le développement s'effectue sur des branches dédiées, avec intégration dans `main` après revue et validation des contrôles qualité.

## 13. Travaux restant à réaliser

1. **Valider la persistance PostgreSQL** des prédictions : table cible, insertion, permissions, gestion des erreurs et tests.
2. **Vérifier les résultats d'inférence** sur des données représentatives et suivre leur qualité dans le temps.
3. **Activer la planification quotidienne** une fois l'exécution et la persistance validées.
4. **Renforcer l'observabilité** des traitements : logs, alertes, échecs d'exécution et suivi des métriques.
5. **Maintenir la documentation** des configurations et procédures d'exploitation à mesure que l'architecture évolue.

---

**Smart Energy Optimizer — Piscine EADL**  
Documentation du service Machine Learning. Les procédures décrites reflètent l'état connu du projet au **30 octobre 2026**.

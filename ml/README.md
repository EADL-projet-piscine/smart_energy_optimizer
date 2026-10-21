# Smart Energy Optimizer — ML Service

## 1. Présentation

Ce répertoire contient le service Machine Learning du projet **Smart Energy Optimizer**, développé dans le cadre du projet Piscine EADL.

Ce service a pour objectif de traiter des données énergétiques, d'entraîner des modèles de Machine Learning et d'exposer leurs prédictions à travers une API REST.

Il est conçu pour fonctionner indépendamment de l'application principale, dans une architecture découplée.

**État actuel :** socle technique initialisé. Les fonctionnalités de traitement des données, d'entraînement et de prédiction restent à développer.

## 2. Stack technique

| Technologie | Rôle |
|---|---|
| Python 3.12 | Langage de développement |
| FastAPI | Framework API REST |
| Uvicorn | Serveur ASGI |
| Pytest | Tests automatisés |
| HTTPX | Client HTTP pour les tests |
| Ruff | Analyse statique et formatage |
| Setuptools | Packaging Python |

Les bibliothèques de traitement de données et de Machine Learning seront intégrées progressivement.

## 3. Architecture du projet

```text
ml/
├── src/
│   └── smart_energy_ml/
│       ├── api/             # API REST FastAPI
│       ├── ingestion/       # Acquisition des données
│       ├── preprocessing/   # Nettoyage et transformation
│       ├── training/        # Entraînement des modèles
│       └── inference/       # Prédictions
├── tests/                   # Tests automatisés
├── notebooks/               # Expérimentations
├── configs/                 # Configurations
├── pyproject.toml           # Dépendances et configuration
└── README.md
```

Le code est organisé par responsabilités afin de faciliter la maintenance, les tests et l'évolution du service.

## 4. Installation locale

### Prérequis

- Python 3.12
- Git
- Un environnement de développement compatible Python (VSCode recommandé)

### Création de l'environnement virtuel

Depuis le répertoire `ml/` :

```powershell
python -m venv .venv
```

Activation sous Windows PowerShell :

```powershell
.\.venv\Scripts\Activate.ps1
```

### Installation des dépendances

```powershell
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

L'option `-e` permet d'installer le package en mode éditable.

## 5. Démarrage du service

Depuis le répertoire `ml/`, avec l'environnement virtuel activé :

```powershell
python -m uvicorn smart_energy_ml.api.main:app --reload
```

Le serveur est accessible à l'adresse :

http://127.0.0.1:8000

L'option `--reload` est réservée au développement local.

### Endpoints disponibles

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/health` | Vérification du fonctionnement de l'API |
| GET | `/docs` | Documentation interactive Swagger |
| GET | `/openapi.json` | Spécification OpenAPI |

Exemple de réponse de `/health` :

```json
{
  "status": "ok"
}
```

## 6. Tests et qualité du code

### Exécution des tests

```powershell
python -m pytest -v
```

### Analyse statique

```powershell
python -m ruff check .
```

### Vérification du formatage

```powershell
python -m ruff format --check .
```

### Application du formatage

```powershell
python -m ruff format .
```

Les tests et contrôles de qualité doivent être validés avant toute intégration dans la branche principale.

## 7. Évolutions prévues

Les prochaines itérations porteront sur :

- L'ingestion des données énergétiques.
- Le nettoyage et la préparation des datasets.
- L'entraînement et l'évaluation des modèles avec Scikit-learn.
- Le suivi des expérimentations avec MLflow.
- L'exposition des prédictions via l'API FastAPI.
- La conteneurisation et le déploiement sur Azure.
- L'automatisation des tests et des déploiements via GitHub Actions.

## 8. Versionnement

Le service ML est intégré au monorepo `smart_energy_optimizer`, tout en conservant son propre environnement Python et ses dépendances.

Les environnements virtuels, secrets, données volumineuses et modèles entraînés sont exclus du versionnement Git.

Le développement s'effectue sur des branches dédiées, avec intégration dans `main` après validation.

# Smart Energy Optimizer

Plateforme d'optimisation énergétique : collecte des mesures de consommation
de sept sites, détection d'anomalies, prévision des pics et recommandations.

Projet EADL — promotion READL006, groupe G4 Rennes.

## Prérequis

- Python 3.12
- Docker et Docker Compose
- Git

## Structure du dépôt

    app/      Application métier — API consommée par le dashboard
    ml/       Service de prédiction — modèle et API dédiée
    infra/    Infrastructure (Terraform)
    docs/     Documentation du projet

`app` et `ml` sont deux services déployés séparément. Chacun a son propre
`pyproject.toml` et son propre environnement virtuel.

## Démarrage

### 1. Cloner le dépôt

```bash
git clone https://github.com/EADL-projet-piscine/smart_energy_optimizer.git
cd smart_energy_optimizer
```

### 2. Lancer la base de données

```bash
docker compose up -d db
docker compose ps
```

Attendre que la colonne `STATUS` indique `healthy`.

PostgreSQL écoute sur le port **5433** de la machine (et non 5432, pour
éviter les conflits avec une instance déjà installée).

### 3. Lancer l'application métier

```bash
cd app
cp .env.example .env
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn smart_energy_app.main:app --reload
```

L'application est disponible sur http://127.0.0.1:8000

- http://127.0.0.1:8000/health — état du service et de la base
- http://127.0.0.1:8000/docs — documentation de l'API

Réponse attendue sur `/health` :

```json
{"status": "ok", "database": "ok"}
```

Si `database` vaut `indisponible`, vérifier que le conteneur tourne
(`docker compose ps`) et que `DATABASE_URL` dans `app/.env` pointe bien
sur le port 5433.

### 4. Lancer le service de prédiction

```bash
cd ml
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn smart_energy_ml.api.main:app --reload --port 8001
```

## Tests

Depuis `app/` ou `ml/`, environnement virtuel activé :

```bash
pytest
```

## Qualité de code

```bash
ruff check .          # signaler les problèmes
ruff check . --fix    # corriger ce qui peut l'être
ruff format .         # mettre en forme
```

Configuration : ligne à 100 caractères, cible Python 3.12.

## Configuration

Les paramètres sont lus depuis les variables d'environnement, ou depuis le
fichier `.env` du service. Ne jamais versionner un `.env` : il est ignoré
par Git. Le fichier `.env.example` sert de modèle.

| Variable | Rôle | Défaut |
|---|---|---|
| `ENERVISION_API_URL` | URL de l'API source | `https://api-mock.charlieandre.fr` |
| `ENERVISION_TIMEOUT_S` | Délai d'attente des appels API, en secondes | `10` |
| `DATABASE_URL` | Connexion PostgreSQL | `postgresql+psycopg://enervision:enervision@localhost:5433/enervision` |

## Arrêter l'environnement

```bash
docker compose down        # arrêter la base
docker compose down -v     # arrêter et supprimer les données
```

## Conventions

À compléter avec l'équipe : nommage des branches, format des messages de
commit, processus de revue.

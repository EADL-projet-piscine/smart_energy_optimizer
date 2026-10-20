# Smart Energy Optimizer

Plateforme d'optimisation énergétique : collecte des mesures de consommation
de sept sites, détection d'anomalies, prévision des pics et recommandations.

Projet EADL — promotion READL006, groupe G4 Rennes.

## Prérequis

- Python 3.12
- Docker et Docker Compose
- Git

## Structure du dépôt

    app/
      front/  Dashboard
      back/   API métier — consommée par le dashboard
    ml/       Service de prédiction — modèle et API dédiée
    infra/    Infrastructure (Terraform, Data Factory)
    docs/     Documentation du projet

`app/back`, `app/front` et `ml` sont déployés séparément. Chaque service
Python a son propre `pyproject.toml` et son propre environnement virtuel.

## Démarrage

### 1. Cloner le dépôt

```bash
git clone https://github.com/EADL-projet-piscine/smart_energy_optimizer.git
cd smart_energy_optimizer
```

### 2. Tout lancer d'un coup

```bash
docker compose up -d --build
```

L'API est disponible sur http://localhost:8000 — rien d'autre à installer.

Les étapes suivantes décrivent l'installation sans conteneur, utile pour
développer avec le rechargement automatique.

### 3. Lancer la base de données seule

```bash
docker compose up -d db
docker compose ps
```

Attendre que la colonne `STATUS` indique `healthy`.

PostgreSQL écoute sur le port **5433** de la machine (et non 5432, pour
éviter les conflits avec une instance déjà installée).

### 4. Lancer l'application métier

```bash
cd app/back
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
(`docker compose ps`) et que `DATABASE_URL` dans `app/back/.env` pointe
bien sur le port 5433.

L'adresse de la base diffère selon le mode de lancement : `db:5432` depuis
un conteneur, `localhost:5433` depuis la machine.

### 5. Lancer le service de prédiction

```bash
cd ml
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn smart_energy_ml.api.main:app --reload --port 8001
```

## Tests

Depuis `app/back` ou `ml/`, environnement virtuel activé :

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
docker compose down        # arrêter les conteneurs
docker compose down -v     # arrêter et supprimer les données
```

## Conventions

L'organisation du back-end est décrite dans `docs/conventions-back.md`, à
lire avant d'écrire du code dans `app/back`.

À compléter avec l'équipe : nommage des branches, format des messages de
commit, processus de revue.

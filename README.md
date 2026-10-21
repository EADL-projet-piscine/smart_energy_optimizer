# Smart Energy Optimizer

Plateforme d'optimisation énergétique : collecte des mesures de consommation
de sept sites, détection d'anomalies, prévision des pics et recommandations.

Projet EADL — promotion READL006, groupe G4 Rennes.

## Prérequis

- Python 3.12
- Docker et Docker Compose
- Git

Les commandes sont données dans deux variantes : **Linux / macOS / WSL** et
**Windows (PowerShell)**. Suivez celle qui correspond à votre terminal.
Sous Windows, si vous avez WSL installé, tapez `wsl` puis suivez la
première variante : c'est le plus simple et c'est l'environnement dans
lequel le projet est testé.

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

### 2. Installer les vérifications avant commit

Un contrôle automatique met le code en forme et corrige les erreurs de
style à chaque commit. À installer **une fois** après le clone :

```bash
sudo apt install pre-commit     # ou : pip install pre-commit
pre-commit install
```

Sous Windows : `pip install pre-commit` dans votre environnement virtuel,
ou `pipx install pre-commit`.

Si un commit échoue avec « files were modified by this hook », c'est que
des fichiers ont été corrigés automatiquement : relancez `git add -A` puis
le commit.

### 3. Configurer l'accès à l'API source

```bash
cd app/back
cp .env.example .env
```

Puis renseignez dans `.env` les identifiants fournis par le formateur :

```
ENERVISION_USER=...
ENERVISION_PASSWORD=...
```

Depuis le réseau de l'école, l'instance interne `http://10.43.43.80:8000`
ne demande pas d'authentification : laissez les deux champs vides et
changez `ENERVISION_API_URL`.

Ne jamais mettre ces identifiants dans `.env.example`, qui est versionné.

### 4. Tout lancer d'un coup

```bash
docker compose up -d --build
```

L'API est disponible sur http://localhost:8000 — rien d'autre à installer.

Lancez cette commande depuis le dossier où se trouve le dépôt. Si le dépôt
est dans WSL, lancez-la depuis WSL : un terminal Windows ne verra pas les
mêmes chemins.

Le microservice ML est également accessible sur http://localhost:8001.

- http://localhost:8001/health — état du service ML
- http://localhost:8001/docs — documentation interactive de l'API ML


Les étapes suivantes décrivent l'installation sans conteneur, utile pour
développer avec le rechargement automatique.

### 5. Lancer la base de données seule

```bash
docker compose up -d db
docker compose ps
```

Attendre que la colonne `STATUS` indique `healthy`.

PostgreSQL écoute sur le port **5433** de la machine (et non 5432, pour
éviter les conflits avec une instance déjà installée).

### 4. Lancer l'application métier

**Linux / macOS / WSL**

```bash
cd app/back
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn smart_energy_app.main:app --reload
```

**Windows (PowerShell)**

```powershell
cd app\back
copy .env.example .env
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn smart_energy_app.main:app --reload
```

Si PowerShell refuse d'exécuter le script d'activation, levez la
restriction pour cette session seulement :

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Lancez les commandes **une par une**. Collées en bloc, certains terminaux
perdent les retours à la ligne et les fusionnent.

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

**Linux / macOS / WSL**

```bash
cd ml
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn smart_energy_ml.api.main:app --reload --port 8001
```

**Windows (PowerShell)**

```powershell
cd ml
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn smart_energy_ml.api.main:app --reload --port 8001
```

## Tests

Depuis `app/back` ou `ml/`, environnement virtuel activé :

```bash
pytest
```

Rappel de l'activation : `source .venv/bin/activate` sous Linux, macOS et
WSL, `.venv\Scripts\Activate.ps1` sous PowerShell. L'invite doit afficher
`(.venv)`.

## Qualité de code

```bash
ruff check .          # signaler les problèmes
ruff check . --fix    # corriger ce qui peut l'être
ruff format .         # mettre en forme
```

Configuration : ligne à 100 caractères, cible Python 3.12.

### Vérifications locales (pre-commit et pre-push)

Deux hooks Git sont fournis, installés ensemble par une seule commande :

| Moment | Contrôles | Effet |
|---|---|---|
| Avant chaque commit | `ruff check --fix`, `ruff format` | corrige et formate |
| Avant chaque push | `ruff check`, `ruff format --check`, `pytest` | bloque le push en cas d'erreur, comme la CI |

À installer une fois, depuis la racine du dépôt, dans un environnement
virtuel **Python 3.12** activé avec les dépendances dev des deux services
(`pre-commit` en fait partie) :

```bash
pre-commit install
```

Si le hook de commit a modifié des fichiers, le commit est interrompu :
relisez les changements, ajoutez-les (`git add`) et relancez le commit.

Le hook de push lance `pytest` avec l'environnement virtuel **activé** : si
le push échoue avec `No module named pytest`, activez le `.venv` puis
relancez. Pour tout vérifier sans pousser :

```bash
pre-commit run --all-files                         # contrôles du commit
pre-commit run --hook-stage pre-push --all-files   # contrôles du push
```

La version de ruff du hook (`.pre-commit-config.yaml`) doit rester identique
à celle des `pyproject.toml`, sinon le hook et la CI ne verront pas les mêmes
erreurs.

## Intégration continue

Le workflow `.github/workflows/ci.yml` tourne sur chaque pull request et à
chaque merge dans `main` :

| Job | Rôle |
|---|---|
| `lint` | `ruff check`, `ruff format --check`, `pytest` |
| `scan` | Trivy sur le dépôt : dépendances, mauvaises configurations, secrets |
| `build` | Construit les images `back` et `ml`, les scanne avec Trivy |

Un job en échec bloque la suite : `build` ne démarre que si `lint` et `scan`
passent. Les scans échouent sur toute vulnérabilité HIGH ou CRITICAL ; pour
les images, seules celles qui ont un correctif disponible sont bloquantes.

Depuis `main` uniquement, les images sont publiées sur GitHub Container
Registry, étiquetées avec le SHA du commit et `latest` :

    ghcr.io/eadl-projet-piscine/smart_energy_optimizer/back
    ghcr.io/eadl-projet-piscine/smart_energy_optimizer/ml

GitHub ne permet pas de protéger `main` sur ce dépôt : **ne mergez pas une
pull request dont la CI est rouge.**

## Configuration

Les paramètres sont lus depuis les variables d'environnement, ou depuis le
fichier `.env` du service. Ne jamais versionner un `.env` : il est ignoré
par Git. Le fichier `.env.example` sert de modèle.

| Variable | Rôle | Défaut |
|---|---|---|
| `ENERVISION_API_URL` | URL de l'API source | `https://api-mock.charlieandre.fr` |
| `ENERVISION_TIMEOUT_S` | Délai d'attente des appels API, en secondes | `10` |
| `ENERVISION_USER` | Identifiant HTTP Basic de l'API source | vide |
| `ENERVISION_PASSWORD` | Mot de passe HTTP Basic de l'API source | vide |
| `DATABASE_URL` | Connexion PostgreSQL | `postgresql+psycopg://enervision:enervision@localhost:5433/enervision` |
| `CONSUMPTION_REFRESH_S` | Intervalle de rafraîchissement de la mesure courante, en secondes | `60` |
| `CONSUMPTION_STALENESS_S` | Âge à partir duquel une mesure est signalée périmée, en secondes | `120` |

## Arrêter l'environnement

```bash
docker compose down        # arrêter les conteneurs
docker compose down -v     # arrêter et supprimer les données
```

## En cas de problème

**`source : Le terme «source» n'est pas reconnu`** — vous êtes dans
PowerShell, pas dans un shell Unix. Suivez la variante Windows, ou tapez
`wsl` pour basculer.

**Deux commandes fusionnées** (`.venvsource`, `".[dev]"uvicorn`) — le
copier-coller a perdu les retours à la ligne. Relancez les commandes une
par une.

**`failed to connect to the docker API`** — Docker Desktop n'est pas lancé.
L'ouvrir et attendre l'état *Engine running*.

**`port is already allocated`** — le port 8000 ou 5433 est déjà utilisé sur
votre machine. Arrêtez le programme qui l'occupe, ou changez le port dans
`docker-compose.yml`.

**L'API répond `"database": "indisponible"`** — la base n'est pas joignable.
Vérifiez `docker compose ps`, puis `docker compose logs db`.

**Les logs affichent `l'API a répondu 401`** — les identifiants de l'API
source manquent ou sont faux. Vérifiez `ENERVISION_USER` et
`ENERVISION_PASSWORD` dans `app/back/.env`, et relancez l'application : le
fichier n'est lu qu'au démarrage.

**`/api/consommation/resume` répond 503** — aucune mesure n'a encore été
récupérée. Regardez les logs de l'application : le rafraîchissement tourne
toutes les minutes et journalise chaque tentative.

**`Temporary failure in name resolution` dans WSL** — le réseau de WSL est
tombé. Depuis PowerShell : `wsl --shutdown`, puis rouvrir le terminal.

## Conventions

L'organisation du back-end est décrite dans `docs/conventions-back.md`, à
lire avant d'écrire du code dans `app/back`.

À compléter avec l'équipe : nommage des branches, format des messages de
commit, processus de revue.

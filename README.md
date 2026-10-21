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

### 2. Tout lancer d'un coup

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

### 3. Lancer la base de données seule

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
cp .env.example .env
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

Depuis la racine du dépôt, environnement virtuel activé avec les dépendances
dev des deux services :

```bash
pytest                 # tests du back et du service ML
pytest --cov           # avec la couverture (seuil : 70 %)
```

Rappel de l'activation : `source .venv/bin/activate` sous Linux, macOS et
WSL, `.venv\Scripts\Activate.ps1` sous PowerShell. L'invite doit afficher
`(.venv)`.

### Tests qui ont besoin de la base

Les tests marqués `@pytest.mark.db` interrogent une vraie base PostgreSQL.
Sans base joignable, ils sont **ignorés** (`SKIPPED`) : le reste de la suite
tourne quand même. Pour les exécuter, lancez la base (`docker compose up -d
db`) avant `pytest`.

En CI, `REQUIRE_DB=1` est défini : une base absente fait alors **échouer**
ces tests au lieu de les ignorer.

### Couverture

Le seuil minimal est fixé dans `pyproject.toml` (`[tool.coverage.report]`,
`fail_under = 70`) : en dessous, `pytest --cov` échoue. Le rapport HTML est
écrit dans `htmlcov/`.

### Test de charge

`tests/perf/health.js` est un scénario [k6](https://grafana.com/docs/k6/)
sur `/health` du back et du service ML : 10 utilisateurs virtuels pendant
30 secondes. Il échoue si :

| Seuil | Valeur |
|---|---|
| Temps de réponse p95 | < 500 ms |
| Requêtes en erreur | < 1 % |
| Vérifications réussies | > 99 % |

Pour le lancer en local, stack démarrée (`docker compose up -d --build`) :

```bash
docker run --rm --network host -v "$PWD/tests/perf:/scripts:ro" grafana/k6:2.3.0 run /scripts/health.js
```

`--network host` ne fonctionne que sous Linux et WSL. Sous Docker Desktop
(Windows, macOS), remplacez-le par
`-e BACK_URL=http://host.docker.internal:8000 -e ML_URL=http://host.docker.internal:8001`.

## Qualité de code

Configuration ruff : ligne à 100 caractères, cible Python 3.12 (sections
`[tool.ruff]` des `pyproject.toml`).

### Vérifications locales (hooks Git)

Les hooks bloquent un commit ou un push qui ferait échouer le job `lint` de
la CI. Ils lancent `scripts/check.sh`, **le même script que la CI** : ce qui
passe en local passe sur la pull request.

**Aucun Python n'est nécessaire.** Au premier lancement, le script télécharge
ruff en binaire autonome, à la version épinglée dans `pyproject.toml`, vérifie
son empreinte SHA-256 et le range dans `.tools/` (ignoré par Git).

| Moment | Contrôles | Effet |
|---|---|---|
| Avant chaque commit | sur les fichiers indexés : `ruff check`, formatage ruff, espaces en fin de ligne, lignes vides en fin de fichier, marqueurs de conflit, saut de ligne final, fichiers > 1 Mo | bloque le commit ; corrige automatiquement ce que ruff sait corriger |
| Avant chaque push | les mêmes contrôles, sur chaque commit poussé | bloque le push (rattrape un `git commit --no-verify`) |

**Activation** : automatique dans la plupart des cas, sinon une commande.

- **VS Code** : à la première ouverture du dossier, VS Code demande
  d'autoriser les tâches automatiques ; acceptez, et les hooks sont activés
  à chaque ouverture (`.vscode/tasks.json`).
- **Front-end** : `npm install` dans `app/front` les active aussi (script
  `prepare` de `package.json`).
- **Sinon**, une fois par clone, depuis la racine du dépôt (Windows, Linux,
  macOS, WSL) :

```bash
git config core.hooksPath .githooks
```

Pour vérifier l'activation : `git config core.hooksPath` doit afficher
`.githooks`. La commande n'écrit qu'une ligne dans le `.git/config` du clone ;
`git config --unset core.hooksPath` la retire.

Les hooks s'appliquent aussi aux commits lancés depuis VS Code ou tout autre
outil Git. Prérequis : Git (sous Windows, Git for Windows fournit le shell qui
exécute les hooks) et un accès à GitHub au premier lancement.

**Commit refusé** : le message indique le fichier et la ligne en cause. Si
ruff a corrigé le fichier, relisez la correction, ajoutez-la (`git add`) et
relancez le commit.

**Lancer les contrôles à la main** :

```bash
git hook run pre-commit    # fichiers indexés (fonctionne aussi sous PowerShell)
sh scripts/check.sh        # dernier commit, comme la CI (Git Bash, Linux, macOS, WSL)
```

**Formater tout le projet** (après un premier lancement des hooks) :
`.tools/ruff/ruff format .`, ou `.tools\ruff\ruff.exe format .` sous PowerShell.

Pour changer de version de ruff, modifiez `ruff==` dans les trois
`pyproject.toml` : le script, les hooks et la CI suivent.

Les tests (`pytest`) ne font pas partie des hooks : ils demandent Python et
une base PostgreSQL. La CI les exécute sur chaque pull request ; la section
« Tests » explique comment les lancer en local.

## Intégration continue

Le workflow `.github/workflows/ci.yml` tourne sur chaque pull request et à
chaque merge dans `main` :

| Job | Rôle |
|---|---|
| `lint` | `sh scripts/check.sh` (mêmes contrôles que les hooks locaux), puis `pytest` avec couverture, contre un service PostgreSQL 16 |
| `scan` | Trivy sur le dépôt : dépendances, mauvaises configurations, secrets |
| `build` | Construit les images `back` et `ml`, les scanne avec Trivy |
| `perf` | Lance la stack avec ces images et exécute le test de charge k6 |
| `publish` | Publie les images sur GHCR (depuis `main` uniquement) |

Chaque étape attend la réussite de la précédente : `lint` + `scan` →
`build` → `perf` → `publish`. Une image n'est donc publiée qu'après avoir
passé les tests, le scan de sécurité et le test de charge.

Les scans échouent sur toute vulnérabilité HIGH ou CRITICAL ; pour les
images, seules celles qui ont un correctif disponible sont bloquantes.

Rapports publiés en artefacts sur chaque run (onglet *Actions* → run →
*Artifacts*) : `coverage` (HTML + XML) et `k6-results` (résumé JSON du test
de charge).

Les images publiées sont étiquetées avec le SHA du commit et `latest` :

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
| `DATABASE_URL` | Connexion PostgreSQL | `postgresql+psycopg://enervision:enervision@localhost:5433/enervision` |

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

**`port is already allocated`** — le port 8000 ou 5433 est déjà utilisé sur
votre machine. Arrêtez le programme qui l'occupe, ou changez le port dans
`docker-compose.yml`.

**L'API répond `"database": "indisponible"`** — la base n'est pas joignable.
Vérifiez `docker compose ps`, puis `docker compose logs db`.

## Conventions

L'organisation du back-end est décrite dans `docs/conventions-back.md`, à
lire avant d'écrire du code dans `app/back`.

À compléter avec l'équipe : nommage des branches, format des messages de
commit, processus de revue.

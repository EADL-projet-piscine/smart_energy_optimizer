# Smart Energy Optimizer

Plateforme d'optimisation énergétique : collecte des mesures de consommation
de sept sites, détection d'anomalies, prévision des pics et recommandations.

Projet EADL — promotion READL006, groupe G4 Rennes.

## Prérequis

- Python 3.12
- Node 22 (version fixée dans `app/front/.nvmrc` ; `nvm use` la sélectionne)
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
    db/
      init/        Scripts joués une seule fois, à la création du volume
      migrations/  Schéma, numérotées et rejouables
      seeds/       Jeux de données de développement, lancés à la main
    infra/    Infrastructure (Terraform, Data Factory)
    docs/     Documentation du projet

`app/back`, `app/front` et `ml` sont déployés séparément. Chaque service
Python a son propre `pyproject.toml` et son propre environnement virtuel.

Les trois dossiers de `db/` ne se ressemblent pas :

- **`init/`** ne tourne qu'à la **création du volume** PostgreSQL, jamais
  ensuite. C'est là que vivent l'application du schéma, la création des
  rôles et les droits.
- **`migrations/`** est le schéma lui-même, en fichiers numérotés. Chacun
  doit pouvoir être rejoué sur une base qui l'a déjà reçu (`IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`) : c'est ce qui permet de rattraper une base
  existante sans l'effacer.
- **`seeds/`** ne s'exécute **jamais tout seul**, ni au démarrage, ni en CI,
  ni au déploiement. Ce sont des jeux de données de développement, à lancer
  à la main quand on en a besoin.

Le détail du schéma est dans `db/README.md`.

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
git config core.hooksPath .githooks
```

Les hooks lancent `scripts/check.sh`, le même script que le job `lint` de la
CI ; aucun Python n'est nécessaire. Détails dans _Vérifications locales_.

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

**Cette étape n'est pas optionnelle.** Sans identifiants, l'API métier
démarre mais ne reçoit rien de la source : elle répond 503, et le dashboard
affiche « API injoignable ».

### 4. Lancer le back et la base d'un coup

```bash
docker compose up -d --build
```

L'API métier est disponible sur http://localhost:8000 et le service ML sur
http://localhost:8001 — rien d'autre à installer.

- http://localhost:8000/health — état du service et de la base
- http://localhost:8000/docs — documentation interactive de l'API métier
- http://localhost:8001/health — état du service ML
- http://localhost:8001/docs — documentation interactive de l'API ML

Le `--build` n'est pas optionnel après un changement de branche ou un
`git pull` : sans lui, Docker réutilise l'image précédente et vous servez
l'ancien code sans vous en apercevoir. En cas de doute, `/docs` montre les
routes réellement servies.

Lancez cette commande depuis le dossier où se trouve le dépôt. Si le dépôt
est dans WSL, lancez-la depuis WSL : un terminal Windows ne verra pas les
mêmes chemins.

**Le dashboard n'est pas dans la stack Docker** : il se lance à part, en
mode développement (étape suivante).

### 5. Lancer le dashboard

Le front a besoin de l'API métier en marche : vérifiez-le avant.

```bash
curl -s localhost:8000/api/consommations | head -c 200
```

Une réponse JSON commençant par `{"data":` signifie que tout est prêt. Un
503 veut dire que l'API métier n'a pas encore de mesure — voyez la section
« En cas de problème ».

**Linux / macOS / WSL**

```bash
cd app/front
nvm use          # Node 22, lu depuis .nvmrc
npm install
npm run dev
```

**Windows (PowerShell)**

```powershell
cd app\front
npm install
npm run dev
```

Le dashboard est disponible sur l'adresse affichée par Vite, en principe
http://localhost:5173.

**Aucun fichier `.env` n'est nécessaire côté front** pour une installation
locale : les valeurs par défaut conviennent. N'en créez un que pour viser
une API métier qui n'est pas sur votre machine.

Le front n'appelle jamais l'API source directement : il passe par l'API
métier, à travers le proxy de développement de Vite. Deux variables le
gouvernent, et les confondre est la cause la plus fréquente d'un dashboard
qui ne reçoit rien :

- **`VITE_API_PROXY_TARGET`** — l'adresse vers laquelle le proxy relaie.
  `http://localhost:8000` par défaut (valeur de repli dans `vite.config.ts`).
- **`VITE_API_URL`** — un préfixe appliqué à chaque appel. **Doit rester
  vide** : les appels partent alors en chemin relatif et passent par le
  proxy. Toute valeur ici court-circuite le proxy et envoie les requêtes
  ailleurs — typiquement sur l'API source, qui ne connaît pas nos routes et
  répond 404.

Vite ne relit `app/front/.env` qu'au démarrage : après l'avoir modifié,
relancez `npm run dev`.

Les étapes suivantes décrivent l'installation du back sans conteneur, utile
pour développer avec le rechargement automatique.

### 6. Lancer la base de données seule

```bash
docker compose up -d db
docker compose ps
```

Attendre que la colonne `STATUS` indique `healthy`.

Au premier démarrage, le conteneur joue les scripts de `db/init` dans
l'ordre : `01_schema.sh` applique les migrations, `02_roles.sh` crée les
rôles `enervision_app` (API métier) et `enervision_ml` (traitements), puis
`03_grants.sql` leur donne leurs droits. Le détail du schéma est dans
`db/README.md`.

**Ces scripts ne tournent qu'à la création du volume.** Sur un volume qui
existe déjà, PostgreSQL les ignore en silence — c'est le comportement
normal de l'image, pas une panne. Une base créée avant l'ajout d'une
migration ou d'un rôle reste donc en arrière :

```bash
sh scripts/apply_schema.sh    # rattrape le schéma sans effacer les données
docker compose down -v        # ou repart de zéro (efface tout)
```

PostgreSQL écoute sur le port **5433** de la machine (et non 5432, pour
éviter les conflits avec une instance déjà installée).

#### Voir des prévisions à l'écran

Les prévisions de la table `predictions` sont écrites par le service ML
(`ml/scripts/predict.py`, lancé par `.github/workflows/predict.yml`). Sur un
poste de développement, cette table est le plus souvent vide, et le
dashboard n'affiche alors aucune courbe de prévision. `db/seeds` pose un jeu
de développement :

```bash
docker compose exec -T db psql -U enervision -d enervision < db/seeds/dev_forecasts.sql
```

Ce fichier ne s'exécute **jamais** automatiquement : ni au démarrage, ni en
CI, ni au déploiement. Il se rejoue autant de fois qu'on veut, et son
horizon part de l'heure où on l'applique — un jeu posé hier ne couvre plus
grand chose aujourd'hui. Les prévisions qu'il écrit portent
`model_version = 'dev'`, ce qui les distingue de celles du service ML.

### 7. Lancer l'application métier

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

Le `-e` de `pip install` n'est pas optionnel : sans lui, Python importe une
copie figée du code et aucune de vos modifications n'atteint le serveur,
même avec `--reload`.

**Un seul back à la fois.** Si la stack Docker tourne déjà, arrêtez-la
(`docker compose stop back`) avant de lancer uvicorn : les deux occupent le
port 8000, et celui qui répond n'est pas forcément celui que vous croyez.

L'application est disponible sur http://127.0.0.1:8000

Réponse attendue sur `/health` :

```json
{ "status": "ok", "database": "ok" }
```

Si `database` vaut `indisponible`, vérifier que le conteneur tourne
(`docker compose ps`) et que `DATABASE_URL` dans `app/back/.env` pointe
bien sur le port 5433. Un volume créé avant l'ajout du schéma n'a pas le
rôle `enervision_app` : lancer `sh scripts/apply_schema.sh`.

L'adresse de la base diffère selon le mode de lancement : `db:5432` depuis
un conteneur, `localhost:5433` depuis la machine.

### 8. Lancer le service de prédiction

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

### Tests Python

Les tests Python se lancent projet par projet, comme les jobs `tests-back` et
`tests-ml` de la CI, environnement virtuel activé avec les dépendances dev :

```bash
cd app/back && pytest --cov    # back, seuil de couverture : 80 %
cd ml && pytest --cov          # service ML, seuil de couverture : 80 %
```

Depuis la racine, `pytest` lance les deux suites d'un coup (`pytest --cov` :
même seuil de 80 %).

Rappel de l'activation : `source .venv/bin/activate` sous Linux, macOS et
WSL, `.venv\Scripts\Activate.ps1` sous PowerShell. L'invite doit afficher
`(.venv)`.

#### Tests qui ont besoin de la base

Les tests marqués `@pytest.mark.db` interrogent une vraie base PostgreSQL.
Sans base joignable, ils sont **ignorés** (`SKIPPED`) : le reste de la suite
tourne quand même. Pour les exécuter, lancez la base (`docker compose up -d
db`) avant `pytest`, avec `DATABASE_URL` renseigné : dans `app/back/.env`
(lancer alors `pytest` depuis `app/back`) ou dans l'environnement. Le code ne
contient aucun identifiant par défaut.

Le test de schéma applique `db/migrations` si les tables manquent. Il faut
alors être connecté avec le super-utilisateur `enervision`. Avec le rôle
applicatif, le schéma doit déjà avoir été créé au démarrage du conteneur.

En CI, `REQUIRE_DB=1` est défini : une base absente fait alors **échouer**
ces tests au lieu de les ignorer.

#### Couverture

Chaque projet fixe son périmètre et son seuil dans son `pyproject.toml`
(`[tool.coverage.*]`) : le paquet `smart_energy_app` pour le back,
`smart_energy_ml` pour le service ML, 80 % minimum. En dessous, `pytest --cov`
échoue, en local comme en CI. Le rapport HTML est écrit dans `htmlcov/`, et la
CI affiche le tableau de couverture dans le résumé de chaque run.

### Tests du front

Tests unitaires [Vitest](https://vitest.dev/), dans `app/front/src/tests/`,
en miroir de l'arborescence du code. Aucun appel réseau réel : le module
`api/client` est simulé. Node 22, la version utilisée par la CI, est fixée
dans `app/front/.nvmrc` (`nvm use` la sélectionne).

```bash
cd app/front
npm test                  # une exécution complète
npm run test:coverage     # avec la couverture ; rapport HTML dans coverage/
```

Les scripts fixent `TZ=Europe/Paris`. Ce n'est pas décoratif : les fonctions
de formatage convertissent en heure locale, donc sans fuseau fixé les tests
passeraient sur une machine française et échoueraient en CI, qui tourne en
UTC. Le job `tests-front` fixe aussi `TZ` dans son environnement.

Les seuils de couverture sont dans `app/front/vitest.config.ts`. Le
périmètre couvre tout `src/`, fichiers non testés compris, à l'exception du
point d'entrée, des types et des données de démonstration. Le job CI affiche
le tableau dans le résumé du run et publie le rapport HTML (artefact
`front-coverage`). `npm run build` vérifie aussi les types des fichiers de
test.

### Test de charge

`tests/perf/load.js` est un scénario [k6](https://grafana.com/docs/k6/) :
10 utilisateurs virtuels pendant 30 secondes appellent `/health` du back et
du service ML, et la route métier `/api/consommations` que le dashboard
interroge toutes les 10 secondes. Il échoue si :

| Seuil                                    | Valeur   |
| ---------------------------------------- | -------- |
| Temps de réponse p95, toutes routes      | < 500 ms |
| Temps de réponse p95, route métier seule | < 500 ms |
| Requêtes en erreur                       | < 1 %    |
| Vérifications réussies                   | > 99 %   |

La route métier a son propre seuil : des `/health` rapides ne peuvent pas
masquer une route métier lente. Ses vérifications portent aussi sur le
contenu : sites relayés et données à jour (`stale: false`).

**Doublure de l'API EnerVision.** En CI, le back ne contacte pas l'API
réelle : elle exige des identifiants et ne doit pas encaisser le trafic d'un
test de charge. `docker-compose.ci.yml` ajoute un service `enervision-mock`
(nginx) qui sert une réponse d'exemple de `/api/v1/stats/summary`
(`tests/perf/enervision-mock/summary.json` : même format que l'API réelle,
valeurs fictives). Le back démarre une fois la doublure prête, et le job
attend que la route métier ait des données avant de lancer k6.

**Rejouer le job `perf` en local**, avec la même stack que la CI (doublure
comprise) et des images construites sur le poste. Arrêtez d'abord la stack de
développement : les noms de conteneurs sont fixes. `-p enervision-ci` sépare
la base de ce test de votre base de développement.

```bash
export BACK_IMAGE=enervision-back:local ML_IMAGE=enervision-ml:local
docker compose -p enervision-ci -f docker-compose.yml -f docker-compose.ci.yml up -d --build
docker run --rm --network enervision-ci_default -e BACK_URL=http://back:8000 -e ML_URL=http://ml:8000 -v "$PWD/tests/perf:/scripts:ro" grafana/k6:2.3.0 run /scripts/load.js
docker compose -p enervision-ci -f docker-compose.yml -f docker-compose.ci.yml down -v
```

Sous PowerShell, remplacez la première ligne par
`$env:BACK_IMAGE = "enervision-back:local"; $env:ML_IMAGE = "enervision-ml:local"`
et `$PWD` par `${PWD}`. k6 rejoint le réseau de la stack : la commande
fonctionne à l'identique sous Linux, macOS et Windows.

## Qualité de code

Configuration ruff : ligne à 100 caractères, cible Python 3.12 (sections
`[tool.ruff]` des `pyproject.toml`).

Côté front, `npx tsc --noEmit` vérifie les types. **Vitest ne les vérifie
pas** : il transpile sans contrôler, donc un code mal typé passe tous les
tests en local et fait échouer la CI, qui lance `npm run build`. C'est
arrivé avec `findLast` et `findLastIndex`, qui existent à l'exécution mais
dépassent la cible ES2022 du projet.

`tsc` lui-même n'attrape **ni** les chaînes de caractères **ni** les accès
hors bornes de tableau : les deux ont déjà causé des bugs. Voir
`docs/conventions-front.md`.

### Vérifications locales (hooks Git)

Les hooks bloquent un commit ou un push qui ferait échouer le job `lint` de
la CI. Ils lancent `scripts/check.sh`, **le même script que la CI** : ce qui
passe en local passe sur la pull request.

**Aucun Python n'est nécessaire.** Au premier lancement, le script télécharge
ruff en binaire autonome, à la version épinglée dans `pyproject.toml`, vérifie
son empreinte SHA-256 et le range dans `.tools/` (ignoré par Git).

| Moment              | Contrôles                                                                                                                                                                    | Effet                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Avant chaque commit | sur les fichiers indexés : `ruff check`, formatage ruff, espaces en fin de ligne, lignes vides en fin de fichier, marqueurs de conflit, saut de ligne final, fichiers > 1 Mo | bloque le commit ; corrige automatiquement ce que ruff sait corriger |
| Avant chaque push   | les mêmes contrôles, sur chaque commit poussé                                                                                                                                | bloque le push (rattrape un `git commit --no-verify`)                |

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

Les tests (`pytest`, Vitest) ne font pas partie des hooks : ils demandent
Python, une base PostgreSQL ou les dépendances npm. La CI les exécute sur
chaque pull request ; la section « Tests » explique comment les lancer en
local.

## Intégration continue

La référence complète du pipeline (CI, déploiement, prédiction, secrets,
dépannage) est dans [`docs/pipeline-ci.md`](docs/pipeline-ci.md).

Le workflow `.github/workflows/ci.yml` tourne sur chaque pull request, à chaque
merge dans `main` et à la demande (*Run workflow*). Le job `changes` regarde
les fichiers modifiés et ne lance que ce qui les concerne ; `lint` et `scan`
tournent toujours. Chaque job de tests affiche sa couverture dans le résumé du
run :

| Job | Rôle |
|---|---|
| `lint` | `sh scripts/check.sh`, les mêmes contrôles que les hooks locaux. Toujours lancé |
| `scan` | Trivy sur le dépôt : dépendances, mauvaises configurations, secrets. Toujours lancé |
| `changes` | Détecte les fichiers modifiés (`dorny/paths-filter`) et la configuration Sonar, puis décide quels jobs lancer |
| `tests-back` | Si `app/back/`, `db/` ou `pyproject.toml` changent : `pytest` du back contre un service PostgreSQL 16 (`REQUIRE_DB=1`), couverture ≥ 80 % (artefact `back-coverage`) |
| `tests-ml` | Si `ml/` (code, tests, scripts, `pyproject.toml`, `Dockerfile`) ou `pyproject.toml` changent : `pytest` du service ML, couverture ≥ 80 % (artefact `ml-coverage`) |
| `tests-front` | Si `app/front/` change : Node 22 et `TZ=Europe/Paris`, `npm ci`, contrôle des types et build de production, tests Vitest, seuils de couverture de `vitest.config.ts` (artefact `front-coverage`) |
| `sonar-back`, `sonar-ml`, `sonar-front` | Analyse SonarQube du composant dont les tests viennent de tourner, avec leur couverture ; échoue si le _quality gate_ est rouge (voir ci-dessous) |
| `build` | Si du code déployable ou l'environnement de test change : construit les images `back`, `ml`, `mlflow`, `front` et `ml-predict`, les scanne avec Trivy |
| `perf` | Lance la stack avec ces images et une doublure de l'API EnerVision, puis exécute le test de charge k6 (`/health` et route métier) |
| `publish` | Sur `main` seulement, après un changement déployable et si tous les autres jobs sont verts (Sonar compris) : publie les cinq images sur GHCR |

**Ce qui lance quoi.** Les tests d'un composant sont _ignorés_ quand aucun de
ses fichiers n'a changé : un job ignoré ne fait pas échouer la CI. Un test en
échec fait en revanche toujours échouer son job et empêche `build`. Modifier
`ci.yml` ou `sonar-project.properties` lance **tous** les jobs, pour qu'un
changement de CI soit toujours testé ; un lancement manuel aussi (sauf
`publish`, réservé aux merges dans `main`).

Les étapes se suivent : `lint`, `scan` et les tests lancés → `build` → `perf`
→ `publish`, qui attend aussi les analyses Sonar. Une image n'est donc publiée
qu'après avoir passé tous les contrôles du commit : un jeu d'images publié est
toujours une version validée (voir _Déploiement_ plus bas). Un commit de `main`
qui ne change rien de déployable (documentation, tests ML, scripts) ne publie
aucune image.

Un nouveau push sur une pull request annule l'exécution précédente de cette
pull request ; les exécutions sur `main` ne sont jamais annulées.

**Si vous ajoutez un job qui dépend de `build`, `perf` ou `publish`**, écrivez
sa condition avec `!cancelled()` et le résultat du job requis
(`needs.build.result == 'success'`). Un job qui en suit un autre, lui-même
ignoré, est ignoré à son tour, même si la chaîne a tourné entre-temps : c'est
ce qui aurait empêché `perf` et `publish` de tourner sans cette précaution.

Les scans échouent sur toute vulnérabilité HIGH ou CRITICAL ; pour les
images, seules celles qui ont un correctif disponible sont bloquantes.

Rapports publiés en artefacts sur chaque run (onglet _Actions_ → run →
_Artifacts_) : `back-coverage` et `ml-coverage` (HTML + XML),
`front-coverage` (HTML) et `k6-results` (résumé JSON du test de charge).

Les images publiées sont étiquetées avec le SHA de leur commit, sans `latest` :

    ghcr.io/eadl-projet-piscine/smart_energy_optimizer/back
    ghcr.io/eadl-projet-piscine/smart_energy_optimizer/ml
    ghcr.io/eadl-projet-piscine/smart_energy_optimizer/mlflow
    ghcr.io/eadl-projet-piscine/smart_energy_optimizer/front
    ghcr.io/eadl-projet-piscine/smart_energy_optimizer/ml-predict

`main` est protégée : pull request et relecture obligatoires. La règle
n'exige pas encore une CI verte : **ne mergez pas une pull request dont la CI
est rouge.**

**Après un merge de `main` dans votre branche**, relancez les deux suites de
tests avant de pousser, et `npx tsc --noEmit` côté front : une résolution de
conflit peut ramener du code qui contredit vos modifications, sans qu'aucun
marqueur n'apparaisse dans le fichier.

**Testez sur une base neuve avant de toucher à `db/`.** Votre base locale
porte un historique que le runner n'a pas : une migration qui marche chez
vous peut échouer sur une base vide. `docker compose down -v && docker
compose up -d --build` est la seule vérification qui le montre.

### SonarQube

Trois jobs analysent chacun un composant, dans son propre projet SonarQube :
`sonar-back` (`app/back/src`), `sonar-ml` (`ml/src`) et `sonar-front`
(`app/front/src`). Un composant n'est analysé que lorsque ses fichiers
changent. Le périmètre et les exclusions sont dans `sonar-project.properties`
et dans les arguments de chaque job. Ces jobs ne bloquent ni `build` ni
`perf`, mais `publish` les attend : un commit dont l'analyse échoue (_quality
gate_ rouge ou panne de Sonar) n'est ni publié ni déployé.

**`infra/` n'est plus analysé par Sonar** : les inclusions de chaque job se
limitent au code source de son composant. Le Terraform reste contrôlé par
Trivy (job `scan`, mauvaises configurations).

**Activation, une seule fois** (par un administrateur du dépôt) :

1. Sur [SonarQube Cloud](https://sonarcloud.io), créer trois projets, un par
   composant, dans l'organisation du dépôt, et noter leurs clés. Pour un
   SonarQube Server auto-hébergé, les créer à la main.
2. Dans _Settings → Secrets and variables → Actions_ du dépôt GitHub :
   - secret `SONAR_TOKEN` : jeton généré dans Sonar (_My Account → Security_) ;
   - variable `SONAR_ORGANIZATION` : clé de l'organisation ;
   - variables `SONAR_PROJECT_KEY_BACK`, `SONAR_PROJECT_KEY_ML` et
     `SONAR_PROJECT_KEY_FRONT` : clés des trois projets ;
   - variable `SONAR_HOST_URL` : seulement pour un Server (Cloud par défaut).
3. Dans Sonar, désactiver l'« analyse automatique » de chaque projet : elle
   ferait double emploi avec la CI et n'a pas la couverture.

Un composant dont la configuration est incomplète est ignoré, sans faire
échouer la CI : le job `changes` indique dans le run (message _notice_) ce qui
manque. C'est aussi le cas des pull requests venues d'un fork, qui n'ont accès
à aucun secret.

**Couverture.** Sonar lit `coverage.xml` (back, ML) et `lcov.info` (front), produits
par les jobs `tests-*`. Leurs chemins sont relatifs au projet, alors que Sonar
les résout depuis la racine du dépôt : chaque job les préfixe, puis échoue si
l'un d'eux ne correspond à aucun fichier. Sans ce contrôle, Sonar afficherait
0 % de couverture sans le moindre message.

**Quality gate.** Chaque job attend le verdict de Sonar (`sonar.qualitygate.wait`)
et échoue s'il est rouge. Le _quality gate_ par défaut (« Sonar way », réglable
dans Sonar) porte sur le **nouveau code** : couverture, duplication et nouveaux
bugs ou failles. Pour ne pas bloquer, retirer cet argument dans `ci.yml` :
l'analyse reste publiée et commentée sur la pull request.

### Déploiement

Le workflow `.github/workflows/deploy.yml` déploie sur la VM Azure (runner
auto-hébergé) après chaque run réussi de la CI sur `main`, ou à la demande
(_Run workflow_, depuis `main` uniquement). Le job `resolve` choisit la
version, le job `deploy` l'installe avec `docker compose` et les images de
GHCR.

**La version déployée est la plus récente de `main` dont les quatre images sont
publiées**, pas forcément le commit qui a déclenché le run : `resolve` remonte
les 50 derniers commits de `main` (les merges, pas les commits des branches
mergées). Une image n'étant publiée qu'après tous les contrôles, c'est la
dernière version validée. Ainsi :

- relancer un ancien run de la CI, ou deux runs de `main` qui se terminent
  dans le désordre, ne remettent jamais une ancienne version en production ;
- un commit sans changement déployable ne redéploie rien : si la version
  choisie tourne déjà, le run l'indique (message _notice_) et s'arrête là ;
- un lancement manuel redéploie la dernière version validée, même si elle
  tourne déjà (par exemple après une modification du `.env` de la VM) ; il
  échoue si aucune version n'est disponible.

Seuls les runs qui déploient apparaissent dans l'environnement GitHub
`production`.

**HTTPS.** En production, seul le conteneur `proxy` (Caddy,
`deploy/Caddyfile`) est joignable depuis Internet, sur les ports 443 et 80. Il
obtient et renouvelle seul le certificat Let's Encrypt du nom DNS de la VM, et
redirige le HTTP vers le HTTPS. Le front, l'API, le service ML et la base ne
publient plus aucun port : ils ne se parlent que par le réseau Docker, et
MLflow reste limité à `127.0.0.1`.

**Mise en service** (une fois, avec l'accès à l'abonnement et à la VM) :

1. `terraform apply` dans `infra/` : nom DNS de l'IP publique et ouverture des
   ports 80 et 443. `terraform output -raw fqdn` donne l'adresse du site.
2. Dans `~/enervision/.env` sur la VM : `SITE_DOMAIN=<le fqdn>`.
3. Dans `~/enervision/back.env` : `AUTH_ENABLED=true` et
   `JWT_SECRET=<openssl rand -hex 32>`.
4. Lancer le déploiement (_Run workflow_). Au premier démarrage, Caddy demande
   le certificat ; le site répond alors sur `https://<le fqdn>`.
5. Créer le premier administrateur, mot de passe saisi au clavier :

       docker exec -it enervision-back python -m smart_energy_app.auth.create_user \
         --email admin@example.com --name "Administrateur" --role admin

   Les autres comptes se créent ensuite depuis l'écran « Comptes ».

**Contrôle après déploiement.** Après chaque déploiement, le job `verify` de
`deploy.yml` vérifie le site depuis un runner GitHub, donc depuis Internet :
HTTPS avec un certificat valide, redirection du HTTP, en-têtes de sécurité du
`Caddyfile`, réponse 401 de l'API sans session, ports 22, 5000, 5432 et 8000
fermés. Le déploiement échoue au moindre écart. Le même contrôle se lance à la
main : `deploy/smoke_test.sh <le fqdn>`.

## Configuration

Les paramètres sont lus depuis les variables d'environnement, ou depuis le
fichier `.env` du service. Ne jamais versionner un `.env` : il est ignoré
par Git. Le fichier `.env.example` sert de modèle.

### API métier (`app/back/.env`)

| Variable                  | Rôle                                                              | Défaut                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ENERVISION_API_URL`      | URL de l'API source                                               | `https://api-mock.charlieandre.fr`                                                                                       |
| `ENERVISION_TIMEOUT_S`    | Délai d'attente des appels API, en secondes                       | `10`                                                                                                                     |
| `ENERVISION_USER`         | Identifiant HTTP Basic de l'API source                            | vide                                                                                                                     |
| `ENERVISION_PASSWORD`     | Mot de passe HTTP Basic de l'API source                           | vide                                                                                                                     |
| `DATABASE_URL`            | Connexion PostgreSQL, identifiants compris                        | `postgresql+psycopg://localhost:5433/enervision` : **sans identifiants**, à renseigner dans `.env` (voir `.env.example`) |
| `CONSUMPTION_REFRESH_S`   | Intervalle de rafraîchissement de la mesure courante, en secondes | `60`                                                                                                                     |
| `CONSUMPTION_STALENESS_S` | Âge à partir duquel une mesure est signalée périmée, en secondes  | `120`                                                                                                                    |
| `HISTORY_HOURS`           | Profondeur de l'historique renvoyé, en heures                     | `24`                                                                                                                     |
| `HISTORY_SITE_COUNT`      | Nombre de sites du parc, qui fixe le pas d'échantillonnage        | `7`                                                                                                                      |
| `HISTORY_MARGIN_S`        | Marge sur l'heure courante, pour l'écart d'horloge avec la source | `300`                                                                                                                    |
| `FORECAST_HOURS`          | Profondeur des prévisions renvoyées, en heures                    | `24`                                                                                                                     |
| `ALERT_CRITICAL_PCT`      | Charge à partir de laquelle une alerte critique est levée, en %   | `100`                                                                                                                    |
| `ALERT_MEDIUM_PCT`        | Charge à partir de laquelle une alerte moyenne est levée, en %    | `90`                                                                                                                     |
| `ALERT_CLEAR_PCT`         | Charge sous laquelle une alerte s'éteint, en %                    | `85`                                                                                                                     |
| `AUTH_ENABLED`            | Active l'authentification : sans session valide, les routes `/api` répondent 401 | `false` : routes ouvertes                                                                                                |
| `JWT_SECRET`              | Clé de signature des jetons, 32 caractères au moins (`openssl rand -hex 32`) | vide : **obligatoire** quand `AUTH_ENABLED=true`, sinon l'API refuse de démarrer                                         |
| `JWT_TTL_MINUTES`         | Durée de vie du jeton de session, en minutes                      | `15`                                                                                                                     |
| `AUTH_COOKIE_SECURE`      | Cookie de session réservé au HTTPS (et à `localhost`)             | `true` : ne désactiver que pour un serveur en HTTP                                                                       |

Les trois seuils d'alerte vont par paire : celui d'extinction est
volontairement plus bas que celui de levée. Avec un seuil unique, un site
qui oscille autour de 90 % ferait clignoter son alerte à chaque cycle. Le
détail de la règle est dans `docs/conventions-back.md`.

`FORECAST_HOURS` ne peut pas dépasser **24** : la table `predictions`
n'accepte pas d'horizon au-delà, et une valeur plus grande ne ferait
qu'élargir une fenêtre vide. Le dashboard affiche ce que l'API lui donne,
sans fenêtre à lui.

### Authentification de l'API

Activée par `AUTH_ENABLED=true` (désactivée par défaut, tant que le dashboard
ne sait pas se connecter). Elle répond au constat C1 de l'audit de sécurité.

- **Connexion** : `POST /api/auth/login` avec `{"email", "password"}`. Le mot
  de passe est vérifié contre son condensé argon2 (table `users`) ; en retour,
  un jeton JWT signé de 15 minutes est posé dans le cookie
  `enervision_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, limité à
  `/api`). Le dashboard n'a donc jamais le jeton en main. `POST
  /api/auth/logout` efface le cookie ; `GET /api/auth/me` décrit la session.
- **Routes protégées** : toutes les routes `/api` répondent **401** sans
  session valide (cookie absent, expiré ou falsifié). `/health` et la
  documentation (`/docs`) restent ouvertes.
- **Rôles et sites** : `admin` et `operator` voient tout le parc ; `viewer` ne
  voit que les sites dont il est le client (`sites.client_user_id`). Les
  listes et les totaux sont filtrés, et un autre site répond **403**, qu'il
  existe ou non. Les rôles et les sites sont figés dans le jeton : un
  changement de droits prend effet à la connexion suivante, au plus tard
  15 minutes après.
- **Comptes** : pas d'inscription en ligne. Un administrateur les crée en
  ligne de commande ; le mot de passe (12 caractères au moins) est demandé au
  clavier :

      docker compose exec back python -m smart_energy_app.auth.create_user \
        --email ada@example.com --name "Ada Lovelace" --role viewer \
        --site SITE001 --site SITE003

- **Gestion des comptes** : une fois le premier administrateur créé par cette
  commande, les autres comptes se gèrent depuis l'écran « Comptes » du
  dashboard (bouton dans l'en-tête, administrateurs seulement), ou par
  `GET`, `POST` et `PATCH /api/comptes` : création, nom, activation, rôle,
  sites d'un lecteur et nouveau mot de passe. Rattacher un site à un client
  le retire à son client précédent. Ces routes répondent 403 à un autre rôle,
  et tant que `AUTH_ENABLED=false`. Un administrateur ne peut ni désactiver
  son propre compte ni s'enlever le rôle `admin`. Chaque action est
  journalisée avec son auteur, jamais avec un mot de passe.

Les tests `tests/auth/` vérifient à chaque pull request les 401 de chaque route,
les 403 hors périmètre, le filtrage des réponses et la connexion sur une vraie
base. **Production** : `AUTH_ENABLED` et `JWT_SECRET` vont dans le `back.env`
de la VM, et le cookie `Secure` exige le HTTPS de Caddy (voir _Déploiement_,
« Mise en service »). Ne pas contourner avec `AUTH_COOKIE_SECURE=false` : la
session circulerait en clair.

### Dashboard (`app/front/.env`)

Ce fichier est **optionnel** : sans lui, les valeurs par défaut conviennent
à une installation locale.

| Variable                | Rôle                                                                                                                                                                                    | Défaut                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `VITE_API_PROXY_TARGET` | Adresse de l'API métier vers laquelle le proxy de développement relaie                                                                                                                  | `http://localhost:8000` |
| `VITE_API_URL`          | Préfixe appliqué aux appels de l'API métier. **Laisser vide** : les appels partent alors en chemin relatif et passent par le proxy ci-dessus. Toute valeur ici court-circuite le proxy. | vide                    |

Les deux servent à joindre l'API métier, mais pas au même endroit :
`VITE_API_PROXY_TARGET` est lue par `vite.config.ts` et ne concerne que le
serveur de développement ; `VITE_API_URL` est lue par `src/api/client.ts` et
préfixe chaque requête du navigateur. Renseigner la seconde fait sortir les
appels du proxy, et donc échouer tout ce qui dépend de lui.

Vite ne lit ce fichier qu'au démarrage : relancez `npm run dev` après
l'avoir modifié.

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
L'ouvrir et attendre l'état _Engine running_.

**`port is already allocated`** — le port 8000 ou 5433 est déjà utilisé sur
votre machine. Arrêtez le programme qui l'occupe, ou changez le port dans
`docker-compose.yml`.

**L'API répond `"database": "indisponible"`** — la base n'est pas joignable.
Vérifiez `docker compose ps`, puis `docker compose logs db`.

**`password authentication failed for user "enervision_app"`** — le rôle
n'existe pas, ou n'a pas ce mot de passe. La cause est presque toujours la
même : un volume PostgreSQL créé **avant** que les scripts de `db/init`
n'existent ou ne changent. Ils ne rejouent jamais sur un volume existant,
donc le rôle est resté tel qu'il était — ou n'a jamais été créé.

Pour le confirmer, cherchez la trace de l'initialisation dans les logs :

```bash
docker compose logs db | grep initdb
```

```powershell
docker compose logs db | Select-String "initdb"
```

Aucune ligne : les scripts n'ont pas tourné sur ce volume. Deux sorties,
selon que vous tenez à vos données :

```bash
docker compose down -v && docker compose up -d       # repart de zéro
sh scripts/apply_schema.sh                           # rattrape sans effacer
```

**Les logs affichent `l'API a répondu 401`** — les identifiants de l'API
source manquent ou sont faux. Trois causes, dans l'ordre :

1. `ENERVISION_USER` ou `ENERVISION_PASSWORD` est absent de `app/back/.env`.
2. Le fichier existe, mais **le conteneur ne le lit pas**. Le service `back`
   de `docker-compose.yml` doit porter `env_file: [app/back/.env]` : sans
   cette ligne, le conteneur démarre sans identifiants et toutes les
   requêtes à la source reviennent en 401. Pour vérifier ce qu'il voit
   réellement, sans afficher les valeurs :

   ```bash
   docker compose exec back env | grep -o '^ENERVISION_[A-Z_]*'
   ```

   Les deux variables doivent y figurer.
3. L'application tourne sur une version antérieure du fichier : il n'est lu
   qu'au démarrage. Relancez-la.

**`/api/consommations` répond 503** — aucune mesure n'a encore été
récupérée. Regardez les logs de l'application : le rafraîchissement tourne
toutes les minutes et journalise chaque tentative.

**Le dashboard reçoit un 404 sur `/api/consommations`** — ses requêtes
n'arrivent pas à notre API métier. Trois causes, de la plus fréquente à la
plus rare :

1. `VITE_API_URL` est renseignée dans `app/front/.env`. Elle doit être
   **vide**, sinon les appels sortent du proxy et partent vers une adresse
   qui ne connaît pas nos routes.
2. `VITE_API_PROXY_TARGET` ne pointe pas sur votre API métier. Attendu :
   `http://localhost:8000`.
3. Le back tourne sur du code ancien. Ouvrez `http://localhost:8000/docs` :
   si les routes affichées ne sont pas celles de votre branche, relancez
   avec `docker compose up -d --build`, ou vérifiez qu'un uvicorn oublié
   n'occupe pas le port (`ss -ltnp | grep 8000`, ou
   `Get-NetTCPConnection -LocalPort 8000` sous PowerShell).

Swagger garde sa spécification en mémoire : fermez l'onglet `/docs` et
rouvrez-le, un simple rafraîchissement ne suffit pas toujours.

**Le dashboard affiche « API injoignable »** — le front ne reçoit rien de
l'API métier. Dans l'ordre :

1. l'API métier répond-elle ? `curl -s localhost:8000/health`
2. a-t-elle des mesures ? `curl -s localhost:8000/api/consommations | head -c 200` — un 503 renvoie aux deux entrées précédentes, le plus souvent un `.env` absent ou sans identifiants
3. la configuration du front est-elle bonne ? Dans `app/front/.env`,
   `VITE_API_URL` doit être vide et `VITE_API_PROXY_TARGET` valoir
   `http://localhost:8000`. Puis relancer `npm run dev`.

Le dashboard n'affiche jamais de données inventées : s'il dit que l'API est
injoignable, c'est qu'elle l'est.

**Aucune courbe de prévision sur le graphique** — la table `predictions` est
vide, ou ne contient plus rien à venir. Vérifiez ce qu'elle a en stock :

```bash
docker compose exec -T db psql -U enervision -d enervision \
  -c "SELECT count(*), min(period_start), max(period_start) FROM predictions WHERE period_start >= now();"
```

Un compte à zéro renvoie à la section « Voir des prévisions à l'écran » :
posez le jeu de développement. Si le compte est bon mais que rien ne
s'affiche, regardez `curl -s localhost:8000/api/previsions | head -c 200` :
une réponse vide pointe vers le back, une réponse pleine vers le front. Un
**401** veut dire autre chose : `AUTH_ENABLED=true` et ce `curl` n'a pas de
session — ce n'est pas un problème de prévisions.

**Le dashboard fait deux appels réseau au lieu d'un** — c'est le mode strict
de React, en développement uniquement. Pour le vérifier : `npm run build &&
npm run preview`, un seul appel.

**Les heures affichées ont deux heures de décalage** — l'API source date
`/stats/summary` sans fuseau alors qu'il s'agit d'UTC. `toIsoUtc()` dans
`services/format.ts` le corrige ; si vous ajoutez un champ horodaté, pensez
à le faire passer par cette fonction.

**`Could not resolve host: github.com` dans WSL** — la résolution de noms
est tombée, pas le réseau : `ping -c1 8.8.8.8` passe encore. Depuis
PowerShell — pas depuis Ubuntu, où la commande n'existe pas —
`wsl --shutdown`, puis rouvrir le terminal. Si cela ne suffit pas,
`systemd-resolved` n'a plus de serveur en amont :

```bash
sudo rm -f /etc/resolv.conf
printf 'nameserver 8.8.8.8\nnameserver 1.1.1.1\n' | sudo tee /etc/resolv.conf
printf '[network]\ngenerateResolvConf = false\n' | sudo tee /etc/wsl.conf
```

La dernière ligne évite que WSL réécrase le fichier au prochain démarrage.

**`npm run dev` échoue sur la version de Node** — `nvm use` depuis
`app/front` sélectionne Node 22, la version fixée dans `.nvmrc` et utilisée
par la CI.

**`pytest : command not found` alors que `(.venv)` s'affiche** — les
dépendances de développement ne sont pas installées dans cet environnement :
`pip install -e "./app/back[dev]"` depuis la racine.

## Conventions

L'organisation du back-end est décrite dans `docs/conventions-back.md`, à
lire avant d'écrire du code dans `app/back`. Elle contient aussi une section
sur les pièges de l'API source, établis par la mesure.

Celle du front est dans `docs/conventions-front.md`, à lire avant d'écrire
du code dans `app/front`.

### Branches

Une branche par ticket, nommée d'après le groupe, les initiales et le
numéro du ticket :

    EADL_2025_RENNES_G4/lf_80

Renommer une branche déjà poussée coûte une suppression de la branche
distante et une nouvelle pull request : autant la nommer juste du premier
coup.

À compléter avec l'équipe : format des messages de commit, processus de
revue.

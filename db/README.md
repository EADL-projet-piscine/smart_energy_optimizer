# Base PostgreSQL EnerVision

Base applicative du MVP : sites, comptes, mesure courante et prévisions.
Les historiques de `/api/v1/readings` ne sont pas stockés : la source les
régénère à chaque appel, ils ne sont pas exploitables.

PostgreSQL 16. Le conteneur `db` de `docker-compose.yml` crée la base
`enervision` au premier démarrage, puis applique `db/init` :

1. `01_schema.sh` exécute `db/migrations/*.sql` dans l'ordre des noms.
2. `02_roles.sh` crée les rôles de connexion. Les mots de passe viennent des
   variables `APP_DB_PASSWORD` et `ML_DB_PASSWORD`.
3. `03_grants.sql` accorde les droits.

Un volume déjà créé avant ce schéma ne relance pas ces scripts. Depuis la
racine du dépôt :

```bash
sh scripts/apply_schema.sh
```

Sous PowerShell, les trois commandes équivalentes :

```powershell
docker compose exec -T db sh /docker-entrypoint-initdb.d/01_schema.sh
docker compose exec -T db sh /docker-entrypoint-initdb.d/02_roles.sh
docker compose exec -T db psql -v ON_ERROR_STOP=1 --username enervision --dbname enervision -f /docker-entrypoint-initdb.d/03_grants.sql
```

## Connexions

Les identifiants ne sont pas dans le schéma. Ils viennent de l'environnement,
et les fichiers `.env` ne sont pas versionnés. Les valeurs de
`docker-compose.yml` ne valent que pour le poste de développement.

| Rôle | Usage | Variable du mot de passe | URL locale (hôte) |
|---|---|---|---|
| `enervision` | Administration et migrations. Seul ce rôle crée les tables. | `POSTGRES_PASSWORD` | `postgresql://enervision:enervision@localhost:5433/enervision` |
| `enervision_app` | API métier : lecture et écriture de tout le schéma. | `APP_DB_PASSWORD` | `postgresql+psycopg://enervision_app:enervision_app@localhost:5433/enervision` |
| `enervision_ml` | Traitements et service ML. | `ML_DB_PASSWORD` | `postgresql+psycopg://enervision_ml:enervision_ml@localhost:5433/enervision` |

Depuis un conteneur, l'hôte est `db` et le port `5432`.

`enervision_ml` peut lire et mettre à jour `sites`, `current` et
`predictions`. Il ne peut ni les supprimer, ni lire `users`, `roles` ou
`role_user`. Une table ajoutée plus tard ne lui est pas ouverte toute seule :
le droit se déclare dans `03_grants.sql`.

L'API métier prend `DATABASE_URL` (rôle `enervision_app`). Le service ML
reçoit la même variable avec le rôle `enervision_ml` ; il ne s'y connecte
pas encore, le rôle est prêt pour l'ingestion et les prévisions.

Vérifier les deux accès, en forçant le mot de passe (connexion TCP) :

```bash
docker compose exec -e PGPASSWORD="$APP_DB_PASSWORD" db \
  psql -h 127.0.0.1 -U enervision_app -d enervision -c '\dt'

docker compose exec -e PGPASSWORD="$ML_DB_PASSWORD" db \
  psql -h 127.0.0.1 -U enervision_ml -d enervision -c 'SELECT count(*) FROM current;'
```

La seconde commande doit réussir. `SELECT count(*) FROM users` avec le rôle
ML doit être refusé.

## Fréquence de synchronisation

Elle n'est pas en base : elle n'est pas encore arrêtée. L'API métier la lit
dans `CONSUMPTION_REFRESH_S` (secondes, 60 par défaut dans le code, 10 dans
`.env.example`). Changer la variable change la cadence, sans migration.

Chaque synchronisation appelle `upsert_site` puis `upsert_current`. Les deux
fonctions insèrent ou mettent à jour. `upsert_prediction` fait de même pour
une prévision.

## Relations

```mermaid
erDiagram
  users ||--o{ role_user : "reçoit"
  roles ||--o{ role_user : "est attribué"
  users ||--o{ sites : "client"
  sites ||--o| current : "mesure courante"
  sites ||--o{ predictions : "prévisions"
```

Supprimer un site supprime sa mesure courante et ses prévisions. Supprimer
un utilisateur retire ses rôles et détache ses sites, sans les supprimer.
Un rôle encore attribué ne peut pas être supprimé.

## Tables

Les noms de colonnes repris de l'API source sont conservés (`consumption_kw`,
`data_quality`, `site_id`) pour qu'une valeur se suive de bout en bout.
Les horodatages sont en `timestamptz`, stockés en UTC. `/stats/summary`
envoie parfois un horodatage sans fuseau : c'est de l'UTC, à interpréter
comme tel avant l'insertion. Une mesure absente reste `NULL`, jamais zéro.

### `sites`

Référentiel. Une ligne par site de l'API (`SITE001`, …).

| Colonne | Type | Origine |
|---|---|---|
| `site_id` | `text`, clé primaire | `site_id` |
| `site_name` | `text`, obligatoire | `site_name` de `/stats/summary` |
| `site_type` | `text` | `site_type` de `/sites/{id}/current` (office, factory, …). Absent du résumé. |
| `capacity_kw` | `numeric(12,3)` | `capacity_kw` du résumé. `NULL` ou `>= 0`. |
| `client_user_id` | `uuid`, clé vers `users` | Pas dans l'API. Renseigné par l'application. |

`upsert_site` met à jour le nom. Un type ou une capacité à `NULL` ne
remplace pas une valeur déjà enregistrée, parce que les deux endpoints ne
portent pas les mêmes champs. `client_user_id` n'est pas touché par cette
fonction.

### `current`

Table temporaire, une ligne par site. Elle sera remplacée quand le modèle
préparé pour le ML sera défini. Les colonnes couvrent l'union des deux
payloads de mesure courante.

| Colonne | Type | Origine |
|---|---|---|
| `site_id` | `text`, clé primaire et clé vers `sites` | |
| `measured_at` | `timestamptz`, obligatoire | `timestamp` de la source |
| `consumption_kw` | `numeric(12,3)` | `consumption_kw`, ou `current_consumption_kw` du résumé |
| `consumption_kwh` | `numeric(12,3)` | `/current`. La source le rend égal aux kW : ne pas l'utiliser comme une énergie. |
| `voltage_v` | `numeric(8,3)` | `/current` |
| `current_a` | `numeric(10,3)` | `/current` |
| `power_factor` | `numeric(5,3)` | `/current` |
| `temperature_celsius` | `numeric(6,2)` | `/current` |
| `humidity_percent` | `numeric(6,2)` | `/current` |
| `load_percent` | `numeric(6,2)` | résumé |
| `data_quality` | `text` | `good`, `partial`, `degraded`, `critical`. Liste non fermée. |
| `null_reasons` | `text[]` | raisons d'absence, tableau vide par défaut |
| `fetched_at` | `timestamptz` | moment de la synchronisation |

`upsert_current` remplace toute la ligne. `NULL` signifie que la source n'a
pas fourni la grandeur, pas que le champ doit être ignoré. Une écriture faite
depuis le seul résumé efface donc tension, courant et températures de la
ligne précédente : passer la mesure complète, ou accepter cet écrasement.

Le site doit déjà exister, sinon la clé étrangère rejette l'insertion.

### `predictions`

Prévisions produites par le bloc ML.

| Colonne | Type | Rôle |
|---|---|---|
| `id` | `uuid`, clé primaire | |
| `site_id` | `text`, clé vers `sites` | site concerné |
| `predicted_kw` | `numeric(12,3)`, `>= 0` | valeur prédite |
| `period_start` | `timestamptz` | début de la période, inclus |
| `period_end` | `timestamptz` | fin de la période, exclue |
| `model_name` | `text` | nom du modèle, facultatif |
| `model_version` | `text` | version ou identifiant de run. Facultatif tant que le modèle n'est pas versionné. |

Unicité sur `(site_id, period_start, period_end, model_version)`, y compris
quand la version est `NULL` : rappeler `upsert_prediction` pour la même
fenêtre met la valeur à jour au lieu d'empiler un doublon.

Pour une prévision ponctuelle (la puissance dans deux heures, par exemple),
prendre comme période le pas du modèle à partir de l'instant cible.

### `users`, `roles`, `role_user`

Comptes de l'application. Rien de tout cela ne vient de l'API source.

`users.password_hash` refuse moins de 20 caractères, pour écarter un mot de
passe en clair. Le condensé (bcrypt, argon2) est calculé par l'application,
pas par la base.

Rôles initiaux, modifiables : `admin` (Administrateur), `operator`
(Exploitant), `viewer` (Lecteur). Un utilisateur peut en porter plusieurs.
L'e-mail est unique sans tenir compte de la casse.

Exemple, une fois le condensé calculé par l'application :

```sql
INSERT INTO users (email, password_hash, display_name)
VALUES ('ada@example.com', '<condensé>', 'Ada');

INSERT INTO role_user (user_id, role_id)
SELECT users.id, roles.id
FROM users, roles
WHERE users.email = 'ada@example.com' AND roles.code = 'admin';
```

Aucun compte n'est créé par les scripts.

## Migrations

Ajouter un fichier `db/migrations/002_….sql`, jamais modifier une migration
déjà partagée : un volume déjà migré ne la rejoue pas colonne par colonne
(`CREATE TABLE IF NOT EXISTS` ne complète pas une table existante). Les
fonctions, elles, sont en `CREATE OR REPLACE` et sont reprises à chaque
application du script.

Les tests marqués `db` appliquent `001_initial_schema.sql` si les tables
manquent. Il faut alors être connecté avec le super-utilisateur. Avec le
rôle applicatif, le conteneur doit avoir déjà créé le schéma.

Si une table `current_readings` existe déjà, le script en reprend la mesure
la plus récente de chaque site dans `current`, puis la supprime.

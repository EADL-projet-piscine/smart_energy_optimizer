# Documentation API

## 1. Accès

| Élément | Valeur |
|---|---|
| Version | 1.1.0 |
| URL de base | `ENERVISION_API_URL`, par défaut `https://api-mock.charlieandre.fr` |
| Authentification | **Non documentée dans le PDF.** Nos scripts utilisent HTTP Basic avec `ENERVISION_API_USERNAME` / `ENERVISION_API_PASSWORD` |

Les identifiants sont lus dans le fichier `.env` du projet. Ne committez jamais ce fichier.

```
ENERVISION_API_URL=https://api-mock.charlieandre.fr
ENERVISION_API_USERNAME=...
ENERVISION_API_PASSWORD=...
```

---

## 2. Les endpoints

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/health` | Vérifier que le service est opérationnel |
| GET | `/api/v1/sites` | Lister les sites et leurs caractéristiques statiques |
| GET | `/api/v1/sites/{site_id}` | Détail d'un site |
| GET | `/api/v1/sites/{site_id}/current` | Mesure instantanée d'un site |
| GET | `/api/v1/readings` | Historique simulé de mesures |
| GET | `/api/v1/alerts` | Alertes de consommation actives |
| GET | `/api/v1/sensors/status` | État de santé des capteurs, tous sites |
| GET | `/api/v1/stats/summary` | Résumé instantané de tout le parc |
| POST | `/api/v1/simulate/spike/{site_id}` | Déclencher un pic de consommation fictif |

### 2.1 `GET /health`

```json
{ "status": "healthy", "timestamp": "2024-06-15T14:32:00.123456" }
```

Code : `200`.

### 2.2 `GET /api/v1/sites` et `GET /api/v1/sites/{site_id}`

```json
{
  "site_id": "SITE002",
  "site_type": "factory",
  "site_name": "Usine Lyon Vénissieux",
  "location": "Lyon, France",
  "capacity_kw": 1000,
  "status": "active"
}
```

Codes : `200`, et `404` si le site n'existe pas (route avec identifiant).

### 2.3 `GET /api/v1/sites/{site_id}/current`

Mesure à l'instant présent. C'est l'endpoint prévu pour un tableau de bord temps réel. Il renvoie toujours `200`, **même si des champs sont `null`**. Codes : `200`, `404`.

```json
{
  "timestamp": "2026-10-23T12:48:27.758974",
  "site_id": "SITE001",
  "site_type": "office",
  "consumption_kw": 156.25,
  "consumption_kwh": 156.25,
  "voltage_v": 393.9,
  "current_a": 241.06,
  "power_factor": 0.894,
  "temperature_celsius": null,
  "humidity_percent": 41.2,
  "null_reasons": [
    "temperature_sensor_failure"
  ],
  "data_quality": "partial"
}
```

| data_quality | Signification |
|---|---|
| good | Toutes les mesures sont disponibles |
| partial | Un capteur secondaire est en panne |
| degraded | Plusieurs capteurs sont en panne |
| critical | Perte réseau — aucune mesure disponible |

### 2.4 `GET /api/v1/readings`

Historique simulé, trié par `timestamp` croissant.

| Paramètre | Type | Défaut | Description |
|---|---|---|---|
| `site_id` | string | tous les sites | Filtrer par site |
| `start_time` | datetime ISO 8601 | maintenant − 24 h | Début de période |
| `end_time` | datetime ISO 8601 | maintenant | Fin de période |
| `limit` | entier | **100** | Nombre de résultats, de 1 à **1000** |

```json
[
  {
    "timestamp": "2021-10-20T13:09:52.795960Z",
    "site_id": "SITE001",
    "site_type": "office",
    "consumption_kw": 167.99,
    "consumption_kwh": 167.99,
    "voltage_v": 391.6,
    "current_a": 260.7,
    "power_factor": 0.9,
    "temperature_celsius": 11.1,
    "humidity_percent": 56.1,
    "null_reasons": [],
    "data_quality": "good"
  },
  {
    "timestamp": "2021-10-20T13:24:16.795960Z",
    "site_id": "SITE001",
    "site_type": "office",
    "consumption_kw": 175.76,
    "consumption_kwh": 175.76,
    "voltage_v": 394.5,
    "current_a": 270.79,
    "power_factor": 0.939,
    "temperature_celsius": 9.1,
    "humidity_percent": 47.1,
    "null_reasons": [],
    "data_quality": "good"
  }
]
```

Codes : `200`, `404` (site inexistant), `422` (date mal formée ou `limit` hors plage).

Points d'attention :

- `limit` vaut **100 par défaut** : sans le préciser, vous n'obtenez qu'un extrait.
- Si une requête renvoie un nombre de lignes multiple de 1000, l'historique est peut-être tronqué par `limit` (`compare_metadata_x_api.py` affiche cet avertissement).
- Les timestamps des exemples du PDF n'ont **pas de fuseau** (`2024-06-14T14:32:00`). Dans nos comparaisons, nous avons rencontré des horodatages de formats ISO mélangés (avec et sans fuseau) : nos lectures pandas utilisent donc `format="ISO8601"` **[observé]**.

### 2.5 `GET /api/v1/alerts`

| Paramètre | Valeurs |
|---|---|
| `site_id` | `SITE001` à `SITE007` |
| `severity` | `low`, `medium`, `high`, `critical` |

```json
[
  {
    "alert_id": "ALR-SITE003-1792588076",
    "timestamp": "2026-10-21T12:56:56.276833",
    "site_id": "SITE003",
    "severity": "medium",
    "type": "anomaly",
    "message": "Comportement anormal détecté sur Data Center Marseille",
    "value": 764.21,
    "threshold": 630
  },
  {
    "alert_id": "ALR-SITE007-1792588076",
    "timestamp": "2026-10-21T12:17:56.276833",
    "site_id": "SITE007",
    "severity": "critical",
    "type": "outage",
    "message": "Risque de surcharge sur Usine Nantes Rezé",
    "value": 831.86,
    "threshold": 675
  }
]
```

| `type` | Signification |
|---|---|
| `spike` | Pic soudain de consommation |
| `threshold` | Dépassement du seuil configuré |
| `anomaly` | Comportement statistiquement anormal |
| `outage` | Risque de surcharge ou de coupure imminente |
| `sensor` | Défaillance d'un capteur |

| `severity` | Signification |
|---|---|
| `low` | Information, aucune action requise |
| `medium` | Surveillance recommandée |
| `high` | Action correctrice à planifier |
| `critical` | Intervention immédiate requise |

Codes : `200` (la liste peut être vide), `422` (sévérité invalide).

### 2.6 `GET /api/v1/sensors/status`

État de santé de chaque capteur, pour tous les sites en un seul appel.

Champs retournés par capteur :
`status` : `ok` | `failing`
`failing_until` : timestamp de rétablissement prévu en cas de panne
`overall`:
- `ok` : tous les capteurs fonctionnent
- `degraded` : au moins un capteur en panne (données partielles)
- `critical` :perte réseau (aucune donnée disponible)
```json
{
  "SITE001": {
    "site_name": "Bureau Paris La Défense",
    "sensors": {
      "consumption": {
        "status": "ok",
        "failing_until": null
      },
      "electrical": {
        "status": "ok",
        "failing_until": null
      },
      "temperature": {
        "status": "ok",
        "failing_until": null
      },
      "humidity": {
        "status": "ok",
        "failing_until": null
      },
      "network": {
        "status": "ok",
        "failing_until": null
      }
    },
    "overall": "ok"
  }
}
```

Cet endpoint n’a pas d’historique.

### 2.7 `GET /api/v1/stats/summary`

Résumé instantané du parc
- `total_sites`
- `total_consumption_kw`
- `total_capacity_kw`
- `average_load_percent`

Les sites dont `current_consumption_kw` est `null` ne sont pas pris en compte dans le calcul du total. **La donnée n'est donc pas complète**

```json
{
  "timestamp": "2026-10-22T06:57:36.703389",
  "total_sites": 7,
  "total_consumption_kw": 2274.56,
  "total_capacity_kw": 4130,
  "average_load_percent": 55.1,
  "sites": [
    {
      "site_id": "SITE001",
      "site_name": "Bureau Paris La Défense",
      "current_consumption_kw": 63.16,
      "capacity_kw": 200,
      "load_percent": 31.6,
      "data_quality": "partial"
    }
  ]
}
```

### 2.8 `POST /api/v1/simulate/spike/{site_id}`

Déclenche un pic de consommation fictif pour tester alertes et détection d'anomalies.

| Paramètre | Type | Défaut | Plage |
|---|---|---|---|
| `duration_minutes` | entier (requête) | 30 | 1 à 240 |

```json
{
  "status": "simulated",
  "site_id": "SITE001",
  "event": "consumption_spike",
  "duration_minutes": 30,
  "message": "Pic de consommation simulé sur Bureau Paris La Défense pour 30 minutes."
}
```

### 2.9 Codes HTTP utilisés

| Code | Signification |
|---|---|
| 200 | Succès (même avec des champs `null`) |
| 404 | Site non trouvé |
| 422 | Paramètre invalide (type, valeur hors plage, format de date) |

## 3. Les 7 sites

| Site | Type | Ville | Nom | capacité |
|---|---|---|---|---|
| SITE001 | office | Paris | Bureau Paris La Défense | 200 kW |
| SITE002 | factory | Lyon | Usine Lyon Vénissieux | 1000 kW |
| SITE003 | datacenter | Marseille | Data Center Marseille | 800 kW |
| SITE004 | retail | Lille | Centre Commercial Lille | 400 kW |
| SITE005 | hospital | Toulouse | Hôpital Toulouse Purpan | 600 kW |
| SITE006 | office | Bordeaux | Bureau Bordeaux Centre | 180 kW |
| SITE007 | factory | Nantes | Usine Nantes Rezé | 950 kW |

## 4. Ce que nous avons observé

### 4.1 `data_quality` (`/current`) contre `overall` (`/sensors/status`)

Les deux endpoints n'ont pas le même vocabulaire. Nous ramenons `data_quality` à celui de `overall` :

| `data_quality` | donne `overall` |
|---|---|
| `good` | `ok` |
| `partial` | `degraded` |
| `degraded` | `degraded` |
| `critical` | `critical` |

- **Concordance globale : environ 96 %** sur nos relevés en direct **[observé]**.
- Les désaccords sont isolés et s'expliquent par le **décalage de timing** entre les deux appels (une panne qui commence ou se termine entre les deux) **[observé]**.
- **Cas `network_loss`** : `/current` ne cite que `network_loss` dans `null_reasons`, alors que `/sensors/status` marque **tous** les capteurs en panne. Ce n'est pas une incohérence, mais une différence de représentation **[observé]**.
- Méthode : un seul appel `/sensors/status` par relevé (il renvoie les 7 sites), puis un `/current` par site, pour comparer des états du même instant.

### 4.2 API contre le jeu de données CSV

Les fichiers « metadata » du dossier `data/` ne sont pas des descriptions du schéma de l'API : ce sont une **fiche de jeu de données** (JSON, par site) et un **CSV** de consommation horaire.

| | API (`/readings`) | CSV `all_sites_combined.csv` |
|---|---|---|
| Consommation | `consumption_kw`, `consumption_kwh` | `consumption_kwh`, `consumption_euros` |
| Électrique | `voltage_v`, `current_a`, `power_factor` | absent |
| Météo | `temperature_celsius`, `humidity_percent` | `temperature_celsius`, `humidity_percent`, `solar_irradiance_wm2` |
| Qualité | `null_reasons`, `data_quality` | absent |
| Calendrier | absent | `hour`, `day_of_week`, `day_name`, `month`, `is_weekend`, `is_working_hours` |
| Site | `site_id`, `site_type` | `site_id`, `site_type`, `site_name` |
| Période | fenêtre configurable (24 h par défaut) | 2023-01-01 → 2024-12-31, pas horaire |

Conséquences :

- **Calendrier.** `hour`, `day_of_week`, `day_name`, `month` et `is_weekend` se recalculent à partir de `timestamp`. **Pas `is_working_hours`** : il dépend du type de site (bureaux 8 h–18 h, usines 6 h–21 h, commerce 9 h–20 h, centre de données et hôpital 24 h sur 24) et ne tient pas compte du week-end.
- **Qualité.** `data_quality` et `null_reasons` n'existent que dans l'API. Dans le CSV, le seul indice de panne est la consommation manquante (environ 2,3 %).
- **Unités.** `consumption_kw` et `consumption_kwh` ont la même valeur dans tous les exemples ; le sens exact du champ `kwh` n'est pas documenté.

## 5. Questions étudiées dans nos développements

Cette section reprend, pour chaque travail réalisé, les questions que nous nous sommes posées, la façon dont nous y avons répondu et ce que nous en avons conclu. Tout ce qui est chiffré vient des analyses faites sur vos données. Quand un résultat n'a pas été vu ou calculé, c'est écrit.

### 5.1 Les deux endpoints de qualité sont-ils cohérents ? (`compare_data_quality_x_sensors.py`)

| Question | Réponse |
|---|---|
| Pourquoi comparer sur `/current` et non sur `/readings` ? | `/sensors/status` n'a pas d'historique : seul l'instant présent est comparable. `/readings` n'a pas d'état des capteurs équivalent. |
| `data_quality` et `overall` disent-ils la même chose ? | Oui, à environ 96 %, une fois le vocabulaire traduit (`good` donne `ok`, `partial` et `degraded` donnent `degraded`, `critical` donne `critical`). |
| D'où viennent les désaccords restants ? | Du décalage de timing entre les deux appels : une panne qui commence ou se termine entre les deux. Ils sont isolés, pas systématiques. |
| Quand `/current` cite un capteur en panne, `/sensors/status` le confirme-t-il ? | Oui, capteur par capteur. Nous avons croisé 4 cas : « les deux », « `null_reason` seul », « `status` seul » et « aucun ». |
| Que se passe-t-il en cas de perte réseau ? | `/current` ne cite que `network_loss`, alors que `/sensors/status` marque tous les capteurs en panne. L'hypothèse a été testée en retirant les lignes `critical` (si elle est vraie, les cas « `status` seul » doivent presque disparaître) et retenue comme explication. |
| Quel capteur est le plus fragile ? | Le taux de panne par capteur et par site est calculé dans le notebook (section 5). Les valeurs dépendent de la collecte et ne sont pas reproduites ici. |
| Combien de temps faut-il collecter ? | 10 minutes étaient trop longues : le défaut est de 2 minutes, un relevé toutes les 5 secondes, soit 168 observations (24 relevés × 7 sites). |

### 5.2 Le jeu de données CSV est-il fiable ?

| Question | Réponse |
|---|---|
| Y a-t-il des valeurs manquantes ? | Environ 2,3 % de consommation manquante, en courts blocs (1 à 2 heures en médiane) : cela ressemble à des pannes de capteur, pas à du hasard isolé. |
| Le prix change-t-il ? | Non : il est constant à 0,15 €/kWh. `consumption_euros` n'apporte rien de plus que `consumption_kwh`. |
| L'ensoleillement est-il réaliste ? | Non : il est positif la nuit dans environ 48 % des heures de nuit testées. Cette colonne est à manipuler avec prudence. |
| `is_weekend` correspond-il aux dates ? | Oui : exactement samedi et dimanche, 0 écart. |
| `is_working_hours` correspond-il aux horaires ? | C'est un indicateur **par heure du jour et par site**, identique le week-end : bureaux 8 h–18 h, usines 6 h–21 h, commerce 9 h–20 h, centre de données et hôpital 24 h sur 24. Il **ne tient pas compte des week-ends**. |
| Les dates sont-elles cohérentes ? | Oui. Vérification par la formule de Zeller : le 1er janvier 2023 est bien un dimanche, 731 dates contrôlées, 0 incohérence. Le 29 février 2024 est présent (168 lignes). Le 31 décembre 2024 n'a qu'une ligne. |

### 5.3 Comment la consommation se comporte-t-elle ?

| Question | Réponse |
|---|---|
| Le week-end change-t-il la consommation ? | Beaucoup pour les bureaux (environ ×0,8) et les usines (environ ×0,63). Aucun effet pour le commerce, le centre de données et l'hôpital. |
| Y a-t-il une saisonnalité ? | Oui, commune à tous les sites : creux en janvier et en juin–juillet, pic en octobre. La corrélation moyenne entre profils mensuels est de 0,94. |
| Les sites du même type se ressemblent-ils ? | Quasiment à l'identique : corrélation de 0,99 entre leurs profils hebdomadaires. |

### 5.4 La zone géographique a-t-elle un impact ?

Question posée : deux sites du même type, dans des lieux différents, ont-ils des habitudes différentes ?

- **Constat** : ils ont les mêmes habitudes.
- **Mais on ne peut pas en conclure que la géographie n'a pas d'effet.** Les 7 sites ont presque la même météo (corrélation de 0,94 pour la température, 0,89 pour l'humidité, 0,98 pour l'ensoleillement, moyennes mensuelles identiques à 0,1 °C près), la courbe de température est irréaliste (maximum en avril vers 25 °C, minimum en octobre vers 5 °C) et le CSV n'a aucune colonne de localisation. Le jeu de données est **synthétique** : le test est impossible.

### 5.5 La météo explique-t-elle la consommation ?

| Question | Réponse |
|---|---|
| Quelle forme a la relation avec la température ? | Un **U** : consommation la plus basse vers 18–20 °C (environ 0,82 à 0,87 de l'habituel), puis environ +10 à +16 % vers 0 °C et +5 à +14 % vers 30 °C. La courbe est la même pour les 7 sites. |
| Pourquoi la corrélation classique est-elle trompeuse ? | Parce qu'une droite ne décrit pas un U. Sur la consommation brute, le signe change selon le site (+0,08 à +0,15 pour bureaux, usines et commerce, −0,28 et −0,26 pour centre de données et hôpital). Corrigée du rythme habituel (jour et heure), elle est faible et négative partout (−0,14 à −0,23). |
| Quelle est la bonne mesure ? | La distance à 19 °C. Sur toutes les heures, sa corrélation vaut 0,24 à 0,37. En écartant les pannes et les pics (environ 10 % des heures), elle monte à 0,44–0,71, soit de l'ordre de 20 à 50 % de la variation. |
| Quel site est le plus sensible ? | Le centre de données (0,71) et l'hôpital (0,70), contre 0,44–0,45 pour les usines. Ils réagissent davantage au froid qu'à la chaleur. |
| L'humidité et l'ensoleillement comptent-ils ? | Peu en plus de la température. L'humidité est liée à la température ; l'ensoleillement ne ressort que sur la consommation brute, à cause du cycle jour/nuit. |
| Et la saison ? | Le mois a une corrélation de 0,29 à 0,48 avec la consommation corrigée. Comme la température suit le mois, il reste à savoir ce que le mois apporte en plus. |

**Pistes proposées, pas encore étudiées** :

1. séparer l'effet du mois de celui de la température ;
2. voir si les anomalies dépendent de la température, de l'heure ou du site (le centre de données et l'hôpital montraient une seconde bande à 1,4–1,8) ;
3. mesurer la persistance : combien d'heures dure un écart avant de revenir à la normale ;
4. tester un décalage : la consommation réagit-elle à la température d'il y a 1, 3 ou 6 heures ?

### 5.6 Random Forest ou XGBoost ? (`compare_algo_multi_run.py`)

- **Question du script** : l'écart de précision entre les deux algorithmes est-il stable, ou dû au hasard d'un lancement ? Il refait 20 lancements, avec une graine différente à chaque fois.
- **Méthode** : consommation synthétique reconstruite depuis les profils des sites ; test sur les 60 derniers jours ; comparaison de l'erreur moyenne (MAE), de la RMSE et du temps d'entraînement ; plancher théorique de la MAE = σ × √(2/π).
- **Notre contribution** : nous avons écrit les tests du script (35 passés), pas exécuté la comparaison. **Aucun résultat chiffré sur le meilleur algorithme n'est donc donné ici.** Les écarts relatifs sont informatifs, les valeurs absolues non, puisque les données sont synthétiques.
- Cela reste un test fait entre deux algorithmes, d'autres algorithmes restent envisageables, même s’ils n’ont pas été testés ici

### 5.7 Qualité du code et chaîne de livraison

Questions réglées en chemin : comment lancer les tests, pourquoi la CI échouait (`xgboost` absent du groupe `dev`), quelles règles du lint corriger avant un commit, et comment adapter les commandes à PowerShell. Les détails sont dans la section 7.

---

## 6. Scripts du projet qui utilisent l'API

| Script | Rôle |
|---|---|
| `scripts/compare_data_quality_x_sensors.py` | Compare `/current` et `/sensors/status` |
| `scripts/compare_metadata_x_api.py` | Compare les fichiers de `data/` au schéma et aux données de l'API |
| `scripts/compare_algo_multi_run.py` | Random Forest contre XGBoost sur données synthétiques (n'appelle pas l'API) |

### `compare_data_quality_x_sensors.py`

Depuis `ml/` :

```bash
python scripts/compare_data_quality_x_sensors.py                 # collecte 2 min + analyse
python scripts/compare_data_quality_x_sensors.py --minutes 10    # collecte plus longue
python scripts/compare_data_quality_x_sensors.py analyze         # ré-analyse le CSV, sans appel API
python scripts/compare_data_quality_x_sensors.py history         # stats sur /readings (affichage seul)
```

- Fichier produit, écrasé à chaque collecte : `ml/data/raw/snapshots_quality_vs_status.csv`.
- Valeurs par défaut : `--minutes 2`, `--interval 5`.
- Ctrl+C interrompt la collecte et conserve les relevés déjà faits.
- Le fichier est écrit **une seule fois**, à la fin.
- `history` interroge `/readings` sur les dernières 24 h, avec une marge de 5 minutes sur l'horloge du serveur, et n'écrit rien.

### Tests

Depuis `ml/` :

```bash
python -m pytest tests -v
```

| Fichier de tests | Résultat attendu |
|---|---|
| `tests/test_compare_algo_multi_run.py` | 35 passés |
| `tests/test_compare_data_quality_x_sensors.py` | 45 passés, 2 « échecs attendus » |

Les tests simulent entièrement l'API (aucun appel réseau) et utilisent des identifiants fictifs.

---

## 7. Pièges et limites connus

| Sujet | Détail |
|---|---|
| `limit` par défaut | 100 résultats seulement ; maximum 1000 |
| Historique des capteurs | `/sensors/status` n'a pas d'historique ; analyse possible uniquement en direct |
| `null` en réponse `200` | Normal : l'API ne renvoie pas d'erreur en cas de panne de capteur |
| Authentification | Non décrite dans le PDF ; HTTP Basic dans nos scripts |
| Cas limite `sensor_table` | Avec pandas 3, un tableau vide fait planter `sensor_table` (`ValueError`). Peut arriver dans `analyze` si **toutes** les lignes sont `critical`. Correctif : ajouter `.astype(bool)` à la fin de la ligne `reason = df["null_reasons"].apply(...)` |
| Dépendances de la CI | `xgboost` doit figurer dans le groupe `dev` de `ml/pyproject.toml` pour que `tests-ml` passe |
| Lint (pre-commit et CI) | Règles activées : `UP017` (`datetime.UTC`), `B023` (variable de boucle dans un `lambda`), `BLE001` (`except Exception`), `SIM115` (`open` sans `with`), `C408` (`dict()`), plus le formatage `ruff format` |
| Windows (PowerShell) | `curl` est un alias de `Invoke-WebRequest` et `head` n'existe pas ; utilisez `curl.exe` et `Select-Object -First N` |
| Horloge Windows | Résolution grossière : deux appels rapprochés peuvent avoir le même horodatage. Les tests simulent donc l'horloge |

### Ce qui aurait pu être étudié

#### Évolution de `capacity_kw`

Les indices disent qu'elle est constante : la somme des capacités du tableau de la section 3
(200 + 1000 + 800 + 400 + 600 + 180 + 950) vaut 4130 kW, soit exactement `total_capacity_kw`
dans l'exemple du PDF et dans notre relevé du 22 octobre 2026. Le PDF décrit aussi `/sites`
comme des « caractéristiques statiques ». Ce n'est pas une preuve : à confirmer par un relevé
répété (script fourni plus haut).

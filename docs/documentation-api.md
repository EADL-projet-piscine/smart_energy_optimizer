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
| criticial | Perte réseau — aucune mesure disponible |

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

### à voir

est ce que la `capacity_kw` évolue dans le temps, où est ce que c'est toujours la même valeur

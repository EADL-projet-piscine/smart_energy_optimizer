"""
POC Smart Energy Optimizer - Analyse de l'API EnerVision.

Objectifs :
1. Comparer deux appels identiques à /readings.
2. Vérifier les sites, timestamps et doublons.
3. Analyser la qualité des données.
4. Collecter plusieurs mesures via /current.
5. Comparer current et readings sur des instants proches.
6. Vérifier la couverture temporelle.
7. Générer un rapport JSON.

Dépendances :
- Bibliothèque standard Python 3.12
- tzdata éventuellement nécessaire sur Windows

Attention :
Les timestamps sans fuseau sont supposés exprimés en Europe/Paris.
Cette convention doit être confirmée auprès du fournisseur de l'API.
"""

import argparse
import json
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

BASE_URL = "http://10.43.43.80:8000"

API_TIMEZONE = ZoneInfo("Europe/Paris")

MEASURES = (
    "consumption_kw",
    "consumption_kwh",
    "voltage_v",
    "current_a",
    "power_factor",
    "temperature_celsius",
    "humidity_percent",
)

COMPARE_FIELDS = MEASURES + (
    "null_reasons",
    "data_quality",
)


# ============================================================
# Utilitaires
# ============================================================


def parse_datetime(value):
    """Normalise un timestamp ISO 8601 en UTC."""

    parsed = datetime.fromisoformat(value)

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=API_TIMEZONE)

    return parsed.astimezone(UTC)


def to_iso(value):
    """Retourne un timestamp ISO 8601 en UTC."""

    return value.astimezone(UTC).isoformat()


def fetch(base_url, endpoint, params=None):
    """Effectue une requête GET et retourne le JSON."""

    url = base_url.rstrip("/") + endpoint

    if params:
        url += "?" + urlencode(params)

    request = Request(
        url,
        headers={"Accept": "application/json"},
    )

    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)

    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"Erreur API sur {url} : {exc}") from exc


def save_json(directory, filename, data):
    """Enregistre un fichier JSON en UTF-8."""

    directory.mkdir(parents=True, exist_ok=True)

    path = directory / filename

    path.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Fichier enregistré : {path}", flush=True)


# ============================================================
# Validation des données
# ============================================================


def validate_readings(rows, expected_site, source):
    """
    Vérifie :
    - Le format de la réponse.
    - Le site de chaque mesure.
    - La présence et la validité des timestamps.
    - L'absence de timestamps dupliqués.
    """

    if not isinstance(rows, list):
        raise TypeError(f"{source} : une liste de mesures était attendue.")

    seen = set()

    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise TypeError(f"{source} : mesure invalide à l'index {index}")

        site_id = row.get("site_id")

        if site_id != expected_site:
            raise ValueError(
                f"{source} : site incorrect à l'index {index}. "
                f"Attendu={expected_site}, reçu={site_id}"
            )

        timestamp = row.get("timestamp")

        if not isinstance(timestamp, str) or not timestamp:
            raise ValueError(f"{source} : timestamp absent ou invalide à l'index {index}")

        normalized = parse_datetime(timestamp)

        if normalized in seen:
            raise ValueError(f"{source} : timestamp dupliqué : {timestamp}")

        seen.add(normalized)

    print(
        f"{source} : {len(rows)} mesures validées pour {expected_site}",
        flush=True,
    )


def validate_current(reading, expected_site):
    """Valide une mesure instantanée."""

    if not isinstance(reading, dict):
        raise TypeError("current : la réponse doit être un objet JSON.")

    if reading.get("site_id") != expected_site:
        raise ValueError(
            f"current : site incorrect. Attendu={expected_site}, reçu={reading.get('site_id')}"
        )

    timestamp = reading.get("timestamp")

    if not isinstance(timestamp, str) or not timestamp:
        raise ValueError("current : timestamp absent ou invalide.")

    parse_datetime(timestamp)


# ============================================================
# Analyse qualité
# ============================================================


def analyze_quality(rows):
    """Analyse les valeurs null et les indicateurs de qualité."""

    return {
        "total_readings": len(rows),
        "null_counts": {field: sum(row.get(field) is None for row in rows) for field in MEASURES},
        "data_quality": dict(Counter(row.get("data_quality") for row in rows)),
        "null_reasons": dict(
            Counter(reason for row in rows for reason in (row.get("null_reasons") or []))
        ),
    }


# ============================================================
# Analyse temporelle
# ============================================================


def analyze_time_coverage(rows, requested_start, requested_end):
    """
    Analyse la période réellement couverte.

    Attention :
    La présence d'un premier et d'un dernier timestamp
    ne garantit pas l'absence de trous entre les deux.
    """

    if not rows:
        return {
            "count": 0,
            "warning": "Aucune mesure retournée.",
        }

    timestamps = sorted(parse_datetime(row["timestamp"]) for row in rows)

    start = parse_datetime(requested_start)
    end = parse_datetime(requested_end)

    gaps = [
        (timestamps[index] - timestamps[index - 1]).total_seconds()
        for index in range(1, len(timestamps))
    ]

    return {
        "count": len(rows),
        "requested_start_utc": to_iso(start),
        "requested_end_utc": to_iso(end),
        "first_timestamp_utc": to_iso(timestamps[0]),
        "last_timestamp_utc": to_iso(timestamps[-1]),
        "first_after_requested_start_seconds": (timestamps[0] - start).total_seconds(),
        "last_before_requested_end_seconds": (end - timestamps[-1]).total_seconds(),
        "outside_requested_window": sum(
            not (start <= timestamp <= end) for timestamp in timestamps
        ),
        "minimum_gap_seconds": min(gaps) if gaps else None,
        "maximum_gap_seconds": max(gaps) if gaps else None,
        "average_gap_seconds": (sum(gaps) / len(gaps) if gaps else None),
    }


# ============================================================
# Comparaison historique / historique
# ============================================================


def compare_historical(first, second):
    """
    Compare deux réponses historiques.

    Les correspondances sont établies sur des timestamps
    normalisés en UTC, et non sur leur représentation texte.

    Les deux listes doivent avoir été validées au préalable.
    """

    first_index = {parse_datetime(row["timestamp"]): row for row in first}

    second_index = {parse_datetime(row["timestamp"]): row for row in second}

    first_timestamps = set(first_index)
    second_timestamps = set(second_index)

    common = first_timestamps & second_timestamps

    changed_fields = {
        field: sum(
            first_index[timestamp].get(field) != second_index[timestamp].get(field)
            for timestamp in common
        )
        for field in COMPARE_FIELDS
    }

    return {
        "first_count": len(first),
        "second_count": len(second),
        "common_timestamps": len(common),
        "only_first": len(first_timestamps - second_timestamps),
        "only_second": len(second_timestamps - first_timestamps),
        "changed_fields": changed_fields,
        "strict_timestamp_comparison": True,
    }


# ============================================================
# Comparaison current / historique
# ============================================================


def compare_current_to_history(
    current_readings,
    historical_readings,
    tolerance_seconds,
):
    """
    Associe chaque mesure current à la mesure historique
    temporellement la plus proche.

    Important :
    Une correspondance proche n'est pas une preuve que
    les deux endpoints décrivent la même observation.
    """

    results = []

    historical_index = [
        (
            parse_datetime(row["timestamp"]),
            row,
        )
        for row in historical_readings
    ]

    for current in current_readings:
        current_time = parse_datetime(current["timestamp"])

        nearest = None
        nearest_time = None
        nearest_delta = None

        for historical_time, historical in historical_index:
            delta = abs((historical_time - current_time).total_seconds())

            if nearest_delta is None or delta < nearest_delta:
                nearest = historical
                nearest_time = historical_time
                nearest_delta = delta

        if nearest is None or nearest_delta > tolerance_seconds:
            results.append(
                {
                    "site_id": current["site_id"],
                    "current_timestamp": current["timestamp"],
                    "current_timestamp_utc": to_iso(current_time),
                    "matched": False,
                    "exact_timestamp_match": False,
                    "nearest_delta_seconds": nearest_delta,
                }
            )

            continue

        field_comparison = {
            field: {
                "current": current.get(field),
                "historical": nearest.get(field),
                "equal": (current.get(field) == nearest.get(field)),
            }
            for field in COMPARE_FIELDS
        }

        results.append(
            {
                "site_id": current["site_id"],
                "current_timestamp": current["timestamp"],
                "historical_timestamp": nearest["timestamp"],
                "current_timestamp_utc": to_iso(current_time),
                "historical_timestamp_utc": to_iso(nearest_time),
                "matched": True,
                "exact_timestamp_match": nearest_delta == 0,
                "delta_seconds": nearest_delta,
                "fields": field_comparison,
            }
        )

    return results


# ============================================================
# Programme principal
# ============================================================


def main():

    parser = argparse.ArgumentParser(
        description=("POC de comparaison des données de l'API EnerVision")
    )

    parser.add_argument(
        "--base-url",
        default=BASE_URL,
    )

    parser.add_argument(
        "--site",
        default="SITE001",
    )

    parser.add_argument(
        "--start",
        required=True,
        help="Début historique ISO 8601",
    )

    parser.add_argument(
        "--end",
        required=True,
        help="Fin historique ISO 8601",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=1000,
    )

    parser.add_argument(
        "--duration",
        type=int,
        default=180,
        help="Durée de collecte current en secondes",
    )

    parser.add_argument(
        "--interval",
        type=int,
        default=60,
        help="Intervalle de collecte en secondes",
    )

    parser.add_argument(
        "--tolerance",
        type=float,
        default=60,
        help="Tolérance temporelle en secondes",
    )

    parser.add_argument(
        "--output",
        default="data/exploration",
    )

    args = parser.parse_args()

    # --------------------------------------------------------
    # Validation des paramètres
    # --------------------------------------------------------

    if not 1 <= args.limit <= 1000:
        parser.error("--limit doit être entre 1 et 1000")

    if args.interval <= 0:
        parser.error("--interval doit être positif")

    if args.duration < 0:
        parser.error("--duration ne peut pas être négatif")

    if args.tolerance < 0:
        parser.error("--tolerance ne peut pas être négative")

    if parse_datetime(args.start) >= parse_datetime(args.end):
        parser.error("--start doit précéder --end")

    output_dir = Path(args.output)

    print(
        f"\nAnalyse du site {args.site}",
        flush=True,
    )

    print(
        f"Fuseau supposé pour les dates naïves : {API_TIMEZONE}",
        flush=True,
    )

    # --------------------------------------------------------
    # 1. Récupération historique
    # --------------------------------------------------------

    print(
        "\n=== ÉTAPE 1 : HISTORIQUE ===",
        flush=True,
    )

    historical_params = {
        "site_id": args.site,
        "start_time": args.start,
        "end_time": args.end,
        "limit": args.limit,
    }

    print("Premier appel /readings...", flush=True)

    historical_first = fetch(
        args.base_url,
        "/api/v1/readings",
        historical_params,
    )

    print("Deuxième appel /readings...", flush=True)

    historical_second = fetch(
        args.base_url,
        "/api/v1/readings",
        historical_params,
    )

    validate_readings(
        historical_first,
        args.site,
        "historical_first",
    )

    validate_readings(
        historical_second,
        args.site,
        "historical_second",
    )

    save_json(
        output_dir,
        "readings_first.json",
        historical_first,
    )

    save_json(
        output_dir,
        "readings_second.json",
        historical_second,
    )

    historical_comparison = compare_historical(
        historical_first,
        historical_second,
    )

    historical_coverage = analyze_time_coverage(
        historical_first,
        args.start,
        args.end,
    )

    print("\nComparaison historique :")

    print(
        json.dumps(
            historical_comparison,
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )

    print("\nCouverture temporelle :")

    print(
        json.dumps(
            historical_coverage,
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )

    if len(historical_first) == args.limit:
        print(
            "\nATTENTION : la limite de résultats est atteinte. L'historique peut être tronqué.",
            flush=True,
        )

    # --------------------------------------------------------
    # 2. Collecte current
    # --------------------------------------------------------

    print(
        "\n=== ÉTAPE 2 : COLLECTE CURRENT ===",
        flush=True,
    )

    current_readings = []

    deadline = time.monotonic() + args.duration

    while True:
        reading = fetch(
            args.base_url,
            f"/api/v1/sites/{args.site}/current",
        )

        validate_current(
            reading,
            args.site,
        )

        collected_at = datetime.now(UTC)

        current_readings.append(
            {
                "collected_at": to_iso(collected_at),
                "reading": reading,
            }
        )

        print(
            f"Mesure {len(current_readings)} : "
            f"{reading['timestamp']} | "
            f"{reading.get('consumption_kw')} kW | "
            f"Qualité : {reading.get('data_quality')}",
            flush=True,
        )

        remaining = deadline - time.monotonic()

        if remaining <= 0:
            break

        time.sleep(min(args.interval, remaining))

    save_json(
        output_dir,
        "current.json",
        current_readings,
    )

    # --------------------------------------------------------
    # 3. Historique récent
    # --------------------------------------------------------

    print(
        "\n=== ÉTAPE 3 : HISTORIQUE RÉCENT ===",
        flush=True,
    )

    current_start = min(parse_datetime(item["reading"]["timestamp"]) for item in current_readings)

    current_end = max(parse_datetime(item["reading"]["timestamp"]) for item in current_readings)

    recent_start = current_start - timedelta(minutes=5)
    recent_end = current_end + timedelta(minutes=5)

    recent_params = {
        "site_id": args.site,
        "start_time": to_iso(recent_start),
        "end_time": to_iso(recent_end),
        "limit": args.limit,
    }

    recent_history = fetch(
        args.base_url,
        "/api/v1/readings",
        recent_params,
    )

    validate_readings(
        recent_history,
        args.site,
        "recent_history",
    )

    save_json(
        output_dir,
        "readings_recent.json",
        recent_history,
    )

    recent_coverage = analyze_time_coverage(
        recent_history,
        to_iso(recent_start),
        to_iso(recent_end),
    )

    if len(recent_history) == args.limit:
        print(
            "ATTENTION : historique récent potentiellement tronqué.",
            flush=True,
        )

    # --------------------------------------------------------
    # 4. Comparaison current / historique
    # --------------------------------------------------------

    print(
        "\n=== ÉTAPE 4 : COMPARAISON ===",
        flush=True,
    )

    current_values = [item["reading"] for item in current_readings]

    comparison = compare_current_to_history(
        current_values,
        recent_history,
        args.tolerance,
    )

    matched_count = sum(result["matched"] for result in comparison)

    exact_matches = sum(result["exact_timestamp_match"] for result in comparison)

    print(
        f"Correspondances temporelles : {matched_count}/{len(comparison)}",
        flush=True,
    )

    print(
        f"Correspondances exactes : {exact_matches}/{len(comparison)}",
        flush=True,
    )

    # --------------------------------------------------------
    # 5. Rapport final
    # --------------------------------------------------------

    print(
        "\n=== ÉTAPE 5 : RAPPORT ===",
        flush=True,
    )

    report = {
        "site": args.site,
        "timestamp_timezone_assumption": "Europe/Paris",
        "historical_period": {
            "start": args.start,
            "end": args.end,
        },
        "historical_comparison": historical_comparison,
        "historical_coverage": historical_coverage,
        "historical_quality": analyze_quality(historical_first),
        "current_quality": analyze_quality(current_values),
        "recent_quality": analyze_quality(recent_history),
        "recent_coverage": recent_coverage,
        "temporal_matches": matched_count,
        "exact_timestamp_matches": exact_matches,
        "current_vs_history": comparison,
        "warnings": [
            ("Les timestamps sans fuseau sont interprétés comme des heures Europe/Paris."),
            (
                "Une correspondance temporelle ne garantit pas "
                "que deux endpoints retournent la même observation."
            ),
            ("La limite de 1000 mesures peut tronquer les périodes historiques."),
        ],
    }

    save_json(
        output_dir,
        "report.json",
        report,
    )

    print(
        "\nAnalyse terminée !",
        flush=True,
    )

    print(
        f"Rapport : {output_dir.resolve() / 'report.json'}",
        flush=True,
    )


# ============================================================
# Point d'entrée
# ============================================================

if __name__ == "__main__":
    main()

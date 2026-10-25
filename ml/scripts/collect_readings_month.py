import argparse
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient


def main():
    parser = argparse.ArgumentParser(
        description="Collecte mensuelle des mesures énergétiques EnerVision"
    )

    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Nombre de jours à collecter (défaut : 30)",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=288,
        help="Nombre maximal de mesures demandées par site et par jour",
    )

    args = parser.parse_args()

    if args.days < 1:
        parser.error("--days doit être supérieur ou égal à 1")

    if not 1 <= args.limit <= 1000:
        parser.error("--limit doit être compris entre 1 et 1000")

    # Une période commune, terminée au début du jour UTC courant.
    collected_at = datetime.now(UTC)
    period_end = collected_at.replace(hour=0, minute=0, second=0, microsecond=0)
    period_start = period_end - timedelta(days=args.days)

    output_dir = Path(f"data/raw/{args.days}d")
    output_dir.mkdir(parents=True, exist_ok=True)

    total_readings = 0
    failed_requests = 0

    with EnerVisionClient() as client:
        for site_number in range(1, 8):
            site_id = f"SITE{site_number:03d}"

            for day_index in range(args.days):
                start = period_start + timedelta(days=day_index)
                end = start + timedelta(days=1)

                date_label = start.strftime("%Y%m%d")
                path = output_dir / f"{site_id}_{date_label}.json"

                if path.exists():
                    print(f"[SKIP] {path} existe déjà")
                    continue

                try:
                    readings = client.get_readings(
                        site_id=site_id,
                        start=start,
                        end=end,
                        limit=args.limit,
                    )

                    if not isinstance(readings, list):
                        raise TypeError("La réponse API n'est pas une liste de mesures")

                    # Contrôle des timestamps, sans modifier les données.
                    timestamps = [
                        datetime.fromisoformat(reading["timestamp"]) for reading in readings
                    ]
                    if any(
                        timestamp.tzinfo is None or not start <= timestamp.astimezone(UTC) < end
                        for timestamp in timestamps
                    ):
                        raise ValueError(f"Mesures hors période pour {site_id} / {date_label}")

                    if len(set(timestamps)) != len(timestamps):
                        raise ValueError(f"Doublons de timestamps pour {site_id} / {date_label}")

                    output = {
                        "site_id": site_id,
                        "collected_at": collected_at.isoformat(),
                        "period_start": start.isoformat(),
                        "period_end": end.isoformat(),
                        "requested_limit": args.limit,
                        "readings": readings,
                    }

                    # Écriture atomique pour éviter les fichiers incomplets.
                    temporary_path = path.with_suffix(".tmp")

                    temporary_path.write_text(
                        json.dumps(output, indent=2, ensure_ascii=False),
                        encoding="utf-8",
                    )

                    temporary_path.replace(path)

                    total_readings += len(readings)

                    print(f"[OK] {site_id} | {date_label} | {len(readings)} mesures")

                except Exception as exc:  # noqa: BLE001
                    failed_requests += 1
                    print(f"[ERROR] {site_id} | {date_label} | {exc}")

    print("\n--- Bilan de collecte ---")
    print(f"Mesures récupérées pendant cette exécution : {total_readings}")
    print(f"Requêtes échouées : {failed_requests}")
    print(f"Dossier : {output_dir}")

    if failed_requests:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

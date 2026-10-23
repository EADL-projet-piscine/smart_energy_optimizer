import argparse
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient


def main():
    parser = argparse.ArgumentParser(description="Collecte des mesures énergétiques EnerVision")

    parser.add_argument(
        "--days",
        type=int,
        default=1,
        help="Nombre de jours à collecter (défaut : 1)",
    )

    args = parser.parse_args()

    if args.days < 1:
        parser.error("--days doit être supérieur ou égal à 1")

    collected_at = datetime.now(UTC)

    end = collected_at - timedelta(minutes=5)
    start = end - timedelta(days=args.days)

    output_dir = Path(f"data/raw/{args.days}d")
    output_dir.mkdir(parents=True, exist_ok=True)

    with EnerVisionClient() as client:
        for site_number in range(1, 8):
            site_id = f"SITE{site_number:03d}"

            readings = client.get_readings(
                site_id=site_id,
                start=start,
                end=end,
                limit=1000,
            )

            output = {
                "site_id": site_id,
                "collected_at": collected_at.isoformat(),
                "period_start": start.isoformat(),
                "period_end": end.isoformat(),
                "readings": readings,
            }

            filename = f"{site_id}_{collected_at.strftime('%Y%m%d_%H%M%S')}.json"

            path = output_dir / filename

            path.write_text(
                json.dumps(output, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            print(f"{site_id} : {len(readings)} mesures enregistrées dans {path}")


if __name__ == "__main__":
    main()

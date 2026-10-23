import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "data" / "raw" / "yearly"


def first_wednesday(year: int, month: int) -> datetime:
    date = datetime(year, month, 1, tzinfo=UTC)

    while date.weekday() != 2:
        date += timedelta(days=1)

    return date


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with EnerVisionClient() as client:
        for month in range(1, 11):
            start = first_wednesday(2026, month)
            end = start + timedelta(days=1)

            for site_number in range(1, 8):
                site_id = f"SITE{site_number:03d}"

                path = OUTPUT_DIR / (f"{site_id}_{start.strftime('%Y%m%d')}.json")

                # Évite de régénérer les données déjà collectées.
                if path.exists():
                    print(f"Déjà présent : {path.name}")
                    continue

                readings = client.get_readings(
                    site_id=site_id,
                    start=start,
                    end=end,
                    limit=1000,
                )

                output = {
                    "site_id": site_id,
                    "collected_at": datetime.now(UTC).isoformat(),
                    "period_start": start.isoformat(),
                    "period_end": end.isoformat(),
                    "readings": readings,
                }

                path.write_text(
                    json.dumps(output, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )

                print(f"{site_id} — {start.date()} : {len(readings)} mesures")


if __name__ == "__main__":
    main()

from datetime import UTC, datetime, timedelta

import pandas as pd

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient


def first_wednesday(year, month):
    date = datetime(year, month, 1, tzinfo=UTC)

    while date.weekday() != 2:
        date += timedelta(days=1)

    return date


def main():
    results = []

    with EnerVisionClient() as client:
        for month in range(1, 11):
            start = first_wednesday(2026, month)
            end = start + timedelta(days=1)

            readings = client.get_readings(
                site_id="SITE001",
                start=start,
                end=end,
                limit=1000,
            )

            df = pd.DataFrame(readings)

            results.append(
                {
                    "month": month,
                    "date": start.date(),
                    "observations": len(df),
                    "temperature_mean": df["temperature_celsius"].mean(),
                    "humidity_mean": df["humidity_percent"].mean(),
                    "consumption_mean": df["consumption_kw"].mean(),
                }
            )

    summary = pd.DataFrame(results)

    print(summary.round(2).to_string(index=False))


if __name__ == "__main__":
    main()

# ml/scripts/prepare_dataset.py

import argparse
import logging
from datetime import UTC, date, datetime, time
from pathlib import Path

from smart_energy_ml.data_access.contract import validate_hourly_readings
from smart_energy_ml.ingestion.readings_collector import collect_readings
from smart_energy_ml.preprocessing.hourly_aggregation import build_hourly_dataset

LOGGER = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"


def parse_date(value: str) -> date:
    """Convertit une date au format YYYY-MM-DD."""

    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Date invalide : {value}. Format attendu : YYYY-MM-DD"
        ) from exc


def prepare_dataset(
    start: date,
    end: date,
    refresh: bool = False,
) -> Path:
    """Orchestre la préparation du dataset horaire."""

    if start >= end:
        raise ValueError("La date de début doit précéder la date de fin.")

    start_dt = datetime.combine(start, time.min, tzinfo=UTC)
    end_dt = datetime.combine(end, time.min, tzinfo=UTC)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    LOGGER.info("Préparation du dataset : %s → %s", start, end)

    LOGGER.info("Étape 1/4 : collecte des données")
    collect_readings(start_dt, end_dt, RAW_DIR, refresh)

    LOGGER.info("Étape 2/4 : agrégation horaire")
    df = build_hourly_dataset(start_dt, end_dt, RAW_DIR)

    LOGGER.info("Étape 3/4 : validation du contrat")
    validate_hourly_readings(df)

    output_path = PROCESSED_DIR / f"readings_hourly_{start:%Y%m%d}_{end:%Y%m%d}.parquet"

    LOGGER.info("Étape 4/4 : export Parquet")
    df.to_parquet(output_path, index=False)

    LOGGER.info(
        "Dataset généré : %s (%s observations)",
        output_path,
        len(df),
    )

    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Prépare le dataset horaire EnerVision.")

    parser.add_argument(
        "--start",
        type=parse_date,
        required=True,
        help="Date de début incluse (YYYY-MM-DD).",
    )

    parser.add_argument(
        "--end",
        type=parse_date,
        required=True,
        help="Date de fin exclue (YYYY-MM-DD).",
    )

    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Force le téléchargement des données depuis EnerVision.",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    prepare_dataset(
        start=args.start,
        end=args.end,
        refresh=args.refresh,
    )


if __name__ == "__main__":
    main()

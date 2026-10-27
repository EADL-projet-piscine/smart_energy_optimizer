# ml/src/smart_energy_ml/data_access/parquet.py

from datetime import datetime
from pathlib import Path

import pandas as pd

from smart_energy_ml.data_access.base import HourlyReadingsDataSource
from smart_energy_ml.data_access.contract import (
    REQUIRED_COLUMNS,
    validate_hourly_readings,
)


class ParquetDataSource(HourlyReadingsDataSource):
    """Source de données horaires stockées dans un fichier Parquet."""

    def __init__(self, file_path: str | Path) -> None:
        self.file_path = Path(file_path)

    def load_hourly_readings(
        self,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:

        if start_date.tzinfo is None or end_date.tzinfo is None:
            raise ValueError("Les dates doivent posséder un fuseau horaire.")

        if start_date >= end_date:
            raise ValueError("La date de début doit précéder la date de fin.")

        if not self.file_path.is_file():
            raise FileNotFoundError(f"Fichier Parquet introuvable : {self.file_path}")

        df = pd.read_parquet(self.file_path)

        # Les données historiques du notebook sont horodatées en UTC.
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

        start_utc = pd.Timestamp(start_date).tz_convert("UTC")
        end_utc = pd.Timestamp(end_date).tz_convert("UTC")

        df = df.loc[(df["timestamp"] >= start_utc) & (df["timestamp"] < end_utc)]

        df = df.loc[:, list(REQUIRED_COLUMNS)].copy()

        df = df.sort_values(["site_id", "timestamp"]).reset_index(drop=True)

        validate_hourly_readings(df)

        return df

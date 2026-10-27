# ml/src/smart_energy_ml/data_access/base.py

from abc import ABC, abstractmethod
from datetime import datetime

import pandas as pd


class HourlyReadingsDataSource(ABC):
    """Interface d'accès aux consommations horaires."""

    @abstractmethod
    def load_hourly_readings(
        self,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """Charge les données horaires sur une période [début, fin)."""

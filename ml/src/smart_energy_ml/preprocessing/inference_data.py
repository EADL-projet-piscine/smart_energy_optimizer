
import logging
from datetime import timedelta
from pathlib import Path

import pandas as pd

from smart_energy_ml.data_access.contract import (
    validate_hourly_readings,
)
from smart_energy_ml.ingestion.readings_collector import (
    collect_readings,
)
from smart_energy_ml.preprocessing.hourly_aggregation import (
    build_hourly_dataset,
)

LOGGER = logging.getLogger(__name__)

HISTORY_DAYS = 8


def load_inference_data(
    forecast_origin: pd.Timestamp,
    raw_dir: Path,
    history_days: int = HISTORY_DAYS,
) -> pd.DataFrame:
    """
    Collecte et prépare les données horaires nécessaires
    aux prévisions H+1 à H+24.

    L'origine de prévision correspond à la dernière heure
    observée, à 23 h UTC.

    La collecte couvre les journées UTC complètes
    précédant la journée à prédire.
    """

    origin = pd.Timestamp(forecast_origin)

    if origin.tzinfo is None:
        raise ValueError(
            "L'origine de prévision doit contenir un fuseau horaire."
        )

    origin = origin.tz_convert("UTC")

    if origin.hour != 23 or origin.minute != 0:
        raise ValueError(
            "L'origine quotidienne doit être fixée à 23 h UTC."
        )

    if origin.second != 0 or origin.microsecond != 0:
        raise ValueError(
            "L'origine doit correspondre au début d'une heure."
        )

    if history_days < 8:
        raise ValueError(
            "L'historique doit couvrir au moins huit jours."
        )

    # Fin exclusive : minuit UTC après l'origine.
    end = origin + pd.Timedelta(hours=1)

    # Début de la fenêtre historique.
    start = end - pd.Timedelta(days=history_days)

    LOGGER.info(
        "Préparation des données d'inférence : %s → %s",
        start.isoformat(),
        end.isoformat(),
    )

    # 1. Collecte API avec cache local.
    collect_readings(
        start=start.to_pydatetime(),
        end=end.to_pydatetime(),
        raw_dir=raw_dir,
        refresh_last_day=True,
    )

    # 2. Agrégation horaire.
    df_hourly = build_hourly_dataset(
        start=start.to_pydatetime(),
        end=end.to_pydatetime(),
        raw_dir=raw_dir,
    )

    # 3. Validation du contrat ETL → ML.
    validate_hourly_readings(df_hourly)

    LOGGER.info(
        "Données d'inférence prêtes : %s observations, %s sites",
        len(df_hourly),
        df_hourly["site_id"].nunique(),
    )

    return df_hourly

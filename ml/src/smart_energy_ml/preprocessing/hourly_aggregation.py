import json
import logging
from datetime import datetime
from pathlib import Path

import pandas as pd

LOGGER = logging.getLogger(__name__)

EXPECTED_READINGS_PER_HOUR = 12
MIN_VALID_READINGS = 9

OUTPUT_COLUMNS = [
    "site_id",
    "site_type",
    "timestamp",
    "consumption_kw",
    "valid_readings",
    "total_readings",
    "coverage_pct",
]


def build_hourly_dataset(
    start: datetime,
    end: datetime,
    raw_dir: Path,
) -> pd.DataFrame:
    """Construit le dataset horaire depuis les fichiers JSON EnerVision."""

    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("Les dates doivent contenir un fuseau horaire.")

    if start >= end:
        raise ValueError("La date de début doit précéder la date de fin.")

    start_utc = pd.Timestamp(start).tz_convert("UTC")
    end_utc = pd.Timestamp(end).tz_convert("UTC")

    if start_utc != start_utc.floor("h") or end_utc != end_utc.floor("h"):
        raise ValueError("Les bornes doivent être alignées sur des heures entières.")

    raw_dir = Path(raw_dir)

    days = pd.date_range(
        start=start_utc.normalize(),
        end=end_utc,
        freq="D",
        inclusive="left",
    )

    files = sorted(
        file_path for day in days for file_path in raw_dir.glob(f"SITE*/SITE*_{day:%Y%m%d}.json")
    )

    if not files:
        raise FileNotFoundError(f"Aucun fichier JSON EnerVision trouvé dans {raw_dir}")

    records = []

    for file_path in files:
        with file_path.open(encoding="utf-8") as file:
            payload = json.load(file)

        for reading in payload["readings"]:
            records.append(
                {
                    "site_id": reading["site_id"],
                    "site_type": reading["site_type"],
                    "timestamp": reading["timestamp"],
                    "consumption_kw": reading.get("consumption_kw"),
                }
            )

    df = pd.DataFrame(
        records,
        columns=[
            "site_id",
            "site_type",
            "timestamp",
            "consumption_kw",
        ],
    )

    if df.empty:
        raise ValueError("Aucune mesure trouvée dans les fichiers JSON.")

    df["timestamp"] = pd.to_datetime(
        df["timestamp"],
        format="ISO8601",
        utc=True,
    )
    df["consumption_kw"] = pd.to_numeric(
        df["consumption_kw"],
        errors="coerce",
    )

    # Conserver uniquement la période demandée.
    df = df.loc[(df["timestamp"] >= start_utc) & (df["timestamp"] < end_utc)].copy()

    if df.empty:
        raise ValueError("Aucune mesure sur la période demandée.")

    # Vérifier qu'un relevé n'est pas présent plusieurs fois.
    if df.duplicated(["site_id", "timestamp"]).any():
        raise ValueError("Doublons détectés dans les mesures EnerVision.")

    # Une mesure appartient à l'heure de début de son intervalle.
    df["timestamp"] = df["timestamp"].dt.floor("h")

    # Calcul de la moyenne et du nombre de valeurs exploitables.
    hourly = df.groupby(
        ["site_id", "site_type", "timestamp"],
        as_index=False,
    ).agg(
        consumption_kw=("consumption_kw", "mean"),
        valid_readings=("consumption_kw", "count"),
    )

    # Reconstituer toutes les heures pour chaque site.
    all_hours = pd.date_range(
        start=start_utc,
        end=end_utc,
        freq="h",
        inclusive="left",
    )

    site_types = df[["site_id", "site_type"]].drop_duplicates()

    if site_types.duplicated("site_id").any():
        raise ValueError("Plusieurs types détectés pour un même site.")

    full_index = pd.MultiIndex.from_product(
        [site_types["site_id"], all_hours],
        names=["site_id", "timestamp"],
    )

    hourly = hourly.set_index(["site_id", "timestamp"]).reindex(full_index).reset_index()

    hourly = hourly.drop(columns=["site_type"]).merge(
        site_types,
        on="site_id",
        how="left",
        validate="many_to_one",
    )

    # Une heure représente 12 emplacements de mesure.
    hourly["total_readings"] = EXPECTED_READINGS_PER_HOUR

    hourly["valid_readings"] = hourly["valid_readings"].fillna(0).astype(int)

    hourly["coverage_pct"] = hourly["valid_readings"] / EXPECTED_READINGS_PER_HOUR * 100

    # Seuil de couverture minimal : 75 %.
    hourly.loc[
        hourly["valid_readings"] < MIN_VALID_READINGS,
        "consumption_kw",
    ] = float("nan")

    hourly = hourly[OUTPUT_COLUMNS].sort_values(["site_id", "timestamp"]).reset_index(drop=True)

    LOGGER.info(
        "Agrégation terminée : %s heures, %s consommations manquantes",
        len(hourly),
        hourly["consumption_kw"].isna().sum(),
    )

    return hourly

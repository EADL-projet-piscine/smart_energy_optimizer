import argparse
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import mlflow
import mlflow.sklearn
import numpy as np
import pandas as pd
from mlflow import MlflowClient

from smart_energy_ml.data_access.forecast_repository import (
    prepare_forecast_records,
)
from smart_energy_ml.features.feature_engineering import (
    FEATURE_COLUMNS,
    build_inference_features,
)
from smart_energy_ml.preprocessing.inference_data import (
    load_inference_data,
)

# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parents[1]

DATASET_PATH = BASE_DIR / "data/processed/readings_hourly_20250101_20260701.parquet"

RAW_INFERENCE_DIR = BASE_DIR / "data/raw/inference"
OUTPUT_DIR = BASE_DIR / "data/predictions"

TRACKING_URI = f"sqlite:///{BASE_DIR / 'mlflow.db'}"

MODEL_NAME = "smart-energy-rf-global"


# ---------------------------------------------------------
# Arguments CLI
# ---------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=("Génération des prévisions énergétiques H+1 à H+24 pour chaque site.")
    )

    parser.add_argument(
        "--source",
        choices=["api", "parquet"],
        default="parquet",
        help="Source des données horaires (défaut : parquet).",
    )

    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help=(
            "Journée cible au format YYYY-MM-DD (UTC). "
            "En mode API, la valeur par défaut est "
            "la journée UTC en cours."
        ),
    )

    parser.add_argument(
        "--model-version",
        type=int,
        default=None,
        help=("Version MLflow à utiliser. Par défaut : alias champion."),
    )

    return parser.parse_args()


# ---------------------------------------------------------
# Détermination de l'origine
# ---------------------------------------------------------


def get_forecast_origin(
    target_date: str | None,
    source: str,
) -> pd.Timestamp | None:
    """
    Détermine l'origine des prévisions.

    Mode API sans date :
        Prévision de la journée UTC en cours.

    Mode Parquet sans date :
        Dernière heure exploitable de chaque site.
    """

    if target_date is None:
        if source == "parquet":
            return None

        target_date = datetime.now(UTC).date().isoformat()

    try:
        parsed_date = pd.Timestamp(target_date)

        if (
            len(target_date) != 10
            or parsed_date.strftime("%Y-%m-%d") != target_date
            or parsed_date.tzinfo is not None
        ):
            raise ValueError

    except (ValueError, TypeError) as exc:
        raise ValueError("La date doit être au format YYYY-MM-DD.") from exc

    forecast_origin = parsed_date.tz_localize("UTC") - pd.Timedelta(hours=1)

    logger.info(
        "Journée cible : %s | Origine : %s",
        target_date,
        forecast_origin,
    )

    return forecast_origin


# ---------------------------------------------------------
# Chargement des données horaires
# ---------------------------------------------------------


def load_hourly_data(
    source: str,
    forecast_origin: pd.Timestamp | None,
) -> pd.DataFrame:
    """Charge les données depuis le Parquet ou EnerVision."""

    if source == "parquet":
        logger.info(
            "Chargement du dataset Parquet : %s",
            DATASET_PATH,
        )

        if not DATASET_PATH.exists():
            raise FileNotFoundError(f"Dataset introuvable : {DATASET_PATH}")

        return pd.read_parquet(DATASET_PATH)

    if forecast_origin is None:
        raise ValueError("Une origine de prévision est requise pour la collecte API.")

    logger.info(
        "Collecte EnerVision pour l'origine %s",
        forecast_origin,
    )

    return load_inference_data(
        forecast_origin=forecast_origin,
        raw_dir=RAW_INFERENCE_DIR,
    )


# ---------------------------------------------------------
# Sélection du modèle MLflow
# ---------------------------------------------------------


def resolve_model_version(
    requested_version: int | None,
) -> int:
    """
    Résout la version exacte du modèle.

    Sans version explicite, utilise l'alias champion.
    """

    if requested_version is not None:
        if requested_version < 1:
            raise ValueError("La version du modèle doit être positive.")

        return requested_version

    client = MlflowClient()

    registered_model = client.get_model_version_by_alias(
        MODEL_NAME,
        "champion",
    )

    return int(registered_model.version)


# ---------------------------------------------------------
# Construction des résultats
# ---------------------------------------------------------


def build_results(
    df_features: pd.DataFrame,
) -> list[dict[str, Any]]:
    """Regroupe les prévisions par site au format JSON."""

    results = []

    for site_id, site_df in df_features.groupby("site_id"):
        site_df = site_df.sort_values("horizon")

        results.append(
            {
                "site_id": site_id,
                "site_type": site_df["site_type"].iloc[0],
                "forecast_origin": (site_df["forecast_origin"].iloc[0].isoformat()),
                "predictions": [
                    {
                        "timestamp": row.target_timestamp.isoformat(),
                        "horizon": int(row.horizon),
                        "predicted_consumption_kw": round(
                            float(row.predicted_consumption_kw),
                            2,
                        ),
                    }
                    for row in site_df.itertuples()
                ],
            }
        )

    return results


def validate_predictions(
    df_features: pd.DataFrame,
) -> None:
    """Vérifie la cohérence des prévisions générées."""

    for site_id, site_df in df_features.groupby("site_id"):
        horizons = sorted(site_df["horizon"].tolist())

        if horizons != list(range(1, 25)):
            raise ValueError(f"Prévisions incomplètes pour {site_id} : {len(horizons)} horizons.")

        if site_df["forecast_origin"].nunique() != 1:
            raise ValueError(f"Plusieurs origines détectées pour {site_id}.")

        expected_timestamps = site_df["forecast_origin"] + pd.to_timedelta(
            site_df["horizon"], unit="h"
        )

        if not (site_df["target_timestamp"] == expected_timestamps).all():
            raise ValueError(f"Timestamps incohérents pour {site_id}.")


# ---------------------------------------------------------
# Export JSON
# ---------------------------------------------------------


def export_json(
    data: list[dict[str, Any]],
    output_path: Path,
) -> None:
    """Exporte les résultats dans un fichier JSON."""

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_path = output_path.with_suffix(".json.tmp")

    temp_path.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    temp_path.replace(output_path)

    logger.info(
        "Fichier généré : %s",
        output_path,
    )


# ---------------------------------------------------------
# Exécution principale
# ---------------------------------------------------------


def main() -> None:
    args = parse_args()

    # 1. Origine de prévision

    forecast_origin = get_forecast_origin(
        args.date,
        args.source,
    )

    # 2. Chargement des données horaires

    df_hourly = load_hourly_data(
        source=args.source,
        forecast_origin=forecast_origin,
    )

    # 3. Construction des caractéristiques

    logger.info("Construction des caractéristiques d'inférence")

    df_features = build_inference_features(
        df_hourly,
        forecast_origin=forecast_origin,
    )

    if df_features.empty:
        raise ValueError("Aucune caractéristique d'inférence générée.")

    logger.info(
        "%s exemples générés pour %s sites",
        len(df_features),
        df_features["site_id"].nunique(),
    )

    # 4. Chargement du modèle MLflow

    mlflow.set_tracking_uri(TRACKING_URI)

    model_version = resolve_model_version(args.model_version)

    model_uri = f"models:/{MODEL_NAME}/{model_version}"

    logger.info(
        "Chargement du modèle : %s (version %s)",
        MODEL_NAME,
        model_version,
    )

    model = mlflow.sklearn.load_model(model_uri)

    # 5. Prédictions

    logger.info("Calcul des prévisions")

    predictions = model.predict(df_features[FEATURE_COLUMNS])

    if not np.isfinite(predictions).all():
        raise ValueError("Le modèle a produit des prédictions invalides.")

    df_features["predicted_consumption_kw"] = np.clip(predictions, a_min=0, a_max=None)

    validate_predictions(df_features)

    # 6. Construction des résultats

    results = build_results(df_features)

    db_records = prepare_forecast_records(
        results=results,
        model_version=model_version,
    )

    # 7. Détermination de la date cible

    if forecast_origin is not None:
        output_date = (forecast_origin + pd.Timedelta(hours=1)).strftime("%Y-%m-%d")
    else:
        target_dates = df_features["target_timestamp"].dt.strftime("%Y-%m-%d").unique()

        output_date = target_dates[0] if len(target_dates) == 1 else "latest"

    # 8. Export des deux fichiers JSON

    forecast_path = OUTPUT_DIR / f"forecast_{output_date}.json"

    db_path = OUTPUT_DIR / f"forecast_{output_date}_db.json"

    export_json(results, forecast_path)
    export_json(db_records, db_path)

    logger.info(
        "Traitement terminé : %s prévisions pour %s sites (modèle v%s)",
        len(df_features),
        len(results),
        model_version,
    )


if __name__ == "__main__":
    main()

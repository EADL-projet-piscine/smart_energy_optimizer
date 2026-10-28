import gc
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

import mlflow
import mlflow.sklearn
import numpy as np
import pandas as pd
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST
from sklearn.metrics import mean_absolute_error, mean_squared_error

from smart_energy_ml.features.feature_engineering import (
    FEATURE_COLUMNS,
    build_supervised_dataset,
)
from smart_energy_ml.models.random_forest import create_pipeline

EXPERIMENT_NAME = "smart-energy-forecasting"
MODEL_NAME = "smart-energy-rf-global"

RUN_NAME = f"rf_light_h24_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}"

DATASET_PATH = Path("data/processed/readings_hourly_20250101_20260701.parquet")

TRAIN_END = pd.Timestamp("2026-01-01", tz="UTC")
VALIDATION_END = pd.Timestamp("2026-04-01", tz="UTC")

MAX_TRAIN_SAMPLES = int(os.getenv("MAX_TRAIN_SAMPLES", "100000"))
MAX_VALIDATION_SAMPLES = int(os.getenv("MAX_VALIDATION_SAMPLES", "25000"))

N_ESTIMATORS = int(os.getenv("RF_N_ESTIMATORS", "20"))
MAX_DEPTH = int(os.getenv("RF_MAX_DEPTH", "10"))
MIN_SAMPLES_LEAF = int(os.getenv("RF_MIN_SAMPLES_LEAF", "20"))

RANDOM_STATE = 42

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


def calculate_metrics(y_true, y_pred) -> dict:
    actual = np.asarray(y_true)
    predicted = np.asarray(y_pred)

    denominator = np.abs(actual).sum()

    return {
        "mae_kw": float(mean_absolute_error(actual, predicted)),
        "rmse_kw": float(np.sqrt(mean_squared_error(actual, predicted))),
        "wape_pct": (
            float(np.abs(actual - predicted).sum() / denominator * 100)
            if denominator > 0
            else float("nan")
        ),
    }


def initialize_champion(model_name: str, version: str) -> None:
    client = MlflowClient()

    try:
        champion = client.get_model_version_by_alias(
            model_name,
            "champion",
        )

        logger.info(
            "Champion existant : version %s. Aucun changement.",
            champion.version,
        )
        return

    except MlflowException as exc:
        if exc.error_code != RESOURCE_DOES_NOT_EXIST:
            raise

    client.set_registered_model_alias(
        name=model_name,
        alias="champion",
        version=version,
    )

    logger.info("Champion initialisé : version %s", version)


def sample_dataset(df: pd.DataFrame, max_samples: int) -> pd.DataFrame:
    """
    Échantillonnage déterministe pour limiter la mémoire.

    Les lignes sont sélectionnées sur l'ensemble de la période,
    sans privilégier uniquement les dates les plus récentes.
    """
    if len(df) <= max_samples:
        return df

    logger.info(
        "Échantillonnage : %s -> %s exemples",
        len(df),
        max_samples,
    )

    return df.sample(
        n=max_samples,
        random_state=RANDOM_STATE,
    ).sort_values("forecast_origin")


def optimize_numeric_types(df: pd.DataFrame) -> pd.DataFrame:
    """
    Réduit la mémoire des colonnes numériques compatibles.
    """
    for column in FEATURE_COLUMNS:
        if column not in df.columns:
            continue

        if pd.api.types.is_float_dtype(df[column]):
            df[column] = df[column].astype("float32")

        elif pd.api.types.is_integer_dtype(df[column]):
            df[column] = pd.to_numeric(
                df[column],
                downcast="integer",
            )

    return df


def main() -> None:
    logger.info("Chargement du dataset horaire")

    df_hourly = pd.read_parquet(DATASET_PATH)

    logger.info(
        "Dataset source : %.2f Mio",
        df_hourly.memory_usage(deep=True).sum() / 1024**2,
    )

    logger.info("Construction des exemples supervisés")

    df = build_supervised_dataset(
        df_hourly,
        max_origins=8000,
    )

    logger.info(
        "Dataset supervisé : %s lignes, %.2f Mio",
        len(df),
        df.memory_usage(deep=True).sum() / 1024**2,
    )

    # Conserver uniquement les colonnes utiles au modèle.
    required_columns = list(
        dict.fromkeys(
            [
                *FEATURE_COLUMNS,
                "forecast_origin",
                "target_timestamp",
                "target_consumption_kw",
            ]
        )
    )

    df = df[required_columns].copy()

    logger.info("Découpage chronologique")

    train_mask = (df["forecast_origin"] >= TRAIN_END - pd.Timedelta(days=365)) & (
        df["target_timestamp"] < TRAIN_END
    )

    validation_mask = (df["forecast_origin"] >= TRAIN_END) & (
        df["target_timestamp"] < VALIDATION_END
    )

    df_train = df.loc[train_mask]
    df_validation = df.loc[validation_mask]

    if df_train.empty or df_validation.empty:
        raise ValueError("Jeu d'entraînement ou de validation vide.")

    assert df_train["target_timestamp"].max() < TRAIN_END
    assert df_validation["target_timestamp"].min() >= TRAIN_END
    assert df_validation["target_timestamp"].max() < VALIDATION_END

    # Réduction du volume avant de créer les matrices du modèle.
    df_train = sample_dataset(df_train, MAX_TRAIN_SAMPLES).copy()
    df_validation = sample_dataset(
        df_validation,
        MAX_VALIDATION_SAMPLES,
    ).copy()

    # Libérer le dataset supervisé complet.
    del df, train_mask, validation_mask
    gc.collect()

    optimize_numeric_types(df_train)
    optimize_numeric_types(df_validation)

    logger.info("Entraînement : %s exemples", len(df_train))
    logger.info("Validation : %s exemples", len(df_validation))

    X_train = df_train[FEATURE_COLUMNS]
    y_train = df_train["target_consumption_kw"].astype("float32")

    X_val = df_validation[FEATURE_COLUMNS]
    y_val = df_validation["target_consumption_kw"].astype("float32")

    # Libérer les données sources volumineuses.
    del df_train, df_validation
    gc.collect()

    mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000"))
    mlflow.set_experiment(EXPERIMENT_NAME)

    pipeline = create_pipeline()

    # Ajuster les paramètres du RandomForestRegressor présent
    # dans le pipeline, sans modifier son prétraitement.
    rf_params = {
        key: value
        for key, value in pipeline.get_params().items()
        if key.endswith(("n_estimators", "max_depth", "min_samples_leaf", "n_jobs"))
    }

    updates = {}

    for key in rf_params:
        if key.endswith("n_estimators"):
            updates[key] = N_ESTIMATORS
        elif key.endswith("max_depth"):
            updates[key] = MAX_DEPTH
        elif key.endswith("min_samples_leaf"):
            updates[key] = MIN_SAMPLES_LEAF
        elif key.endswith("n_jobs"):
            updates[key] = 1

    if updates:
        pipeline.set_params(**updates)

    logger.info("Paramètres Random Forest : %s", updates)

    with mlflow.start_run(run_name=RUN_NAME):
        mlflow.log_params(
            {
                "model_type": "RandomForestRegressor",
                "training_days": 365,
                "forecast_horizon": 24,
                "n_estimators": N_ESTIMATORS,
                "max_depth": MAX_DEPTH,
                "min_samples_leaf": MIN_SAMPLES_LEAF,
                "n_jobs": 1,
                "random_state": RANDOM_STATE,
                "train_examples": len(X_train),
                "validation_examples": len(X_val),
                "sampling": "random_deterministic",
            }
        )

        logger.info("Début de l'entraînement")

        start = perf_counter()
        pipeline.fit(X_train, y_train)
        duration = perf_counter() - start

        logger.info(
            "Entraînement terminé en %.2f s",
            duration,
        )

        predictions = pipeline.predict(X_val)
        metrics = calculate_metrics(y_val, predictions)

        mlflow.log_metrics(
            {
                **metrics,
                "training_seconds": duration,
            }
        )

        logger.info("MAE : %.2f kW", metrics["mae_kw"])
        logger.info("RMSE : %.2f kW", metrics["rmse_kw"])
        logger.info("WAPE : %.2f %%", metrics["wape_pct"])

        logger.info("Enregistrement du modèle dans MLflow")

        model_info = mlflow.sklearn.log_model(
            sk_model=pipeline,
            name="model",
            registered_model_name=MODEL_NAME,
            skops_trusted_types=[
                "numpy.dtype",
                "sklearn.tree._tree.Tree",
            ],
        )

        initialize_champion(
            model_name=MODEL_NAME,
            version=model_info.registered_model_version,
        )

        # Traçabilité du dataset source sans conserver
        # les millions d'exemples supervisés.
        dataset = mlflow.data.from_pandas(
            df_hourly,
            source=DATASET_PATH.resolve().as_uri(),
            name="smart-energy-hourly-2025-2026",
        )

        mlflow.log_input(dataset, context="source")

        mlflow.set_tags(
            {
                "project": "smart-energy-optimizer",
                "algorithm": "random_forest",
                "model_scope": "global",
                "forecast_horizon": "24h",
                "training_period": "2025",
                "validation_period": "2026-Q1",
                "environment": os.getenv(
                    "TRAIN_ENVIRONMENT",
                    "development",
                ),
                "training_profile": "memory_optimized",
            }
        )

        logger.info("Expérience MLflow enregistrée")


if __name__ == "__main__":
    main()

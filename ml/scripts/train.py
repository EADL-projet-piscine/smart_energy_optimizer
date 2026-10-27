import logging
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

import mlflow
import mlflow.sklearn
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from smart_energy_ml.features.feature_engineering import (
    FEATURE_COLUMNS,
    build_supervised_dataset,
)
from smart_energy_ml.models.random_forest import create_pipeline

EXPERIMENT_NAME = "smart-energy-forecasting"
MODEL_NAME = "smart-energy-rf-global"
RUN_NAME = f"rf_365d_h24_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}"


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)

DATASET_PATH = Path("data/processed/readings_hourly_20250101_20260701.parquet")

TRAIN_END = pd.Timestamp("2026-01-01", tz="UTC")
VALIDATION_END = pd.Timestamp("2026-04-01", tz="UTC")


def calculate_metrics(y_true, y_pred) -> dict:
    actual = np.asarray(y_true)
    predicted = np.asarray(y_pred)

    denominator = np.abs(actual).sum()

    return {
        "mae_kw": float(mean_absolute_error(actual, predicted)),
        "rmse_kw": float(np.sqrt(mean_squared_error(actual, predicted))),
        "wape_pct": float(np.abs(actual - predicted).sum() / denominator * 100)
        if denominator > 0
        else float("nan"),
    }


def main() -> None:
    logger.info("Chargement du dataset horaire")

    df_hourly = pd.read_parquet(DATASET_PATH)

    logger.info("Construction des exemples supervisés")
    df = build_supervised_dataset(df_hourly)

    # Même stratégie que le notebook 09 :
    # conserver uniquement les exemples disposant
    # d'une référence hebdomadaire.
    # df = df.loc[df["target_lag_168h"].notna()].copy()

    logger.info("Découpage chronologique")

    df_train = df.loc[
        (df["forecast_origin"] >= TRAIN_END - pd.Timedelta(days=365))
        & (df["target_timestamp"] < TRAIN_END)
    ].copy()

    df_validation = df.loc[
        (df["forecast_origin"] >= TRAIN_END) & (df["target_timestamp"] < VALIDATION_END)
    ].copy()

    if df_train.empty or df_validation.empty:
        raise ValueError("Jeu d'entraînement ou de validation vide.")

    assert df_train["target_timestamp"].max() < TRAIN_END
    assert df_validation["target_timestamp"].min() >= TRAIN_END
    assert df_validation["target_timestamp"].max() < VALIDATION_END

    logger.info("Entraînement : %s exemples", len(df_train))
    logger.info("Validation : %s exemples", len(df_validation))

    X_train = df_train[FEATURE_COLUMNS]
    y_train = df_train["target_consumption_kw"]

    X_val = df_validation[FEATURE_COLUMNS]
    y_val = df_validation["target_consumption_kw"]

    # Stockage local des expériences.
    mlflow.set_tracking_uri("sqlite:///mlflow.db")
    mlflow.set_experiment(EXPERIMENT_NAME)

    pipeline = create_pipeline()

    with mlflow.start_run(run_name=RUN_NAME):
        mlflow.log_params(
            {
                "model_type": "RandomForestRegressor",
                "training_days": 365,
                "forecast_horizon": 24,
                "n_estimators": 50,
                "max_depth": 15,
                "min_samples_leaf": 10,
                "random_state": 42,
                "train_examples": len(df_train),
                "validation_examples": len(df_validation),
            }
        )

        logger.info("Début de l'entraînement")

        start = perf_counter()
        pipeline.fit(X_train, y_train)
        duration = perf_counter() - start

        logger.info("Entraînement terminé en %.2f s", duration)

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

        mlflow.sklearn.log_model(
            sk_model=pipeline,
            name="model",
            registered_model_name=MODEL_NAME,
            skops_trusted_types=[
                "numpy.dtype",
                "sklearn.tree._tree.Tree",
            ],
        )

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
                "environment": "development",
            }
        )

        logger.info("Expérience MLflow enregistrée")


if __name__ == "__main__":
    main()

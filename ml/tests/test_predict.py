import argparse
import json
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from scripts import predict

# ---------------------------------------------------------
# Fixtures
# ---------------------------------------------------------


@pytest.fixture
def sample_features():
    origin = pd.Timestamp("2026-10-26T23:00:00Z")

    rows = []

    for site_id, site_type in [
        ("SITE001", "office"),
        ("SITE002", "factory"),
    ]:
        for horizon in range(1, 25):
            target = origin + pd.Timedelta(hours=horizon)

            rows.append(
                {
                    "site_id": site_id,
                    "site_type": site_type,
                    "forecast_origin": origin,
                    "target_timestamp": target,
                    "horizon": horizon,
                    # Caractéristiques temporelles
                    "target_hour": target.hour,
                    "target_day_of_week": target.dayofweek,
                    "target_month": target.month,
                    "target_is_weekend": int(target.dayofweek >= 5),
                    # Caractéristiques historiques simulées
                    "lag_1h": 42.0,
                    "lag_24h": 40.0,
                    "rolling_mean_24h": 41.0,
                    "target_lag_168h": 39.0,
                    # Prédiction simulée
                    "predicted_consumption_kw": float(horizon),
                }
            )

    return pd.DataFrame(rows)


# ---------------------------------------------------------
# Origine des prévisions
# ---------------------------------------------------------


def test_parquet_without_date_has_no_origin():
    assert predict.get_forecast_origin(None, "parquet") is None


def test_explicit_date_has_previous_day_origin():
    origin = predict.get_forecast_origin(
        "2026-10-27",
        "api",
    )

    assert origin == pd.Timestamp("2026-10-26T23:00:00Z")


@pytest.mark.parametrize(
    "invalid_date",
    [
        "27-10-2026",
        "2026/10/27",
        "2026-02-30",
        "invalid",
        "2026-10-27T00:00:00",
    ],
)
def test_invalid_date_is_rejected(invalid_date):
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        predict.get_forecast_origin(invalid_date, "api")


def test_api_without_date_uses_current_utc_date():
    with patch.object(predict, "datetime") as mock_datetime:
        mock_datetime.now.return_value = datetime(2026, 10, 27, 12, tzinfo=UTC)

        origin = predict.get_forecast_origin(None, "api")

    assert origin == pd.Timestamp("2026-10-26T23:00:00Z")


# ---------------------------------------------------------
# Chargement des données
# ---------------------------------------------------------


def test_api_source_calls_inference_loader(tmp_path):
    origin = pd.Timestamp("2026-10-26T23:00:00Z")
    expected = pd.DataFrame({"site_id": ["SITE001"]})

    with (
        patch.object(
            predict,
            "load_inference_data",
            return_value=expected,
        ) as mock_loader,
        patch.object(
            predict,
            "RAW_INFERENCE_DIR",
            tmp_path,
        ),
    ):
        result = predict.load_hourly_data("api", origin)

    mock_loader.assert_called_once_with(
        forecast_origin=origin,
        raw_dir=tmp_path,
    )

    pd.testing.assert_frame_equal(result, expected)


def test_api_source_requires_origin():
    with pytest.raises(ValueError, match="origine"):
        predict.load_hourly_data("api", None)


def test_parquet_source_reads_file(tmp_path):
    parquet_path = tmp_path / "readings.parquet"
    parquet_path.touch()

    expected = pd.DataFrame({"site_id": ["SITE001"]})

    with (
        patch.object(predict, "DATASET_PATH", parquet_path),
        patch.object(
            predict.pd,
            "read_parquet",
            return_value=expected,
        ) as mock_read,
    ):
        result = predict.load_hourly_data("parquet", None)

    mock_read.assert_called_once_with(parquet_path)
    pd.testing.assert_frame_equal(result, expected)


def test_parquet_source_rejects_missing_file(tmp_path):
    missing_path = tmp_path / "missing.parquet"

    with patch.object(predict, "DATASET_PATH", missing_path), pytest.raises(FileNotFoundError):
        predict.load_hourly_data("parquet", None)


# ---------------------------------------------------------
# MLflow
# ---------------------------------------------------------


def test_explicit_model_version():
    assert predict.resolve_model_version(4) == 4


@pytest.mark.parametrize("version", [0, -1])
def test_invalid_model_version(version):
    with pytest.raises(ValueError, match="positive"):
        predict.resolve_model_version(version)


def test_champion_alias_resolves_model_version():
    with patch.object(predict, "MlflowClient") as mock_client:
        mock_client.return_value.get_model_version_by_alias.return_value.version = "7"

        version = predict.resolve_model_version(None)

    assert version == 7

    mock_client.return_value.get_model_version_by_alias.assert_called_once_with(
        predict.MODEL_NAME,
        "champion",
    )


# ---------------------------------------------------------
# Construction des résultats
# ---------------------------------------------------------


def test_build_results_groups_by_site(sample_features):
    results = predict.build_results(sample_features)

    assert len(results) == 2
    assert all(len(site["predictions"]) == 24 for site in results)
    assert {site["site_id"] for site in results} == {
        "SITE001",
        "SITE002",
    }


def test_build_results_sorts_horizons(sample_features):
    shuffled = sample_features.sample(
        frac=1,
        random_state=42,
    )

    results = predict.build_results(shuffled)

    for site in results:
        assert [item["horizon"] for item in site["predictions"]] == list(range(1, 25))


def test_build_results_rounds_predictions(sample_features):
    sample_features.loc[
        sample_features["horizon"] == 1,
        "predicted_consumption_kw",
    ] = 42.567

    results = predict.build_results(sample_features)

    assert results[0]["predictions"][0]["predicted_consumption_kw"] == 42.57


# ---------------------------------------------------------
# Validation des prévisions
# ---------------------------------------------------------


def test_validate_predictions_accepts_valid_data(sample_features):
    predict.validate_predictions(sample_features)


def test_validate_predictions_rejects_missing_horizon(sample_features):
    invalid = sample_features.loc[
        ~((sample_features["site_id"] == "SITE001") & (sample_features["horizon"] == 24))
    ]

    with pytest.raises(ValueError, match="incomplètes"):
        predict.validate_predictions(invalid)


def test_validate_predictions_rejects_duplicate_horizon(sample_features):
    invalid = sample_features.copy()

    invalid.loc[
        (invalid["site_id"] == "SITE001") & (invalid["horizon"] == 24),
        "horizon",
    ] = 23

    with pytest.raises(ValueError, match="incomplètes"):
        predict.validate_predictions(invalid)


def test_validate_predictions_rejects_wrong_timestamp(sample_features):
    invalid = sample_features.copy()

    invalid.loc[
        invalid["site_id"] == "SITE001",
        "target_timestamp",
    ] += pd.Timedelta(hours=1)

    with pytest.raises(ValueError, match="Timestamps"):
        predict.validate_predictions(invalid)


# ---------------------------------------------------------
# Export JSON
# ---------------------------------------------------------


def test_export_json_writes_valid_file(tmp_path):
    output_path = tmp_path / "predictions" / "forecast.json"
    data = [{"site_id": "SITE001", "value": 42.0}]

    predict.export_json(data, output_path)

    assert json.loads(output_path.read_text(encoding="utf-8")) == data

    assert not output_path.with_suffix(".json.tmp").exists()


def test_export_json_overwrites_existing_file(tmp_path):
    output_path = tmp_path / "forecast.json"

    predict.export_json([{"old": True}], output_path)
    predict.export_json([{"new": True}], output_path)

    assert json.loads(output_path.read_text(encoding="utf-8")) == [{"new": True}]


# ---------------------------------------------------------
# Pipeline complet
# ---------------------------------------------------------


def test_main_generates_both_json_exports(
    tmp_path,
    sample_features,
):
    features = sample_features.drop(columns=["predicted_consumption_kw"])

    model = MagicMock()
    model.predict.return_value = np.full(
        len(features),
        42.5,
    )

    args = argparse.Namespace(
        source="api",
        date="2026-10-27",
        model_version=4,
    )

    with (
        patch.object(predict, "parse_args", return_value=args),
        patch.object(
            predict,
            "load_hourly_data",
            return_value=pd.DataFrame(),
        ),
        patch.object(
            predict,
            "build_inference_features",
            return_value=features.copy(),
        ),
        patch.object(
            predict,
            "resolve_model_version",
            return_value=4,
        ),
        patch.object(
            predict.mlflow.sklearn,
            "load_model",
            return_value=model,
        ) as mock_load_model,
        patch.object(predict, "OUTPUT_DIR", tmp_path),
    ):
        predict.main()

    mock_load_model.assert_called_once_with(f"models:/{predict.MODEL_NAME}/4")

    forecast_path = tmp_path / "forecast_2026-10-27.json"
    db_path = tmp_path / "forecast_2026-10-27_db.json"

    assert forecast_path.exists()
    assert db_path.exists()

    forecast = json.loads(forecast_path.read_text(encoding="utf-8"))
    db_records = json.loads(db_path.read_text(encoding="utf-8"))

    assert len(forecast) == 2
    assert len(db_records) == 48

    assert all(record["model_version"] == 4 for record in db_records)


def test_main_rejects_invalid_predictions(
    tmp_path,
    sample_features,
):
    features = sample_features.drop(columns=["predicted_consumption_kw"])

    model = MagicMock()
    model.predict.return_value = np.full(
        len(features),
        np.nan,
    )

    args = argparse.Namespace(
        source="api",
        date="2026-10-27",
        model_version=4,
    )

    with (
        patch.object(predict, "parse_args", return_value=args),
        patch.object(
            predict,
            "load_hourly_data",
            return_value=pd.DataFrame(),
        ),
        patch.object(
            predict,
            "build_inference_features",
            return_value=features.copy(),
        ),
        patch.object(
            predict,
            "resolve_model_version",
            return_value=4,
        ),
        patch.object(
            predict.mlflow.sklearn,
            "load_model",
            return_value=model,
        ),
        patch.object(predict, "OUTPUT_DIR", tmp_path),
        pytest.raises(ValueError, match="invalides"),
    ):
        predict.main()

    assert not list(tmp_path.glob("*.json"))

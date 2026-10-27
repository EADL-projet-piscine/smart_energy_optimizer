from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import patch

import pandas as pd
import pytest

from smart_energy_ml.preprocessing.inference_data import (
    load_inference_data,
)

# ---------------------------------------------------------
# Fixtures
# ---------------------------------------------------------


@pytest.fixture
def forecast_origin():
    return pd.Timestamp("2026-10-26T23:00:00Z")


@pytest.fixture
def mock_pipeline():
    df_hourly = pd.DataFrame(
        {
            "site_id": ["SITE001"],
            "timestamp": [pd.Timestamp("2026-10-26T23:00:00Z")],
            "consumption_kw": [42.0],
        }
    )

    with (
        patch("smart_energy_ml.preprocessing.inference_data.collect_readings") as mock_collect,
        patch(
            "smart_energy_ml.preprocessing.inference_data.build_hourly_dataset",
            return_value=df_hourly,
        ) as mock_aggregate,
        patch(
            "smart_energy_ml.preprocessing.inference_data.validate_hourly_readings"
        ) as mock_validate,
    ):
        yield (
            mock_collect,
            mock_aggregate,
            mock_validate,
            df_hourly,
        )


# ---------------------------------------------------------
# Tests de validation
# ---------------------------------------------------------


def test_valid_origin_returns_dataframe(
    forecast_origin,
    tmp_path,
    mock_pipeline,
):
    _, _, _, expected_df = mock_pipeline

    result = load_inference_data(
        forecast_origin=forecast_origin,
        raw_dir=tmp_path,
    )

    pd.testing.assert_frame_equal(result, expected_df)


def test_naive_origin_is_rejected(tmp_path):
    origin = pd.Timestamp("2026-10-26 23:00:00")

    with pytest.raises(ValueError, match="fuseau horaire"):
        load_inference_data(origin, tmp_path)


def test_invalid_hour_is_rejected(tmp_path):
    origin = pd.Timestamp("2026-10-26T22:00:00Z")

    with pytest.raises(ValueError, match="23 h UTC"):
        load_inference_data(origin, tmp_path)


@pytest.mark.parametrize(
    "origin",
    [
        pd.Timestamp("2026-10-26T23:15:00Z"),
        pd.Timestamp("2026-10-26T23:00:30Z"),
        pd.Timestamp("2026-10-26T23:00:00.000001Z"),
    ],
)
def test_non_aligned_origin_is_rejected(origin, tmp_path):
    with pytest.raises(ValueError):
        load_inference_data(origin, tmp_path)


def test_non_utc_origin_is_normalized(
    tmp_path,
    mock_pipeline,
):
    mock_collect, _, _, _ = mock_pipeline

    origin = datetime(
        2026,
        10,
        27,
        0,
        0,
        tzinfo=timezone(timedelta(hours=1)),
    )

    load_inference_data(origin, tmp_path)

    kwargs = mock_collect.call_args.kwargs

    assert kwargs["end"] == datetime(
        2026,
        10,
        27,
        0,
        0,
        tzinfo=UTC,
    )


def test_history_below_eight_days_is_rejected(
    forecast_origin,
    tmp_path,
):
    with pytest.raises(ValueError, match="huit jours"):
        load_inference_data(
            forecast_origin,
            tmp_path,
            history_days=7,
        )


# ---------------------------------------------------------
# Fenêtre temporelle et orchestration
# ---------------------------------------------------------


def test_default_history_window(
    forecast_origin,
    tmp_path,
    mock_pipeline,
):
    mock_collect, _, _, _ = mock_pipeline

    load_inference_data(
        forecast_origin,
        tmp_path,
    )

    kwargs = mock_collect.call_args.kwargs

    assert kwargs["start"] == datetime(2026, 10, 19, tzinfo=UTC)
    assert kwargs["end"] == datetime(2026, 10, 27, tzinfo=UTC)
    assert kwargs["raw_dir"] == tmp_path
    assert kwargs["refresh_last_day"] is True


def test_custom_history_window(
    forecast_origin,
    tmp_path,
    mock_pipeline,
):
    mock_collect, _, _, _ = mock_pipeline

    load_inference_data(
        forecast_origin,
        tmp_path,
        history_days=10,
    )

    kwargs = mock_collect.call_args.kwargs

    assert kwargs["start"] == datetime(2026, 10, 17, tzinfo=UTC)
    assert kwargs["end"] == datetime(2026, 10, 27, tzinfo=UTC)


def test_aggregation_uses_same_period(
    forecast_origin,
    tmp_path,
    mock_pipeline,
):
    mock_collect, mock_aggregate, _, _ = mock_pipeline

    load_inference_data(
        forecast_origin,
        tmp_path,
    )

    collect_kwargs = mock_collect.call_args.kwargs
    aggregate_kwargs = mock_aggregate.call_args.kwargs

    assert aggregate_kwargs["start"] == collect_kwargs["start"]
    assert aggregate_kwargs["end"] == collect_kwargs["end"]
    assert set(aggregate_kwargs) == {"start", "end"}


def test_contract_validation_is_called(
    forecast_origin,
    tmp_path,
    mock_pipeline,
):
    _, _, mock_validate, expected_df = mock_pipeline

    load_inference_data(
        forecast_origin,
        tmp_path,
    )

    mock_validate.assert_called_once_with(expected_df)


# ---------------------------------------------------------
# Gestion des erreurs
# ---------------------------------------------------------


def test_collection_error_is_propagated(
    forecast_origin,
    tmp_path,
    mock_pipeline,
):
    mock_collect, mock_aggregate, _, _ = mock_pipeline

    mock_collect.side_effect = RuntimeError("EnerVision indisponible")

    with pytest.raises(
        RuntimeError,
        match="EnerVision indisponible",
    ):
        load_inference_data(
            forecast_origin,
            tmp_path,
        )

    mock_aggregate.assert_not_called()


def test_validation_error_is_propagated(
    forecast_origin,
    tmp_path,
    mock_pipeline,
):
    _, _, mock_validate, _ = mock_pipeline

    mock_validate.side_effect = ValueError("Contrat invalide")

    with pytest.raises(ValueError, match="Contrat invalide"):
        load_inference_data(
            forecast_origin,
            tmp_path,
        )

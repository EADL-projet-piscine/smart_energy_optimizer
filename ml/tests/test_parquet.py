from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import patch

import pandas as pd
import pytest

from smart_energy_ml.data_access.base import HourlyReadingsDataSource
from smart_energy_ml.data_access.contract import REQUIRED_COLUMNS
from smart_energy_ml.data_access.parquet import ParquetDataSource

START = datetime(2026, 10, 27, tzinfo=UTC)
END = datetime(2026, 10, 28, tzinfo=UTC)


@pytest.fixture
def parquet_path(tmp_path):
    """Crée un fichier factice pour tester l'accès au Parquet."""
    path = tmp_path / "readings.parquet"
    path.touch()
    return path


@pytest.fixture
def sample_readings():
    """Données horaires simulées conformes au contrat."""

    return pd.DataFrame(
        {
            "site_id": [
                "SITE002",
                "SITE001",
                "SITE001",
                "SITE001",
                "SITE002",
            ],
            "site_type": [
                "factory",
                "office",
                "office",
                "office",
                "factory",
            ],
            "timestamp": [
                "2026-10-27T12:00:00Z",
                "2026-10-28T00:00:00Z",
                "2026-10-27T00:00:00Z",
                "2026-10-26T23:00:00Z",
                "2026-10-27T01:00:00Z",
            ],
            "consumption_kw": [
                50.0,
                60.0,
                40.0,
                30.0,
                45.0,
            ],
            "valid_readings": [12, 12, 12, 12, 12],
            "total_readings": [12, 12, 12, 12, 12],
            "coverage_pct": [100.0, 100.0, 100.0, 100.0, 100.0],
            "extra_column": ["a", "b", "c", "d", "e"],
        }
    )


@pytest.fixture
def mock_parquet_loading(parquet_path, sample_readings):
    """Simule la lecture du fichier et la validation métier."""
    with (
        patch(
            "smart_energy_ml.data_access.parquet.pd.read_parquet",
            return_value=sample_readings.copy(),
        ) as mock_read,
        patch("smart_energy_ml.data_access.parquet.validate_hourly_readings") as mock_validate,
    ):
        yield mock_read, mock_validate


def test_parquet_source_implements_interface(parquet_path):
    source = ParquetDataSource(parquet_path)

    assert isinstance(source, HourlyReadingsDataSource)
    assert source.file_path == parquet_path


def test_load_hourly_readings_returns_dataframe(
    parquet_path,
    mock_parquet_loading,
):
    mock_read, _ = mock_parquet_loading

    result = ParquetDataSource(parquet_path).load_hourly_readings(START, END)

    mock_read.assert_called_once_with(parquet_path)
    assert isinstance(result, pd.DataFrame)
    assert len(result) == 3


def test_start_boundary_is_inclusive(
    parquet_path,
    mock_parquet_loading,
):
    result = ParquetDataSource(parquet_path).load_hourly_readings(START, END)

    assert pd.Timestamp("2026-10-27T00:00:00Z") in result["timestamp"].tolist()


def test_end_boundary_is_exclusive(
    parquet_path,
    mock_parquet_loading,
):
    result = ParquetDataSource(parquet_path).load_hourly_readings(START, END)

    assert pd.Timestamp("2026-10-28T00:00:00Z") not in result["timestamp"].tolist()


@pytest.mark.parametrize(
    ("start_date", "end_date"),
    [
        (datetime(2026, 10, 27), END),
        (START, datetime(2026, 10, 28)),
        (
            datetime(2026, 10, 27),
            datetime(2026, 10, 28),
        ),
    ],
)
def test_naive_dates_are_rejected(
    parquet_path,
    start_date,
    end_date,
):
    with pytest.raises(ValueError, match="fuseau horaire"):
        ParquetDataSource(parquet_path).load_hourly_readings(start_date, end_date)


@pytest.mark.parametrize(
    ("start_date", "end_date"),
    [
        (START, START),
        (END, START),
    ],
)
def test_invalid_period_is_rejected(
    parquet_path,
    start_date,
    end_date,
):
    with pytest.raises(ValueError, match="précéder"):
        ParquetDataSource(parquet_path).load_hourly_readings(start_date, end_date)


def test_missing_parquet_file_raises_error(tmp_path):
    source = ParquetDataSource(tmp_path / "missing.parquet")

    with pytest.raises(FileNotFoundError, match="introuvable"):
        source.load_hourly_readings(START, END)


def test_timestamps_are_normalized_to_utc(
    parquet_path,
    mock_parquet_loading,
):
    result = ParquetDataSource(parquet_path).load_hourly_readings(START, END)

    assert str(result["timestamp"].dt.tz) == "UTC"


def test_non_utc_boundaries_are_converted(
    parquet_path,
    mock_parquet_loading,
):
    # Le 27 octobre, Paris est en UTC+1.
    paris_tz = timezone(timedelta(hours=1))

    local_start = datetime(2026, 10, 27, 1, tzinfo=paris_tz)
    local_end = datetime(2026, 10, 28, 1, tzinfo=paris_tz)

    result = ParquetDataSource(parquet_path).load_hourly_readings(local_start, local_end)

    assert len(result) == 3


def test_extra_columns_are_removed(
    parquet_path,
    mock_parquet_loading,
):
    result = ParquetDataSource(parquet_path).load_hourly_readings(START, END)

    assert list(result.columns) == list(REQUIRED_COLUMNS)
    assert "extra_column" not in result.columns


def test_results_are_sorted_by_site_and_timestamp(
    parquet_path,
    mock_parquet_loading,
):
    result = ParquetDataSource(parquet_path).load_hourly_readings(START, END)

    expected_order = [
        ("SITE001", pd.Timestamp("2026-10-27T00:00:00Z")),
        ("SITE002", pd.Timestamp("2026-10-27T01:00:00Z")),
        ("SITE002", pd.Timestamp("2026-10-27T12:00:00Z")),
    ]

    actual_order = list(zip(result["site_id"], result["timestamp"]))

    assert actual_order == expected_order
    assert result.index.tolist() == [0, 1, 2]


def test_contract_validation_is_called(
    parquet_path,
    mock_parquet_loading,
):
    _, mock_validate = mock_parquet_loading

    result = ParquetDataSource(parquet_path).load_hourly_readings(START, END)

    mock_validate.assert_called_once()

    validated_df = mock_validate.call_args.args[0]
    pd.testing.assert_frame_equal(validated_df, result)


def test_contract_validation_error_is_propagated(
    parquet_path,
    mock_parquet_loading,
):
    _, mock_validate = mock_parquet_loading

    mock_validate.side_effect = ValueError("Couverture insuffisante")

    with pytest.raises(
        ValueError,
        match="Couverture insuffisante",
    ):
        ParquetDataSource(parquet_path).load_hourly_readings(START, END)


def test_empty_period_is_passed_to_contract(
    parquet_path,
    mock_parquet_loading,
):
    _, mock_validate = mock_parquet_loading

    future_start = datetime(2027, 1, 1, tzinfo=UTC)
    future_end = datetime(2027, 1, 2, tzinfo=UTC)

    result = ParquetDataSource(parquet_path).load_hourly_readings(future_start, future_end)

    assert result.empty
    mock_validate.assert_called_once()

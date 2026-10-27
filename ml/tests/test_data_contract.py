import pandas as pd
import pytest

from smart_energy_ml.data_access.contract import (
    DataContractError,
    validate_hourly_readings,
)


@pytest.fixture
def valid_hourly_data() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "site_id": ["SITE001", "SITE001", "SITE001"],
            "site_type": ["industrial", "industrial", "industrial"],
            "timestamp": pd.date_range(
                "2026-01-01",
                periods=3,
                freq="h",
                tz="UTC",
            ),
            "consumption_kw": [120.0, None, 125.0],
            "valid_readings": [12, 6, 9],
            "total_readings": [12, 12, 12],
            "coverage_pct": [100.0, 50.0, 75.0],
        }
    )


def test_valid_hourly_data(valid_hourly_data: pd.DataFrame) -> None:
    validate_hourly_readings(valid_hourly_data)


def test_missing_column(valid_hourly_data: pd.DataFrame) -> None:
    df = valid_hourly_data.drop(columns=["site_type"])

    with pytest.raises(DataContractError):
        validate_hourly_readings(df)


def test_duplicate_timestamp(valid_hourly_data: pd.DataFrame) -> None:
    df = pd.concat(
        [valid_hourly_data, valid_hourly_data.iloc[[0]]],
        ignore_index=True,
    )

    with pytest.raises(DataContractError):
        validate_hourly_readings(df)


def test_invalid_hour_with_consumption(
    valid_hourly_data: pd.DataFrame,
) -> None:
    df = valid_hourly_data.copy()
    df.loc[1, "consumption_kw"] = 150.0

    with pytest.raises(DataContractError):
        validate_hourly_readings(df)


def test_missing_hour(valid_hourly_data: pd.DataFrame) -> None:
    df = valid_hourly_data.drop(index=1)

    with pytest.raises(DataContractError):
        validate_hourly_readings(df)

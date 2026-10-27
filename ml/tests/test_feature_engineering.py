import numpy as np
import pandas as pd
import pytest

from smart_energy_ml.features.feature_engineering import (
    FEATURE_COLUMNS,
    HORIZONS,
    build_historical_features,
    build_inference_features,
    build_supervised_dataset,
)


@pytest.fixture
def hourly_data():
    """Dix jours de données horaires pour deux sites."""
    timestamps = pd.date_range(
        "2026-10-01",
        periods=240,
        freq="h",
        tz="UTC",
    )

    rows = []

    for site_id, site_type, offset in [
        ("SITE001", "office", 0),
        ("SITE002", "factory", 1000),
    ]:
        for index, timestamp in enumerate(timestamps):
            rows.append(
                {
                    "site_id": site_id,
                    "site_type": site_type,
                    "timestamp": timestamp,
                    "consumption_kw": float(index + offset),
                    "valid_readings": 12,
                }
            )

    return pd.DataFrame(rows)


def test_feature_columns_are_unique():
    assert len(FEATURE_COLUMNS) == len(set(FEATURE_COLUMNS))


def test_horizons_cover_next_24_hours():
    assert list(HORIZONS) == list(range(1, 25))


def test_historical_features_use_current_origin_value(hourly_data):
    result = build_historical_features(hourly_data)

    site = result.loc[result["site_id"] == "SITE001"]

    assert site.iloc[25]["lag_1h"] == 25.0


def test_historical_features_calculate_24h_lag(hourly_data):
    result = build_historical_features(hourly_data)

    site = result.loc[result["site_id"] == "SITE001"]

    assert pd.isna(site.iloc[23]["lag_24h"])
    assert site.iloc[24]["lag_24h"] == 0.0
    assert site.iloc[25]["lag_24h"] == 1.0


def test_historical_features_calculate_168h_lag(hourly_data):
    result = build_historical_features(hourly_data)

    site = result.loc[result["site_id"] == "SITE001"]

    assert pd.isna(site.iloc[167]["lag_168h"])
    assert site.iloc[168]["lag_168h"] == 0.0
    assert site.iloc[169]["lag_168h"] == 1.0


def test_rolling_mean_requires_24_hours(hourly_data):
    result = build_historical_features(hourly_data)

    site = result.loc[result["site_id"] == "SITE001"]

    assert pd.isna(site.iloc[22]["rolling_mean_24h"])

    assert site.iloc[23]["rolling_mean_24h"] == pytest.approx(np.mean(range(24)))


def test_historical_features_do_not_mix_sites(hourly_data):
    result = build_historical_features(hourly_data)

    site_1 = result.loc[result["site_id"] == "SITE001"]
    site_2 = result.loc[result["site_id"] == "SITE002"]

    assert site_1.iloc[24]["lag_24h"] == 0.0
    assert site_2.iloc[24]["lag_24h"] == 1000.0

    assert site_1.iloc[23]["rolling_mean_24h"] == pytest.approx(11.5)
    assert site_2.iloc[23]["rolling_mean_24h"] == pytest.approx(1011.5)


def test_historical_features_sort_unsorted_input(hourly_data):
    shuffled = hourly_data.sample(frac=1, random_state=42)

    result = build_historical_features(shuffled)

    expected = result.sort_values(["site_id", "timestamp"]).reset_index(drop=True)

    pd.testing.assert_frame_equal(result, expected)


def test_supervised_dataset_contains_all_horizons(hourly_data):
    result = build_supervised_dataset(hourly_data)

    assert set(result["horizon"]) == set(range(1, 25))
    assert result["target_consumption_kw"].notna().all()


def test_supervised_targets_are_future_values(hourly_data):
    result = build_supervised_dataset(hourly_data)

    row = result.loc[
        (result["site_id"] == "SITE001")
        & (result["forecast_origin"] == pd.Timestamp("2026-10-05T00:00:00Z"))
        & (result["horizon"] == 3)
    ].iloc[0]

    assert row["target_timestamp"] == pd.Timestamp("2026-10-05T03:00:00Z")
    assert row["target_consumption_kw"] == 99.0
    assert row["lag_1h"] == 96.0


def test_supervised_weekly_reference_uses_target_hour(hourly_data):
    result = build_supervised_dataset(hourly_data)

    row = result.loc[
        (result["site_id"] == "SITE001")
        & (result["forecast_origin"] == pd.Timestamp("2026-10-08T00:00:00Z"))
        & (result["horizon"] == 3)
    ].iloc[0]

    # Origine : index 168, cible : index 171.
    # Référence hebdomadaire : index 3.
    assert row["target_lag_168h"] == 3.0


def test_supervised_dataset_excludes_missing_targets(hourly_data):
    data = hourly_data.copy()

    mask = (data["site_id"] == "SITE001") & (
        data["timestamp"] == pd.Timestamp("2026-10-05T03:00:00Z")
    )
    data.loc[mask, "consumption_kw"] = np.nan

    result = build_supervised_dataset(data)

    matching = result.loc[
        (result["site_id"] == "SITE001")
        & (result["target_timestamp"] == pd.Timestamp("2026-10-05T03:00:00Z"))
    ]

    assert matching.empty


def test_supervised_calendar_features(hourly_data):
    result = build_supervised_dataset(hourly_data)

    row = result.loc[
        (result["site_id"] == "SITE001")
        & (result["target_timestamp"] == pd.Timestamp("2026-10-03T12:00:00Z"))
        & (result["horizon"] == 1)
    ].iloc[0]

    assert row["target_hour"] == 12
    assert row["target_day_of_week"] == 5
    assert row["target_month"] == 10
    assert row["target_is_weekend"] == 1


def test_inference_creates_24_forecasts_per_site(hourly_data):
    result = build_inference_features(hourly_data)

    assert len(result) == 48

    assert result.groupby("site_id").size().to_dict() == {
        "SITE001": 24,
        "SITE002": 24,
    }

    for _, site in result.groupby("site_id"):
        assert site["horizon"].tolist() == list(range(1, 25))


def test_inference_uses_latest_valid_origin(hourly_data):
    result = build_inference_features(hourly_data)

    expected_origin = pd.Timestamp("2026-10-10T23:00:00Z")

    assert (result["forecast_origin"] == expected_origin).all()


def test_inference_explicit_origin(hourly_data):
    origin = pd.Timestamp("2026-10-09T23:00:00Z")

    result = build_inference_features(
        hourly_data,
        forecast_origin=origin,
    )

    assert len(result) == 48
    assert (result["forecast_origin"] == origin).all()

    assert result["target_timestamp"].max() == (origin + pd.Timedelta(hours=24))


def test_inference_rejects_naive_origin(hourly_data):
    with pytest.raises(ValueError, match="fuseau horaire"):
        build_inference_features(
            hourly_data,
            forecast_origin=pd.Timestamp("2026-10-09 23:00:00"),
        )


def test_inference_rejects_unavailable_origin(hourly_data):
    with pytest.raises(ValueError, match="indisponible"):
        build_inference_features(
            hourly_data,
            forecast_origin=pd.Timestamp("2026-11-01T00:00:00Z"),
        )


def test_inference_rejects_site_without_valid_hours(hourly_data):
    data = hourly_data.copy()
    data.loc[data["site_id"] == "SITE002", "valid_readings"] = 0

    with pytest.raises(ValueError, match="SITE002"):
        build_inference_features(data)


def test_inference_skips_invalid_latest_hour(hourly_data):
    data = hourly_data.copy()

    latest = pd.Timestamp("2026-10-10T23:00:00Z")

    data.loc[
        (data["site_id"] == "SITE001") & (data["timestamp"] == latest),
        "valid_readings",
    ] = 8

    result = build_inference_features(data)

    site_1 = result.loc[result["site_id"] == "SITE001"]
    site_2 = result.loc[result["site_id"] == "SITE002"]

    assert (site_1["forecast_origin"] == pd.Timestamp("2026-10-10T22:00:00Z")).all()

    assert (site_2["forecast_origin"] == latest).all()


def test_inference_uses_correct_weekly_reference(hourly_data):
    origin = pd.Timestamp("2026-10-10T23:00:00Z")

    result = build_inference_features(
        hourly_data,
        forecast_origin=origin,
    )

    row = result.loc[(result["site_id"] == "SITE001") & (result["horizon"] == 1)].iloc[0]

    # Cible : 2026-10-11 00:00 UTC (index 240).
    # Une semaine avant : index 72.
    assert row["target_lag_168h"] == 72.0


def test_inference_does_not_use_future_values(hourly_data):
    origin = pd.Timestamp("2026-10-09T23:00:00Z")

    baseline = build_inference_features(
        hourly_data,
        forecast_origin=origin,
    )

    modified = hourly_data.copy()

    modified.loc[
        modified["timestamp"] > origin,
        "consumption_kw",
    ] = 999999.0

    result = build_inference_features(
        modified,
        forecast_origin=origin,
    )

    pd.testing.assert_frame_equal(result, baseline)


def test_inference_outputs_expected_features(hourly_data):
    result = build_inference_features(hourly_data)

    assert set(FEATURE_COLUMNS).issubset(result.columns)
    assert "target_consumption_kw" not in result.columns

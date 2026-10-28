from copy import deepcopy

import pytest

from smart_energy_ml.data_access.forecast_repository import (
    MODEL_NAME,
    prepare_forecast_records,
)

# ---------------------------------------------------------
# Fixtures
# ---------------------------------------------------------


@pytest.fixture
def sample_results():
    return [
        {
            "site_id": "SITE001",
            "site_type": "office",
            "forecast_origin": "2026-10-26T23:00:00+00:00",
            "predictions": [
                {
                    "timestamp": (f"2026-10-27T{hour:02d}:00:00+00:00"),
                    "horizon": hour + 1,
                    "predicted_consumption_kw": 50.0 + hour,
                }
                for hour in range(24)
            ],
        }
    ]


# ---------------------------------------------------------
# Transformation des données
# ---------------------------------------------------------


def test_single_site_produces_24_records(sample_results):
    records = prepare_forecast_records(
        sample_results,
        model_version=4,
    )

    assert len(records) == 24


def test_seven_sites_produce_168_records(sample_results):
    results = []

    for index in range(1, 8):
        site = deepcopy(sample_results[0])
        site["site_id"] = f"SITE{index:03d}"
        results.append(site)

    records = prepare_forecast_records(
        results,
        model_version=4,
    )

    assert len(records) == 168
    assert len({record["site_id"] for record in records}) == 7


def test_model_metadata_is_preserved(sample_results):
    records = prepare_forecast_records(
        sample_results,
        model_version=12,
    )

    assert all(record["model_name"] == MODEL_NAME for record in records)

    assert all(record["model_version"] == 12 for record in records)


@pytest.mark.parametrize("model_version", [0, -1, -10])
def test_invalid_model_version_is_rejected(
    sample_results,
    model_version,
):
    with pytest.raises(ValueError, match="supérieure à zéro"):
        prepare_forecast_records(
            sample_results,
            model_version=model_version,
        )


def test_empty_results_return_empty_list():
    records = prepare_forecast_records(
        [],
        model_version=4,
    )

    assert records == []


def test_forecast_values_are_preserved(sample_results):
    records = prepare_forecast_records(
        sample_results,
        model_version=4,
    )

    first = records[0]
    last = records[-1]

    assert first["forecast_origin"] == ("2026-10-26T23:00:00+00:00")
    assert first["target_timestamp"] == ("2026-10-27T00:00:00+00:00")
    assert first["horizon"] == 1
    assert first["predicted_consumption_kw"] == 50.0

    assert last["horizon"] == 24
    assert last["predicted_consumption_kw"] == 73.0


def test_records_have_expected_structure(sample_results):
    records = prepare_forecast_records(
        sample_results,
        model_version=4,
    )

    expected_columns = {
        "site_id",
        "site_type",
        "forecast_origin",
        "target_timestamp",
        "horizon",
        "predicted_consumption_kw",
        "model_name",
        "model_version",
    }

    for record in records:
        assert set(record.keys()) == expected_columns


def test_sites_remain_independent(sample_results):
    site_1 = deepcopy(sample_results[0])
    site_2 = deepcopy(sample_results[0])

    site_2["site_id"] = "SITE002"
    site_2["site_type"] = "factory"

    records = prepare_forecast_records(
        [site_1, site_2],
        model_version=4,
    )

    site_1_records = [record for record in records if record["site_id"] == "SITE001"]

    site_2_records = [record for record in records if record["site_id"] == "SITE002"]

    assert len(site_1_records) == 24
    assert len(site_2_records) == 24

    assert all(record["site_type"] == "office" for record in site_1_records)

    assert all(record["site_type"] == "factory" for record in site_2_records)


def test_input_results_are_not_modified(sample_results):
    original = deepcopy(sample_results)

    prepare_forecast_records(
        sample_results,
        model_version=4,
    )

    assert sample_results == original

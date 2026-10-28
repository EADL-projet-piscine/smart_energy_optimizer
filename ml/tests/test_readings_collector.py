import json
from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from smart_energy_ml.ingestion.readings_collector import (
    READINGS_PER_DAY,
    SITE_IDS,
    collect_readings,
    validate_period,
)

# ---------------------------------------------------------
# Fixtures
# ---------------------------------------------------------


@pytest.fixture
def period():
    return (
        datetime(2026, 10, 20, tzinfo=UTC),
        datetime(2026, 10, 22, tzinfo=UTC),
    )


@pytest.fixture
def mock_client():
    with patch("smart_energy_ml.ingestion.readings_collector.EnerVisionClient") as client_class:
        client = MagicMock()

        client.get_readings.return_value = [
            {
                "site_id": "SITE001",
                "site_type": "office",
                "timestamp": "2026-10-20T00:00:00Z",
                "consumption_kw": 42.5,
            }
        ]

        client_class.return_value.__enter__.return_value = client

        yield client


# ---------------------------------------------------------
# Validation des périodes
# ---------------------------------------------------------


def test_validate_period_accepts_valid_utc_period(period):
    start, end = period

    validate_period(start, end)


def test_validate_period_rejects_naive_dates():
    start = datetime(2026, 10, 20)
    end = datetime(2026, 10, 22, tzinfo=UTC)

    with pytest.raises(ValueError, match="timezone-aware"):
        validate_period(start, end)


def test_validate_period_rejects_non_utc_timezone():
    start = datetime(
        2026,
        10,
        20,
        tzinfo=timezone(timedelta(hours=2)),
    )
    end = datetime(2026, 10, 22, tzinfo=UTC)

    with pytest.raises(ValueError, match="UTC"):
        validate_period(start, end)


def test_validate_period_rejects_invalid_order():
    start = datetime(2026, 10, 22, tzinfo=UTC)
    end = datetime(2026, 10, 20, tzinfo=UTC)

    with pytest.raises(ValueError, match="précéder"):
        validate_period(start, end)


def test_validate_period_rejects_non_midnight_start():
    start = datetime(2026, 10, 20, 15, tzinfo=UTC)
    end = datetime(2026, 10, 22, tzinfo=UTC)

    with pytest.raises(ValueError, match="minuit"):
        validate_period(start, end)


def test_validate_period_rejects_non_midnight_end():
    start = datetime(2026, 10, 20, tzinfo=UTC)
    end = datetime(2026, 10, 22, 15, tzinfo=UTC)

    with pytest.raises(ValueError, match="minuit"):
        validate_period(start, end)


# ---------------------------------------------------------
# Collecte et écriture des fichiers
# ---------------------------------------------------------


def test_collect_readings_calls_api_per_site_and_day(
    tmp_path,
    period,
    mock_client,
):
    start, end = period

    collect_readings(start, end, tmp_path)

    # 7 sites × 2 jours.
    assert mock_client.get_readings.call_count == 14

    for call in mock_client.get_readings.call_args_list:
        assert call.kwargs["limit"] == READINGS_PER_DAY
        assert call.kwargs["end"] - call.kwargs["start"] == timedelta(days=1)

    for site_id in SITE_IDS:
        assert (tmp_path / site_id / f"{site_id}_20261020.json").exists()

        assert (tmp_path / site_id / f"{site_id}_20261021.json").exists()


def test_collect_readings_reuses_cache(
    tmp_path,
    period,
    mock_client,
):
    start, end = period

    collect_readings(start, end, tmp_path)

    mock_client.get_readings.reset_mock()

    collect_readings(start, end, tmp_path)

    mock_client.get_readings.assert_not_called()


def test_collect_readings_refreshes_all_days(
    tmp_path,
    period,
    mock_client,
):
    start, end = period

    collect_readings(start, end, tmp_path)

    mock_client.get_readings.reset_mock()

    collect_readings(
        start,
        end,
        tmp_path,
        refresh=True,
    )

    assert mock_client.get_readings.call_count == 14


def test_collect_readings_refreshes_only_last_day(
    tmp_path,
    period,
    mock_client,
):
    start, end = period

    collect_readings(start, end, tmp_path)

    mock_client.get_readings.reset_mock()

    collect_readings(
        start,
        end,
        tmp_path,
        refresh_last_day=True,
    )

    assert mock_client.get_readings.call_count == 7

    for call in mock_client.get_readings.call_args_list:
        assert call.kwargs["start"].date().isoformat() == "2026-10-21"


def test_collect_readings_rejects_empty_api_response(
    tmp_path,
    period,
    mock_client,
):
    start, end = period

    mock_client.get_readings.return_value = []

    with pytest.raises(ValueError, match="Aucune mesure"):
        collect_readings(start, end, tmp_path)

    assert not list(tmp_path.rglob("*.json"))


def test_collect_readings_propagates_api_error(
    tmp_path,
    period,
    mock_client,
):
    start, end = period

    mock_client.get_readings.side_effect = RuntimeError("API indisponible")

    with pytest.raises(RuntimeError, match="API indisponible"):
        collect_readings(start, end, tmp_path)


def test_collect_readings_writes_valid_json(
    tmp_path,
    period,
    mock_client,
):
    start, end = period

    collect_readings(start, end, tmp_path)

    output_path = tmp_path / "SITE001" / "SITE001_20261020.json"

    payload = json.loads(output_path.read_text(encoding="utf-8"))

    assert payload["site_id"] == "SITE001"
    assert payload["period_start"] == start.isoformat()
    assert payload["readings"][0]["consumption_kw"] == 42.5

    # Aucun fichier temporaire ne doit subsister.
    assert not list(tmp_path.rglob("*.json.tmp"))

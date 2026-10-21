from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from smart_energy_app.consommation.service import state
from smart_energy_app.main import app

SUMMARY = {
    "timestamp": "2026-10-21T09:34:44.744410",
    "total_sites": 7,
    "total_consumption_kw": 3597.64,
    "sites": [
        {
            "site_id": "SITE003",
            "site_name": "Data Center Marseille",
            "current_consumption_kw": 766.34,
            "capacity_kw": 800,
            "load_percent": 95.8,
            "data_quality": "partial",
        },
    ],
}


@pytest.fixture(autouse=True)
def clean_state():
    """Remet l'état à zéro avant et après chaque test."""
    state.data = None
    state.fetched_at = None
    yield
    state.data = None
    state.fetched_at = None


def test_returns_503_without_data():
    with TestClient(app) as client:
        response = client.get("/api/consommation/resume")

    assert response.status_code == 503


def test_relays_full_response():
    state.data = SUMMARY
    state.fetched_at = datetime.now(UTC)

    with TestClient(app) as client:
        response = client.get("/api/consommation/resume")

    assert response.status_code == 200
    body = response.json()
    assert body["data"] == SUMMARY
    assert body["data"]["sites"][0]["data_quality"] == "partial"
    assert body["stale"] is False


def test_flags_stale_data():
    state.data = SUMMARY
    state.fetched_at = datetime.now(UTC) - timedelta(minutes=10)

    with TestClient(app) as client:
        response = client.get("/api/consommation/resume")

    assert response.status_code == 200
    assert response.json()["stale"] is True

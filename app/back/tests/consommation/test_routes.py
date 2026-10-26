from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from smart_energy_app.config import settings
from smart_energy_app.consommation.details import state as details_state
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

SITE_DETAIL = {
    "site_id": "SITE001",
    "data_quality": "good",
    "null_reasons": [],
    "voltage_v": 405.8,
    "temperature_celsius": 7.8,
}


@pytest.fixture(autouse=True)
def clean_state():
    """Remet les deux états à zéro avant et après chaque test.

    `state` et `details_state` sont des singletons de module : un test qui en
    laisse un rempli contamine le suivant.
    """
    state.data = None
    state.fetched_at = None
    details_state.by_site = {}
    details_state.site_ids = []

    yield

    state.data = None
    state.fetched_at = None
    details_state.by_site = {}
    details_state.site_ids = []


@pytest.fixture
def details():
    """Deux sites au référentiel, dont un seul a réellement répondu."""
    details_state.site_ids = ["SITE001", "SITE002"]
    details_state.by_site = {
        "SITE001": {"data": SITE_DETAIL, "fetched_at": datetime.now(UTC)},
    }
    return details_state


def test_returns_503_without_data():
    with TestClient(app) as client:
        response = client.get("/api/consommations")

    assert response.status_code == 503


def test_relays_full_response():
    state.data = SUMMARY
    state.fetched_at = datetime.now(UTC)

    with TestClient(app) as client:
        response = client.get("/api/consommations")

    assert response.status_code == 200
    body = response.json()
    assert body["data"] == SUMMARY
    assert body["data"]["sites"][0]["data_quality"] == "partial"
    assert body["stale"] is False


def test_flags_stale_data():
    state.data = SUMMARY
    state.fetched_at = datetime.now(UTC) - timedelta(minutes=10)

    with TestClient(app) as client:
        response = client.get("/api/consommations")

    assert response.status_code == 200
    assert response.json()["stale"] is True


def test_announces_next_measurement(monkeypatch):
    """next_at doit refléter la cadence réelle : c'est dessus que le client se cale."""
    monkeypatch.setattr(settings, "consumption_refresh_s", 30)
    state.data = SUMMARY
    state.fetched_at = datetime.now(UTC)

    with TestClient(app) as client:
        body = client.get("/api/consommations").json()

    ecart = datetime.fromisoformat(body["next_at"]) - datetime.fromisoformat(body["fetched_at"])
    assert ecart == timedelta(seconds=30)


def test_sites_returns_every_known_detail(details):
    response = TestClient(app).get("/api/consommations/sites")

    assert response.status_code == 200
    assert "SITE001" in response.json()["sites"]


def test_sites_answers_503_before_the_first_refresh():
    response = TestClient(app).get("/api/consommations/sites")

    assert response.status_code == 503


def test_site_relays_the_payload_untouched(details):
    """Aucun champ n'est filtré : c'est tout l'intérêt de cet endpoint."""
    response = TestClient(app).get("/api/consommations/sites/SITE001")

    assert response.status_code == 200
    body = response.json()
    assert body["data"] == SITE_DETAIL
    assert body["data"]["data_quality"] == "good"
    assert body["stale"] is False


def test_unknown_site_answers_404(details):
    """Un identifiant inconnu est une erreur du client, pas une panne."""
    response = TestClient(app).get("/api/consommations/sites/SITE999")

    assert response.status_code == 404
    assert "SITE999" in response.json()["detail"]


def test_known_site_without_measure_answers_503(details):
    """SITE002 est au référentiel mais n'a jamais répondu : ce n'est pas un 404."""
    response = TestClient(app).get("/api/consommations/sites/SITE002")

    assert response.status_code == 503

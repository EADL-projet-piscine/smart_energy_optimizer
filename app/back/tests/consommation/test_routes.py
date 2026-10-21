from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from smart_energy_app.consommation.service import state
from smart_energy_app.main import app

RESUME = {
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
def etat_vierge():
    """Remet l'état à zéro avant et après chaque test."""
    state.data = None
    state.fetched_at = None
    yield
    state.data = None
    state.fetched_at = None


def test_renvoie_503_tant_qu_aucune_mesure_n_a_ete_recuperee():
    with TestClient(app) as client:
        reponse = client.get("/api/consommation/resume")

    assert reponse.status_code == 503


def test_relaie_la_reponse_sans_filtrer_de_champs():
    state.data = RESUME
    state.fetched_at = datetime.now(UTC)

    with TestClient(app) as client:
        reponse = client.get("/api/consommation/resume")

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["data"] == RESUME
    assert corps["data"]["sites"][0]["data_quality"] == "partial"
    assert corps["stale"] is False


def test_signale_une_mesure_perimee():
    state.data = RESUME
    state.fetched_at = datetime.now(UTC) - timedelta(minutes=10)

    with TestClient(app) as client:
        reponse = client.get("/api/consommation/resume")

    assert reponse.status_code == 200
    assert reponse.json()["stale"] is True

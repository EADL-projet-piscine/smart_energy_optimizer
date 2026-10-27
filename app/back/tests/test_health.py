import time

import pytest
from fastapi.testclient import TestClient

from smart_energy_app import db
from smart_energy_app.main import app

# Address reserved for documentation (RFC 5737): never routed, the connection never answers.
UNREACHABLE_URL = "postgresql+psycopg://192.0.2.1:5432/enervision"


def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.db
def test_health_reports_database_available():
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_reports_database_unreachable(monkeypatch):
    monkeypatch.setattr(db, "engine", db.creer_moteur(UNREACHABLE_URL))
    with TestClient(app) as client:
        start = time.perf_counter()
        response = client.get("/health")
        elapsed = time.perf_counter() - start
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "indisponible"}
    assert elapsed < 5

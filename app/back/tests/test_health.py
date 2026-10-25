import time

import pytest
from fastapi.testclient import TestClient

from smart_energy_app import db
from smart_energy_app.main import app

# Adresse réservée à la documentation (RFC 5737) : jamais routée, la connexion ne répond pas.
URL_INJOIGNABLE = "postgresql+psycopg://192.0.2.1:5432/enervision"


def test_health():
    with TestClient(app) as client:
        reponse = client.get("/health")
    assert reponse.status_code == 200
    assert reponse.json()["status"] == "ok"


@pytest.mark.db
def test_health_base_disponible():
    with TestClient(app) as client:
        reponse = client.get("/health")
    assert reponse.status_code == 200
    assert reponse.json() == {"status": "ok", "database": "ok"}


def test_health_base_injoignable(monkeypatch):
    monkeypatch.setattr(db, "engine", db.creer_moteur(URL_INJOIGNABLE))
    with TestClient(app) as client:
        debut = time.perf_counter()
        reponse = client.get("/health")
        duree = time.perf_counter() - debut
    assert reponse.status_code == 200
    assert reponse.json() == {"status": "ok", "database": "indisponible"}
    assert duree < 5

from fastapi.testclient import TestClient

from smart_energy_app.main import app


def test_health():
    with TestClient(app) as client:
        reponse = client.get("/health")
    assert reponse.status_code == 200
    assert reponse.json()["status"] == "ok"

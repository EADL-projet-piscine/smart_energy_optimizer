from fastapi.testclient import TestClient

from smart_energy_app.main import app

client = TestClient(app)


def test_health():
    reponse = client.get("/health")
    assert reponse.status_code == 200
    assert reponse.json() == {"status": "ok"}

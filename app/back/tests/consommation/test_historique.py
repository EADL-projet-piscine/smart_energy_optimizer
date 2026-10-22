import asyncio
import json
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar
from urllib.parse import parse_qsl, urlparse

import pytest
from fastapi.testclient import TestClient

from smart_energy_app.config import settings
from smart_energy_app.consommation.historique import load_history
from smart_energy_app.main import app

# Deux sites, deux points chacun, dans le désordre chronologique.
READINGS = [
    {
        "site_id": "SITE002",
        "timestamp": "2026-10-21T11:00:00Z",
        "consumption_kw": 20.0,
        "data_quality": "good",
    },
    {
        "site_id": "SITE001",
        "timestamp": "2026-10-21T11:00:00Z",
        "consumption_kw": None,
        "data_quality": "critical",
    },
    {
        "site_id": "SITE001",
        "timestamp": "2026-10-21T10:00:00Z",
        "consumption_kw": 10.0,
        "data_quality": "good",
    },
    {
        "site_id": "SITE002",
        "timestamp": "2026-10-21T10:00:00Z",
        "consumption_kw": 21.5,
        "data_quality": "partial",
    },
]


class FakeServer(BaseHTTPRequestHandler):
    code = 200
    body: ClassVar[list[dict]] = READINGS
    last_query: ClassVar[dict[str, str]] = {}

    def log_message(self, *args):
        pass

    def do_GET(self):
        FakeServer.last_query = dict(parse_qsl(urlparse(self.path).query))
        self.send_response(FakeServer.code)
        body = json.dumps(FakeServer.body).encode()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def fake_api(monkeypatch):
    """Lance un serveur local qui imite /api/v1/readings, le temps du test."""
    server = HTTPServer(("127.0.0.1", 0), FakeServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    monkeypatch.setattr(settings, "enervision_api_url", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setattr(settings, "history_site_count", 2)
    FakeServer.code = 200
    FakeServer.body = READINGS
    FakeServer.last_query = {}

    yield FakeServer

    server.shutdown()


def test_groups_by_site(fake_api):
    historique = asyncio.run(load_history())

    assert sorted(historique["sites"]) == ["SITE001", "SITE002"]
    assert len(historique["sites"]["SITE001"]) == 2


def test_keeps_null_values(fake_api):
    """Une mesure absente reste None : zéro serait une mesure, pas une absence."""
    historique = asyncio.run(load_history())

    valeurs = [point["consumption_kw"] for point in historique["sites"]["SITE001"]]
    assert None in valeurs
    assert 0 not in valeurs


def test_sorts_chronologically(fake_api):
    historique = asyncio.run(load_history())

    horodatages = [point["timestamp"] for point in historique["sites"]["SITE001"]]
    assert horodatages == ["2026-10-21T10:00:00Z", "2026-10-21T11:00:00Z"]


def test_window_is_naive_utc_in_the_past(fake_api):
    """L'API source raisonne en UTC et refuse toute borne dans le futur."""
    asyncio.run(load_history())

    start = datetime.fromisoformat(fake_api.last_query["start_time"])
    end = datetime.fromisoformat(fake_api.last_query["end_time"])

    assert start.tzinfo is None
    assert end.tzinfo is None
    assert end < datetime.now(UTC).replace(tzinfo=None)
    assert end - start == timedelta(hours=settings.history_hours)


def test_limit_gives_hourly_step(fake_api):
    """`limit` ne plafonne pas, il fixe le pas : heures × sites donne du horaire."""
    asyncio.run(load_history())

    attendu = settings.history_hours * settings.history_site_count
    assert int(fake_api.last_query["limit"]) == attendu


def test_warns_on_short_series(fake_api, caplog):
    with caplog.at_level("WARNING"):
        asyncio.run(load_history())

    assert "SITE001" in caplog.text
    assert str(settings.history_hours) in caplog.text


def test_warns_on_missing_site(fake_api, monkeypatch, caplog):
    monkeypatch.setattr(settings, "history_site_count", 7)

    with caplog.at_level("WARNING"):
        asyncio.run(load_history())

    assert "2 sites reçus, 7 attendus" in caplog.text


def test_route_502_when_source_refuses(fake_api):
    """L'API a répondu mais a refusé : erreur franche, aucune donnée de repli."""
    fake_api.code = 500

    response = TestClient(app).get("/api/consommation/historique")

    assert response.status_code == 502
    assert "sites" not in response.json()


def test_route_503_when_source_unreachable(monkeypatch):
    monkeypatch.setattr(settings, "enervision_api_url", "http://127.0.0.1:1")

    response = TestClient(app).get("/api/consommation/historique")

    assert response.status_code == 503
    assert "sites" not in response.json()

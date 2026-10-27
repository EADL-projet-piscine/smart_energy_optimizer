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

# Two sites, two points each, out of chronological order.
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
    """Run a local server mimicking /api/v1/readings for the duration of the test."""
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
    history = asyncio.run(load_history())

    assert sorted(history["sites"]) == ["SITE001", "SITE002"]
    assert len(history["sites"]["SITE001"]) == 2


def test_keeps_null_values(fake_api):
    """A missing reading stays None: zero would be a reading, not an absence."""
    history = asyncio.run(load_history())

    values = [point["consumption_kw"] for point in history["sites"]["SITE001"]]
    assert None in values
    assert 0 not in values


def test_sorts_chronologically(fake_api):
    history = asyncio.run(load_history())

    timestamps = [point["timestamp"] for point in history["sites"]["SITE001"]]
    assert timestamps == ["2026-10-21T10:00:00Z", "2026-10-21T11:00:00Z"]


def test_window_is_naive_utc_in_the_past(fake_api):
    """The source API works in UTC and rejects any bound in the future."""
    asyncio.run(load_history())

    start = datetime.fromisoformat(fake_api.last_query["start_time"])
    end = datetime.fromisoformat(fake_api.last_query["end_time"])

    assert start.tzinfo is None
    assert end.tzinfo is None
    assert end < datetime.now(UTC).replace(tzinfo=None)
    assert end - start == timedelta(hours=settings.history_hours)


def test_limit_gives_hourly_step(fake_api):
    """`limit` does not cap, it sets the step: hours x sites yields hourly points."""
    asyncio.run(load_history())

    expected = settings.history_hours * settings.history_site_count
    assert int(fake_api.last_query["limit"]) == expected


def test_warns_on_short_series(fake_api, caplog):
    with caplog.at_level("WARNING"):
        asyncio.run(load_history())

    assert "SITE001" in caplog.text
    assert str(settings.history_hours) in caplog.text


def test_warns_on_missing_site(fake_api, monkeypatch, caplog):
    monkeypatch.setattr(settings, "history_site_count", 7)

    with caplog.at_level("WARNING"):
        asyncio.run(load_history())

    # The source logs in French; matching its own wording is the point of the assertion.
    assert "2 sites reçus, 7 attendus" in caplog.text


def test_route_502_when_source_refuses(fake_api):
    """The API answered but refused: a clear error, never fallback data."""
    fake_api.code = 500

    response = TestClient(app).get("/api/consommations/historique")

    assert response.status_code == 502
    assert "sites" not in response.json()


def test_route_503_when_source_unreachable(monkeypatch):
    monkeypatch.setattr(settings, "enervision_api_url", "http://127.0.0.1:1")

    response = TestClient(app).get("/api/consommations/historique")

    assert response.status_code == 503
    assert "sites" not in response.json()

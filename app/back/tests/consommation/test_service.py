import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from smart_energy_app.config import settings
from smart_energy_app.consommation import planificateur
from smart_energy_app.consommation.service import refresh, state

SUMMARY = {
    "total_sites": 7,
    "sites": [{"site_id": "SITE001", "data_quality": "good"}],
}


class FakeServer(BaseHTTPRequestHandler):
    code = 200

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(FakeServer.code)
        body = json.dumps(SUMMARY).encode()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def fake_api():
    """Run a local server mimicking the source API for the duration of the test."""
    server = HTTPServer(("127.0.0.1", 0), FakeServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    original_url = settings.enervision_api_url
    settings.enervision_api_url = f"http://127.0.0.1:{server.server_port}"
    FakeServer.code = 200
    state.data = None
    state.fetched_at = None

    yield FakeServer

    settings.enervision_api_url = original_url
    server.shutdown()
    state.data = None
    state.fetched_at = None


def test_stores_response(fake_api):
    assert asyncio.run(refresh()) is True
    assert state.data == SUMMARY
    assert state.is_stale() is False


def test_keeps_last_value_on_error(fake_api):
    asyncio.run(refresh())
    initial_timestamp = state.fetched_at

    fake_api.code = 500
    assert asyncio.run(refresh()) is False

    assert state.data == SUMMARY
    assert state.fetched_at == initial_timestamp


def test_logs_error_code(fake_api, caplog):
    fake_api.code = 503

    with caplog.at_level("WARNING"):
        result = asyncio.run(refresh())

    assert result is False
    assert "503" in caplog.text


def test_loop_interval(monkeypatch):
    """The loop must call refresh() at the configured cadence."""
    monkeypatch.setattr(settings, "consumption_refresh_s", 0.01)

    calls = []

    async def fake_refresh():
        calls.append(1)
        return True

    async def fake_refresh_details():
        return True

    monkeypatch.setattr(planificateur, "refresh", fake_refresh)
    # The loop also loads the site details: without this stand-in, the test
    # reaches the real network and runs a single cycle.
    monkeypatch.setattr(planificateur, "refresh_details", fake_refresh_details)

    async def scenario():
        task = asyncio.create_task(planificateur.refresh_loop())
        await asyncio.sleep(0.06)
        task.cancel()

    asyncio.run(scenario())

    assert len(calls) >= 3

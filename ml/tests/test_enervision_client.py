import base64
import json
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient

READINGS = [
    {"site_id": "SITE001", "timestamp": "2026-10-21T08:00:00", "consumption_kw": 81.41},
    {"site_id": "SITE001", "timestamp": "2026-10-21T08:15:00", "consumption_kw": 82.19},
]


class FakeServer(BaseHTTPRequestHandler):
    """Mimics the EnerVision API and records the last request it received."""

    code = 200
    payload: object = READINGS
    last_path = None
    last_query = None
    last_headers = None

    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urlsplit(self.path)
        FakeServer.last_path = url.path
        FakeServer.last_query = parse_qs(url.query)
        FakeServer.last_headers = self.headers

        body = json.dumps(FakeServer.payload).encode()
        self.send_response(FakeServer.code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    """Ignores the settings a local ml/.env may have loaded."""
    for name in ("ENERVISION_API_URL", "ENERVISION_API_USERNAME", "ENERVISION_API_PASSWORD"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def fake_api():
    """Starts a local server that mimics the EnerVision API and yields its URL."""
    server = HTTPServer(("127.0.0.1", 0), FakeServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FakeServer.code = 200
    FakeServer.payload = READINGS
    FakeServer.last_path = None
    FakeServer.last_query = None
    FakeServer.last_headers = None

    yield f"http://127.0.0.1:{server.server_port}"

    server.shutdown()
    server.server_close()


def test_returns_readings(fake_api):
    with EnerVisionClient(fake_api) as client:
        readings = client.get_readings()

    assert readings == READINGS
    assert FakeServer.last_path == "/api/v1/readings"
    assert FakeServer.last_query == {"limit": ["1000"]}


def test_sends_filters(fake_api):
    with EnerVisionClient(fake_api) as client:
        client.get_readings(
            site_id="SITE001",
            start=datetime(2026, 10, 20, 8, 0),
            end=datetime(2026, 10, 21, 8, 0),
            limit=100,
        )

    assert FakeServer.last_query == {
        "limit": ["100"],
        "site_id": ["SITE001"],
        "start_time": ["2026-10-20T08:00:00"],
        "end_time": ["2026-10-21T08:00:00"],
    }


@pytest.mark.parametrize("limit", [0, 1001])
def test_rejects_limit_out_of_range(fake_api, limit):
    with EnerVisionClient(fake_api) as client, pytest.raises(ValueError):
        client.get_readings(limit=limit)

    assert FakeServer.last_path is None


def test_raises_on_http_error(fake_api):
    FakeServer.code = 503
    FakeServer.payload = {"detail": "Service unavailable"}

    with EnerVisionClient(fake_api) as client, pytest.raises(httpx.HTTPStatusError):
        client.get_readings()


def test_rejects_payload_that_is_not_a_list(fake_api):
    FakeServer.payload = {"readings": READINGS}

    with EnerVisionClient(fake_api) as client, pytest.raises(TypeError):
        client.get_readings()


def test_sends_basic_auth_when_credentials_are_set(fake_api, monkeypatch):
    monkeypatch.setenv("ENERVISION_API_USERNAME", "user")
    monkeypatch.setenv("ENERVISION_API_PASSWORD", "password")

    with EnerVisionClient(fake_api) as client:
        client.get_readings()

    expected = base64.b64encode(b"user:password").decode()
    assert FakeServer.last_headers["authorization"] == f"Basic {expected}"


def test_sends_no_auth_without_credentials(fake_api):
    with EnerVisionClient(fake_api) as client:
        client.get_readings()

    assert "authorization" not in FakeServer.last_headers


def test_reads_base_url_from_environment(monkeypatch):
    monkeypatch.setenv("ENERVISION_API_URL", "http://enervision.test/")

    with EnerVisionClient() as client:
        assert client.base_url == "http://enervision.test"


def test_explicit_base_url_takes_precedence(monkeypatch):
    monkeypatch.setenv("ENERVISION_API_URL", "http://enervision.test")

    with EnerVisionClient("http://other.test/") as client:
        assert client.base_url == "http://other.test"


def test_closes_http_client_on_exit(fake_api):
    with EnerVisionClient(fake_api) as client:
        pass

    assert client.client.is_closed

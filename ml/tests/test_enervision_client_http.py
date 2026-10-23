"""Client tests against a real local HTTP server.

test_enervision_client.py uses a simulated transport, which never reaches the wire. These
tests check what the client actually sends (query string, Authorization header) and how
it reads its configuration.
"""

import base64
import json
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient


class FakeServer(BaseHTTPRequestHandler):
    """Answers with an empty list and records the last request it received."""

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

        body = json.dumps([]).encode()
        self.send_response(200)
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
    FakeServer.last_path = None
    FakeServer.last_query = None
    FakeServer.last_headers = None

    yield f"http://127.0.0.1:{server.server_port}"

    server.shutdown()
    server.server_close()


def test_asks_for_the_maximum_page_by_default(fake_api):
    with EnerVisionClient(fake_api) as client:
        client.get_readings()

    assert FakeServer.last_path == "/api/v1/readings"
    assert FakeServer.last_query == {"limit": ["1000"]}


def test_sends_every_filter_in_the_query_string(fake_api):
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


def test_calls_the_sites_route(fake_api):
    with EnerVisionClient(fake_api) as client:
        client.get_sites()

    assert FakeServer.last_path == "/api/v1/sites"


def test_sends_basic_auth_header_when_credentials_are_set(fake_api, monkeypatch):
    monkeypatch.setenv("ENERVISION_API_USERNAME", "user")
    monkeypatch.setenv("ENERVISION_API_PASSWORD", "password")

    with EnerVisionClient(fake_api) as client:
        client.get_readings()

    expected = base64.b64encode(b"user:password").decode()
    assert FakeServer.last_headers["authorization"] == f"Basic {expected}"


def test_sends_no_authorization_header_without_credentials(fake_api):
    with EnerVisionClient(fake_api) as client:
        client.get_readings()

    assert "authorization" not in FakeServer.last_headers


def test_sends_no_authorization_header_with_half_the_credentials(fake_api, monkeypatch):
    monkeypatch.setenv("ENERVISION_API_USERNAME", "user")

    with EnerVisionClient(fake_api) as client:
        client.get_readings()

    assert "authorization" not in FakeServer.last_headers


def test_reads_base_url_from_environment_without_trailing_slash(monkeypatch):
    monkeypatch.setenv("ENERVISION_API_URL", "http://enervision.test/")

    with EnerVisionClient() as client:
        assert client.base_url == "http://enervision.test"


def test_explicit_base_url_takes_precedence_over_environment(monkeypatch):
    monkeypatch.setenv("ENERVISION_API_URL", "http://enervision.test")

    with EnerVisionClient("http://other.test/") as client:
        assert client.base_url == "http://other.test"

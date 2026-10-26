import asyncio
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar

import pytest

from smart_energy_app.config import settings
from smart_energy_app.consommation.details import _extract_site_ids, refresh_details, state

SITE_IDS = ["SITE001", "SITE002", "SITE003"]

SITES = [{"site_id": site_id, "site_type": "office"} for site_id in SITE_IDS]


def current_for(site_id: str) -> dict:
    """Réponse type de /api/v1/sites/{id}/current.

    L'horodatage est volontairement sans fuseau : c'est ce que renvoie la
    source, et l'endpoint le relaie tel quel.
    """
    return {
        "timestamp": "2026-10-23T13:15:16.361330",
        "site_id": site_id,
        "site_type": "office",
        "consumption_kw": 165.22,
        "voltage_v": 405.8,
        "null_reasons": [],
        "data_quality": "good",
    }


CURRENT_PATH = re.compile(r"^/api/v1/sites/([^/]+)/current$")


class FakeServer(BaseHTTPRequestHandler):
    """Imite l'API source : le référentiel des sites et la mesure de chacun."""

    failing_sites: ClassVar[set[str]] = set()
    referential_code = 200
    referential_calls = 0

    def log_message(self, *args):
        pass

    def _send(self, code: int, payload) -> None:
        self.send_response(code)
        body = json.dumps(payload).encode()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/v1/sites":
            FakeServer.referential_calls += 1
            self._send(FakeServer.referential_code, SITES)
            return

        matched = CURRENT_PATH.match(self.path)
        if matched:
            site_id = matched.group(1)
            if site_id in FakeServer.failing_sites:
                self._send(500, {"detail": "boom"})
            else:
                self._send(200, current_for(site_id))
            return

        self._send(404, {"detail": "Not Found"})


@pytest.fixture
def fake_api():
    """Lance un serveur local qui imite l'API source, le temps du test."""
    server = HTTPServer(("127.0.0.1", 0), FakeServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    original_url = settings.enervision_api_url
    settings.enervision_api_url = f"http://127.0.0.1:{server.server_port}"

    FakeServer.failing_sites = set()
    FakeServer.referential_code = 200
    FakeServer.referential_calls = 0
    # L'état est un singleton de module : sans remise à zéro, le référentiel
    # mis en cache par un test contaminerait le suivant.
    state.by_site = {}
    state.site_ids = []

    yield FakeServer

    settings.enervision_api_url = original_url
    server.shutdown()
    state.by_site = {}
    state.site_ids = []


def test_loads_every_site(fake_api):
    assert asyncio.run(refresh_details()) is True

    assert sorted(state.by_site) == SITE_IDS
    assert state.by_site["SITE001"]["data"]["data_quality"] == "good"


def test_relays_the_response_untouched(fake_api):
    """Aucun champ n'est filtré : c'est tout l'intérêt de cet endpoint."""
    asyncio.run(refresh_details())

    relayed = state.by_site["SITE002"]["data"]
    assert relayed == current_for("SITE002")
    assert "null_reasons" in relayed
    assert "voltage_v" in relayed


def test_one_failing_site_does_not_break_the_others(fake_api):
    fake_api.failing_sites = {"SITE002"}

    assert asyncio.run(refresh_details()) is False

    # Les autres doivent être là : un capteur muet n'aveugle pas le parc.
    assert sorted(state.by_site) == ["SITE001", "SITE003"]


def test_keeps_the_last_known_value_of_a_failing_site(fake_api):
    asyncio.run(refresh_details())
    initial = state.by_site["SITE002"]["fetched_at"]

    fake_api.failing_sites = {"SITE002"}
    asyncio.run(refresh_details())

    assert state.by_site["SITE002"]["fetched_at"] == initial
    assert state.by_site["SITE001"]["fetched_at"] > initial


def test_logs_the_failing_site(fake_api, caplog):
    fake_api.failing_sites = {"SITE003"}

    with caplog.at_level("WARNING"):
        asyncio.run(refresh_details())

    assert "SITE003" in caplog.text


def test_loads_the_referential_once(fake_api):
    """Le parc ne change pas : inutile de le redemander à chaque cycle."""
    asyncio.run(refresh_details())
    asyncio.run(refresh_details())
    asyncio.run(refresh_details())

    assert fake_api.referential_calls == 1


def test_gives_up_when_the_referential_is_unavailable(fake_api):
    fake_api.referential_code = 500

    assert asyncio.run(refresh_details()) is False
    assert state.by_site == {}


def test_logs_when_the_referential_is_unreadable(fake_api, caplog, monkeypatch):
    """Une réponse 200 mais inexploitable ne doit pas passer en silence."""
    monkeypatch.setattr("smart_energy_app.consommation.details._extract_site_ids", lambda _: [])

    with caplog.at_level("WARNING"):
        assert asyncio.run(refresh_details()) is False

    assert "illisible" in caplog.text


def test_stale_marks_a_site_without_measure(fake_api):
    asyncio.run(refresh_details())

    assert state.is_stale("SITE001") is False
    # Un site jamais mesuré est périmé par défaut, pas « frais parce qu'absent ».
    assert state.is_stale("SITE404") is True
    assert state.as_payload("SITE404") is None


def test_payload_carries_the_timestamp_and_staleness(fake_api):
    asyncio.run(refresh_details())

    payload = state.as_payload("SITE001")
    assert payload["data"] == current_for("SITE001")
    assert payload["stale"] is False
    assert payload["fetched_at"].endswith("+00:00")


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ([{"site_id": "SITE001"}, {"site_id": "SITE002"}], ["SITE001", "SITE002"]),
        ([{"id": "SITE001"}], ["SITE001"]),
        (["SITE001", "SITE002"], ["SITE001", "SITE002"]),
        ([{"site_id": ""}, {"autre": "x"}, 42], []),
        ({"sites": ["SITE001"]}, []),
        (None, []),
    ],
)
def test_extract_site_ids(payload, expected):
    """L'extraction est défensive : la forme de la réponse n'est pas un contrat."""
    assert _extract_site_ids(payload) == expected

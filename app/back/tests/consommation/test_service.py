import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from smart_energy_app.config import settings
from smart_energy_app.consommation import planificateur
from smart_energy_app.consommation.service import refresh, state

RESUME = {
    "total_sites": 7,
    "sites": [{"site_id": "SITE001", "data_quality": "good"}],
}


class FauxServeur(BaseHTTPRequestHandler):
    code = 200

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(FauxServeur.code)
        corps = json.dumps(RESUME).encode()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)


@pytest.fixture
def api_simulee():
    serveur = HTTPServer(("127.0.0.1", 0), FauxServeur)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()

    url_origine = settings.enervision_api_url
    settings.enervision_api_url = f"http://127.0.0.1:{serveur.server_port}"
    FauxServeur.code = 200
    state.data = None
    state.fetched_at = None

    yield FauxServeur

    settings.enervision_api_url = url_origine
    serveur.shutdown()
    state.data = None
    state.fetched_at = None


def test_enregistre_la_reponse_quand_l_appel_reussit(api_simulee):
    assert asyncio.run(refresh()) is True
    assert state.data == RESUME
    assert state.is_stale() is False


def test_conserve_la_derniere_valeur_quand_l_api_echoue(api_simulee):
    asyncio.run(refresh())
    horodatage_initial = state.fetched_at

    api_simulee.code = 500
    assert asyncio.run(refresh()) is False

    assert state.data == RESUME
    assert state.fetched_at == horodatage_initial


def test_journalise_le_code_d_erreur_sans_le_propager(api_simulee, caplog):
    api_simulee.code = 503

    with caplog.at_level("WARNING"):
        resultat = asyncio.run(refresh())

    assert resultat is False
    assert "503" in caplog.text


def test_la_boucle_rafraichit_a_intervalle_regulier(monkeypatch):
    """La boucle doit appeler refresh() à la cadence configurée."""
    monkeypatch.setattr(settings, "consumption_refresh_s", 0.01)

    appels = []

    async def faux_refresh():
        appels.append(1)
        return True

    monkeypatch.setattr(planificateur, "refresh", faux_refresh)

    async def scenario():
        tache = asyncio.create_task(planificateur.refresh_loop())
        await asyncio.sleep(0.06)
        tache.cancel()

    asyncio.run(scenario())

    assert len(appels) >= 3

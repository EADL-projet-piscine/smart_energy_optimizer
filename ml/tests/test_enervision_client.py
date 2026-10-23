from datetime import UTC, datetime

import httpx
import pytest

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient


@pytest.fixture
def mock_client(monkeypatch):
    """Crée un client EnerVision utilisant un transport HTTP simulé."""

    monkeypatch.delenv("ENERVISION_API_USERNAME", raising=False)
    monkeypatch.delenv("ENERVISION_API_PASSWORD", raising=False)

    client = EnerVisionClient(base_url="https://test.enervision.local")

    yield client

    client.close()


def set_mock_transport(client, handler):
    """Remplace le transport HTTP par un transport simulé."""

    client.client.close()

    client.client = httpx.Client(
        base_url=client.base_url,
        transport=httpx.MockTransport(handler),
    )


def test_get_readings_returns_data(mock_client):
    """Vérifie la récupération des mesures."""

    expected = [
        {
            "site_id": "SITE001",
            "consumption_kw": 125.5,
        }
    ]

    def handler(request):
        assert request.url.path == "/api/v1/readings"
        return httpx.Response(200, json=expected)

    set_mock_transport(mock_client, handler)

    result = mock_client.get_readings(site_id="SITE001")

    assert result == expected


def test_get_readings_sends_parameters(mock_client):
    """Vérifie la transmission des paramètres de recherche."""

    start = datetime(2026, 1, 7, tzinfo=UTC)
    end = datetime(2026, 1, 8, tzinfo=UTC)

    def handler(request):
        params = request.url.params

        assert params["site_id"] == "SITE002"
        assert params["start_time"] == start.isoformat()
        assert params["end_time"] == end.isoformat()
        assert params["limit"] == "500"

        return httpx.Response(200, json=[])

    set_mock_transport(mock_client, handler)

    result = mock_client.get_readings(
        site_id="SITE002",
        start=start,
        end=end,
        limit=500,
    )

    assert result == []


@pytest.mark.parametrize("limit", [0, -1, 1001])
def test_get_readings_rejects_invalid_limit(mock_client, limit):
    """Vérifie la validation de la limite."""

    with pytest.raises(ValueError, match="limit doit être compris"):
        mock_client.get_readings(limit=limit)


def test_get_readings_raises_http_error(mock_client):
    """Vérifie la propagation des erreurs HTTP."""

    def handler(request):
        return httpx.Response(
            500,
            json={"detail": "Internal Server Error"},
        )

    set_mock_transport(mock_client, handler)

    with pytest.raises(httpx.HTTPStatusError):
        mock_client.get_readings()


def test_get_readings_rejects_invalid_json_structure(mock_client):
    """Vérifie le rejet d'une réponse JSON inattendue."""

    def handler(request):
        return httpx.Response(
            200,
            json={"readings": []},
        )

    set_mock_transport(mock_client, handler)

    with pytest.raises(TypeError, match="liste JSON"):
        mock_client.get_readings()


def test_get_sites_returns_data(mock_client):
    """Vérifie la récupération des métadonnées des sites."""

    expected = [
        {"site_id": "SITE001", "site_type": "office"},
        {"site_id": "SITE002", "site_type": "factory"},
    ]

    def handler(request):
        assert request.url.path == "/api/v1/sites"
        return httpx.Response(200, json=expected)

    set_mock_transport(mock_client, handler)

    assert mock_client.get_sites() == expected


def test_get_sites_rejects_invalid_json_structure(mock_client):
    """Vérifie la validation du format des métadonnées."""

    def handler(request):
        return httpx.Response(200, json={"sites": []})

    set_mock_transport(mock_client, handler)

    with pytest.raises(TypeError, match="liste JSON"):
        mock_client.get_sites()


def test_basic_auth(monkeypatch):
    """Vérifie l'envoi de l'authentification HTTP Basic."""

    monkeypatch.setenv("ENERVISION_API_USERNAME", "test_user")
    monkeypatch.setenv("ENERVISION_API_PASSWORD", "test_password")

    client = EnerVisionClient(base_url="https://test.enervision.local")

    def handler(request):
        assert request.headers["Authorization"].startswith("Basic ")
        return httpx.Response(200, json=[])

    # On conserve l'authentification configurée par EnerVisionClient.
    client.client.close()
    client.client = httpx.Client(
        base_url=client.base_url,
        auth=httpx.BasicAuth("test_user", "test_password"),
        transport=httpx.MockTransport(handler),
    )

    try:
        assert client.get_readings() == []
    finally:
        client.close()


def test_context_manager_closes_client(monkeypatch):
    """Vérifie la fermeture automatique de la connexion."""

    monkeypatch.delenv("ENERVISION_API_USERNAME", raising=False)
    monkeypatch.delenv("ENERVISION_API_PASSWORD", raising=False)

    with EnerVisionClient(base_url="https://test.enervision.local") as client:
        assert not client.client.is_closed

    assert client.client.is_closed

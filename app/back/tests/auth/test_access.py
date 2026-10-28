"""Access control of the API, without a database: tokens are issued directly.

The "401 without token" and "403 outside the client's sites" checks required by the
security audit (EC04, finding C1) live here, so that they run on every pull request.
"""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient

from smart_energy_app.alertes.capacite import CapacityAlert, capacity_alerts
from smart_energy_app.auth.dependencies import COOKIE_NAME, check_configuration
from smart_energy_app.auth.principal import Principal
from smart_energy_app.auth.tokens import issue_token
from smart_energy_app.config import settings
from smart_energy_app.consommation.details import state as details_state
from smart_energy_app.consommation.last_readings import last_readings
from smart_energy_app.consommation.service import state
from smart_energy_app.main import app

SECRET = "test-secret-with-more-than-32-characters"
OTHER_SECRET = "another-secret-with-more-than-32-characters"

SUMMARY = {
    "timestamp": "2026-10-27T09:00:00",
    "total_sites": 3,
    "total_consumption_kw": 900.0,
    "total_capacity_kw": 1500,
    "average_load_percent": 60.0,
    "fleet_wide_extra": "must not leak",
    "sites": [
        {
            "site_id": "SITE001",
            "current_consumption_kw": 100.0,
            "capacity_kw": 200,
            "load_percent": 50.0,
        },
        {
            "site_id": "SITE002",
            "current_consumption_kw": None,
            "capacity_kw": 300,
            "load_percent": None,
        },
        {
            "site_id": "SITE003",
            "current_consumption_kw": 800.0,
            "capacity_kw": 1000,
            "load_percent": 80.0,
        },
    ],
}

VIEWER = Principal(
    "u-viewer",
    "viewer@example.com",
    "Viewer",
    frozenset({"viewer"}),
    frozenset({"SITE001", "SITE002"}),
)
ADMIN = Principal("u-admin", "admin@example.com", "Admin", frozenset({"admin"}), None)


@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "jwt_secret", settings.jwt_secret.__class__(SECRET))


@pytest.fixture
def fleet():
    """Three sites in every in-memory state the routes read."""
    now = datetime.now(UTC)
    state.data, state.fetched_at = SUMMARY, now
    details_state.site_ids = ["SITE001", "SITE002", "SITE003"]
    details_state.by_site = {
        site: {"data": {"site_id": site}, "fetched_at": now} for site in details_state.site_ids
    }
    last_readings.by_site = {
        site: {"consumption_kw": 10.0, "at": now} for site in ("SITE001", "SITE003")
    }
    capacity_alerts.by_site = {"SITE003": CapacityAlert("SITE003", "moyenne", now, 80.0, 1000)}
    yield
    state.data, state.fetched_at = None, None
    details_state.site_ids, details_state.by_site = [], {}
    last_readings.by_site = {}
    capacity_alerts.by_site = {}


def client_for(principal: Principal, secret: str = SECRET, ttl: timedelta = timedelta(minutes=15)):
    client = TestClient(app)
    client.cookies.set(COOKIE_NAME, issue_token(principal, secret, ttl))
    return client


def protected_routes() -> list[tuple[str, str]]:
    """Every route under /api, except the ones that open or close a session.

    Read from the OpenAPI specification rather than app.routes: recent FastAPI versions
    wrap included routers, whose routes no longer appear there.
    """
    routes = []
    for path, operations in app.openapi()["paths"].items():
        if not path.startswith("/api/") or path in ("/api/auth/login", "/api/auth/logout"):
            continue
        for method in operations:
            concrete = path.replace("{site_id}", "SITE001").replace(
                "{user_id}", "00000000-0000-0000-0000-000000000001"
            )
            routes.append((method.upper(), concrete))
    return routes


@pytest.mark.parametrize(("method", "path"), protected_routes())
def test_every_api_route_answers_401_without_a_session(auth_on, method, path):
    response = TestClient(app).request(method, path)

    assert response.status_code == 401


def test_the_route_list_is_not_empty():
    # Guards the test above: an empty parametrization would pass without testing anything.
    assert len(protected_routes()) >= 7


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(lambda: issue_token(VIEWER, SECRET, timedelta(seconds=-1)), id="expired"),
        pytest.param(
            lambda: issue_token(VIEWER, OTHER_SECRET, timedelta(minutes=5)), id="other-key"
        ),
        pytest.param(
            lambda: issue_token(VIEWER, SECRET, timedelta(minutes=5))[:-4] + "AAAA", id="tampered"
        ),
        pytest.param(
            lambda: jwt.encode(
                {"sub": "x", "roles": ["admin"], "sites": None}, key="", algorithm="none"
            ),
            id="alg-none",
        ),
    ],
)
def test_an_invalid_token_answers_401(auth_on, fleet, token):
    client = TestClient(app)
    client.cookies.set(COOKIE_NAME, token())

    assert client.get("/api/consommations").status_code == 401


def test_health_and_openapi_stay_open(auth_on):
    client = TestClient(app)

    assert client.get("/health").status_code == 200
    schemes = client.get("/openapi.json").json()["components"]["securitySchemes"]
    assert schemes["APIKeyCookie"]["in"] == "cookie"
    assert schemes["APIKeyCookie"]["name"] == COOKIE_NAME


@pytest.mark.parametrize(
    "path",
    [
        "/api/consommations/sites/SITE003",
        "/api/previsions/SITE003",
        "/api/consommations/sites/UNKNOWN",
    ],
)
def test_a_site_outside_the_client_scope_answers_403(auth_on, fleet, path):
    # The unknown site gets a 403 too, not a 404: a client must not probe other sites.
    assert client_for(VIEWER).get(path).status_code == 403


def test_a_site_in_scope_is_served(auth_on, fleet):
    assert client_for(VIEWER).get("/api/consommations/sites/SITE001").status_code == 200


def test_the_summary_only_shows_the_client_sites_and_their_totals(auth_on, fleet):
    body = client_for(VIEWER).get("/api/consommations").json()

    data = body["data"]
    assert [site["site_id"] for site in data["sites"]] == ["SITE001", "SITE002"]
    assert data["total_sites"] == 2
    assert data["total_consumption_kw"] == 100.0
    assert data["total_capacity_kw"] == 500
    assert data["average_load_percent"] == 50.0
    assert "fleet_wide_extra" not in data
    assert set(body["last_readings"]) == {"SITE001"}
    assert body["alertes"] == []


def test_the_site_list_only_shows_the_client_sites(auth_on, fleet):
    body = client_for(VIEWER).get("/api/consommations/sites").json()

    assert set(body["sites"]) == {"SITE001", "SITE002"}


def test_an_admin_sees_the_whole_fleet(auth_on, fleet):
    client = client_for(ADMIN)

    assert client.get("/api/consommations").json()["data"] == SUMMARY
    assert client.get("/api/consommations/sites/SITE003").status_code == 200


def test_me_describes_the_session(auth_on):
    body = client_for(VIEWER).get("/api/auth/me").json()

    assert body["auth_enabled"] is True
    assert body["user"]["roles"] == ["viewer"]
    assert body["user"]["site_ids"] == ["SITE001", "SITE002"]


def test_without_authentication_the_api_stays_open(fleet):
    client = TestClient(app)

    assert settings.auth_enabled is False
    assert client.get("/api/consommations").json()["data"] == SUMMARY
    assert client.get("/api/auth/me").json() == {
        "auth_enabled": False,
        "user": Principal.anonymous().as_payload(),
    }


def test_login_answers_503_without_a_signing_key(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", settings.jwt_secret.__class__(""))

    response = TestClient(app).post("/api/auth/login", json={"email": "a@b.fr", "password": "x"})

    assert response.status_code == 503


def test_logout_clears_the_cookie():
    response = TestClient(app).post("/api/auth/logout")

    assert response.status_code == 204
    assert f'{COOKIE_NAME}=""' in response.headers["set-cookie"]
    assert "Max-Age=0" in response.headers["set-cookie"]


@pytest.mark.parametrize("secret", ["", "too-short"])
def test_the_api_refuses_to_start_protected_without_a_strong_key(monkeypatch, secret):
    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "jwt_secret", settings.jwt_secret.__class__(secret))

    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        check_configuration()


def test_the_api_starts_protected_with_a_strong_key(auth_on):
    check_configuration()

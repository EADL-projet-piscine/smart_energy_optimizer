"""Account management by an administrator, against the real schema."""

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from smart_energy_app.auth.passwords import hash_password
from smart_energy_app.auth.repository import create_account
from smart_energy_app.config import settings
from smart_energy_app.db import engine
from smart_energy_app.main import app

SECRET = "test-secret-with-more-than-32-characters"
PASSWORD = "correct horse battery staple"
SITES = ("SITE981", "SITE982", "SITE983")
ADMIN = "admin.comptes@example.com"
VIEWER = "viewer.comptes@example.com"
NEW = "new.comptes@example.com"


@pytest.fixture
def setup(schema, monkeypatch):
    """An admin and a viewer (client of SITE981); everything is deleted afterwards."""
    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "jwt_secret", settings.jwt_secret.__class__(SECRET))
    monkeypatch.setattr(settings, "auth_cookie_secure", False)
    with engine.begin() as conn:
        for site in SITES:
            conn.execute(
                text(
                    "SELECT upsert_site(CAST(:id AS text), CAST(:id AS text), NULL::text, 1::numeric)"
                ),
                {"id": site},
            )
        admin_id = create_account(conn, ADMIN, "Admin", hash_password(PASSWORD), "admin", [])
        viewer_id = create_account(
            conn, VIEWER, "Viewer", hash_password(PASSWORD), "viewer", ["SITE981"]
        )
    try:
        yield {"admin": admin_id, "viewer": viewer_id}
    finally:
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM users WHERE email = ANY(:e)"), {"e": [ADMIN, VIEWER, NEW]}
            )
            conn.execute(text("DELETE FROM sites WHERE site_id = ANY(:s)"), {"s": list(SITES)})


def signed_in(email: str) -> TestClient:
    client = TestClient(app)
    assert (
        client.post("/api/auth/login", json={"email": email, "password": PASSWORD}).status_code
        == 204
    )
    return client


def new_account(**overrides) -> dict:
    return {
        "email": NEW,
        "display_name": "Nouveau",
        "password": PASSWORD,
        "role": "viewer",
        "site_ids": ["SITE982"],
    } | overrides


@pytest.mark.db
def test_an_admin_lists_accounts_and_sites(setup):
    body = signed_in(ADMIN).get("/api/comptes").json()

    viewer = next(account for account in body["comptes"] if account["email"] == VIEWER)
    assert viewer["roles"] == ["viewer"]
    assert viewer["site_ids"] == ["SITE981"]
    assert viewer["is_active"] is True
    assert "password_hash" not in viewer
    site = next(site for site in body["sites"] if site["site_id"] == "SITE981")
    assert site["client_user_id"] == setup["viewer"]


@pytest.mark.db
def test_a_viewer_cannot_manage_accounts(setup):
    client = signed_in(VIEWER)

    assert client.get("/api/comptes").status_code == 403
    assert client.post("/api/comptes", json=new_account()).status_code == 403


@pytest.mark.db
def test_account_management_requires_authentication_to_be_enabled(setup, monkeypatch):
    monkeypatch.setattr(settings, "auth_enabled", False)

    response = TestClient(app).get("/api/comptes")

    assert response.status_code == 403
    assert "AUTH_ENABLED" in response.json()["detail"]


@pytest.mark.db
def test_an_admin_creates_an_account_that_can_log_in(setup, caplog):
    caplog.set_level(logging.INFO, logger="smart_energy_app.auth.comptes")

    response = signed_in(ADMIN).post("/api/comptes", json=new_account())

    assert response.status_code == 201
    assert response.json()["site_ids"] == ["SITE982"]
    assert signed_in(NEW).get("/api/auth/me").json()["user"]["site_ids"] == ["SITE982"]
    assert f"créé par {setup['admin']}" in caplog.text
    assert PASSWORD not in caplog.text


@pytest.mark.db
@pytest.mark.parametrize(
    ("overrides", "status"),
    [
        ({"email": VIEWER}, 409),
        ({"site_ids": ["NOPE"]}, 422),
        ({"password": "short"}, 422),
        ({"role": "superuser"}, 422),
        ({"email": "not-an-email"}, 422),
    ],
    ids=["duplicate-email", "unknown-site", "short-password", "unknown-role", "bad-email"],
)
def test_an_invalid_account_is_refused(setup, overrides, status):
    response = signed_in(ADMIN).post("/api/comptes", json=new_account(**overrides))

    assert response.status_code == status
    with engine.connect() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM users WHERE email = :e"), {"e": NEW}).scalar()
            == 0
        )


@pytest.mark.db
def test_an_admin_moves_sites_between_clients(setup):
    admin = signed_in(ADMIN)

    response = admin.patch(
        f"/api/comptes/{setup['viewer']}", json={"site_ids": ["SITE982", "SITE983"]}
    )

    assert response.status_code == 200
    assert response.json()["site_ids"] == ["SITE982", "SITE983"]
    # SITE981 is no longer this client's: it has no client any more.
    sites = {site["site_id"]: site for site in admin.get("/api/comptes").json()["sites"]}
    assert sites["SITE981"]["client_user_id"] is None


@pytest.mark.db
def test_an_admin_changes_the_role_and_the_name(setup):
    response = signed_in(ADMIN).patch(
        f"/api/comptes/{setup['viewer']}", json={"role": "operator", "display_name": " Opé "}
    )

    assert response.json()["roles"] == ["operator"]
    assert response.json()["display_name"] == "Opé"
    assert signed_in(VIEWER).get("/api/auth/me").json()["user"]["site_ids"] is None


@pytest.mark.db
def test_a_deactivated_account_can_no_longer_log_in(setup):
    signed_in(ADMIN).patch(f"/api/comptes/{setup['viewer']}", json={"is_active": False})

    response = TestClient(app).post("/api/auth/login", json={"email": VIEWER, "password": PASSWORD})
    assert response.status_code == 401


@pytest.mark.db
def test_an_admin_resets_a_password(setup):
    signed_in(ADMIN).patch(
        f"/api/comptes/{setup['viewer']}", json={"password": "a brand new passphrase"}
    )

    client = TestClient(app)
    assert (
        client.post("/api/auth/login", json={"email": VIEWER, "password": PASSWORD}).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login", json={"email": VIEWER, "password": "a brand new passphrase"}
        ).status_code
        == 204
    )


@pytest.mark.db
@pytest.mark.parametrize("changes", [{"is_active": False}, {"role": "viewer"}])
def test_an_admin_cannot_remove_their_own_rights(setup, changes):
    response = signed_in(ADMIN).patch(f"/api/comptes/{setup['admin']}", json=changes)

    assert response.status_code == 409


@pytest.mark.db
def test_an_unknown_account_answers_404(setup):
    response = signed_in(ADMIN).patch(
        "/api/comptes/00000000-0000-0000-0000-000000000001", json={"is_active": False}
    )

    assert response.status_code == 404


@pytest.mark.db
def test_an_unknown_site_leaves_the_account_unchanged(setup):
    admin = signed_in(ADMIN)

    response = admin.patch(
        f"/api/comptes/{setup['viewer']}", json={"role": "operator", "site_ids": ["NOPE"]}
    )

    assert response.status_code == 422
    viewer = next(a for a in admin.get("/api/comptes").json()["comptes"] if a["email"] == VIEWER)
    assert viewer["roles"] == ["viewer"]
    assert viewer["site_ids"] == ["SITE981"]

"""Login against the real schema: accounts, roles, client sites and the session cookie."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from smart_energy_app.auth.create_user import main as create_user
from smart_energy_app.auth.dependencies import COOKIE_NAME
from smart_energy_app.auth.passwords import hash_password
from smart_energy_app.auth.repository import create_account
from smart_energy_app.config import settings
from smart_energy_app.db import engine
from smart_energy_app.main import app

SECRET = "test-secret-with-more-than-32-characters"
PASSWORD = "correct horse battery staple"
SITES = ("SITE971", "SITE972")
EMAILS = ("viewer.auth@example.com", "admin.auth@example.com", "cli.auth@example.com")


@pytest.fixture
def accounts(schema, monkeypatch):
    """A viewer, client of SITE971 only, and an admin; everything is deleted afterwards.

    Committed rather than rolled back: the routes open their own connections and only
    see committed rows. `schema` comes from tests/conftest.py.
    """
    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "jwt_secret", settings.jwt_secret.__class__(SECRET))
    # The test client speaks HTTP: a Secure cookie would not be sent back.
    monkeypatch.setattr(settings, "auth_cookie_secure", False)
    with engine.begin() as conn:
        for site in SITES:
            conn.execute(
                text(
                    "SELECT upsert_site(CAST(:id AS text), CAST(:id AS text), NULL::text, 100::numeric)"
                ),
                {"id": site},
            )
        create_account(conn, EMAILS[0], "Viewer", hash_password(PASSWORD), "viewer", ["SITE971"])
        create_account(conn, EMAILS[1], "Admin", hash_password(PASSWORD), "admin", [])
    try:
        yield
    finally:
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM users WHERE email = ANY(:emails)"), {"emails": list(EMAILS)}
            )
            conn.execute(
                text("DELETE FROM sites WHERE site_id = ANY(:sites)"), {"sites": list(SITES)}
            )


def login(client: TestClient, email: str, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


@pytest.mark.db
def test_login_sets_a_short_lived_http_only_cookie(accounts):
    response = login(TestClient(app), EMAILS[0])

    assert response.status_code == 204
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE_NAME}=")
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Path=/api" in cookie
    assert "Max-Age=900" in cookie


@pytest.mark.db
def test_the_cookie_is_secure_by_default(accounts, monkeypatch):
    monkeypatch.setattr(settings, "auth_cookie_secure", True)

    assert "Secure" in login(TestClient(app), EMAILS[0]).headers["set-cookie"]


@pytest.mark.db
def test_a_viewer_session_is_limited_to_its_client_sites(accounts):
    client = TestClient(app)
    login(client, EMAILS[0].upper())  # e-mails are compared case-insensitively

    me = client.get("/api/auth/me").json()["user"]
    assert me["email"] == EMAILS[0]
    assert me["roles"] == ["viewer"]
    assert me["site_ids"] == ["SITE971"]
    assert client.get("/api/previsions/SITE972").status_code == 403


@pytest.mark.db
def test_an_admin_session_sees_every_site(accounts):
    client = TestClient(app)
    login(client, EMAILS[1])

    assert client.get("/api/auth/me").json()["user"]["site_ids"] is None
    assert client.get("/api/previsions/SITE972").status_code == 200


@pytest.mark.db
@pytest.mark.parametrize(
    ("email", "password"),
    [(EMAILS[0], "wrong password"), ("nobody@example.com", PASSWORD)],
    ids=["wrong-password", "unknown-email"],
)
def test_bad_credentials_answer_401_with_the_same_message(accounts, email, password):
    response = login(TestClient(app), email, password)

    assert response.status_code == 401
    assert response.json()["detail"] == "Identifiant ou mot de passe incorrect."
    assert "set-cookie" not in response.headers


@pytest.mark.db
def test_a_deactivated_account_cannot_log_in(accounts):
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET is_active = false WHERE email = :e"), {"e": EMAILS[0]})

    assert login(TestClient(app), EMAILS[0]).status_code == 401


@pytest.mark.db
def test_passwords_are_stored_as_argon2_hashes(accounts):
    with engine.connect() as conn:
        stored = conn.execute(
            text("SELECT password_hash FROM users WHERE email = :e"), {"e": EMAILS[0]}
        ).scalar_one()

    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored


@pytest.mark.db
def test_logout_then_the_api_answers_401(accounts):
    client = TestClient(app)
    login(client, EMAILS[0])
    client.post("/api/auth/logout")

    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.db
def test_the_command_creates_an_account_that_can_log_in(accounts, monkeypatch):
    monkeypatch.setenv("NEW_USER_PASSWORD", PASSWORD)
    argv = ["--email", EMAILS[2], "--name", "Cli", "--role", "viewer", "--site", "SITE972"]

    assert create_user(argv) == 0
    assert create_user(argv) == 1  # the e-mail is already taken
    client = TestClient(app)
    login(client, EMAILS[2])
    assert client.get("/api/auth/me").json()["user"]["site_ids"] == ["SITE972"]


@pytest.mark.db
def test_the_command_creates_nothing_for_an_unknown_site(accounts, monkeypatch):
    monkeypatch.setenv("NEW_USER_PASSWORD", PASSWORD)

    code = create_user(
        ["--email", EMAILS[2], "--name", "Cli", "--role", "viewer", "--site", "NOPE"]
    )

    assert code == 1
    with engine.connect() as conn:
        count = conn.execute(
            text("SELECT count(*) FROM users WHERE email = :e"), {"e": EMAILS[2]}
        ).scalar_one()
    assert count == 0


@pytest.mark.db
def test_the_command_refuses_a_short_password(accounts, monkeypatch):
    monkeypatch.setenv("NEW_USER_PASSWORD", "short")

    assert create_user(["--email", EMAILS[2], "--name", "Cli", "--role", "admin"]) == 1

from pydantic import SecretStr

from smart_energy_app.config import settings
from smart_energy_app.consommation.client import _auth


def test_auth_none_without_user(monkeypatch):
    """Without credentials, httpx must receive no tuple at all: None, not ("", "")."""
    monkeypatch.setattr(settings, "enervision_user", "")

    assert _auth() is None


def test_auth_returns_credentials(monkeypatch):
    monkeypatch.setattr(settings, "enervision_user", "someone")
    monkeypatch.setattr(settings, "enervision_password", SecretStr("secret"))

    assert _auth() == ("someone", "secret")


def test_auth_does_not_leak_password(monkeypatch):
    """The password is a SecretStr: its value must only surface via get_secret_value."""
    monkeypatch.setattr(settings, "enervision_user", "someone")
    monkeypatch.setattr(settings, "enervision_password", SecretStr("secret"))

    assert "secret" not in str(settings.enervision_password)
    assert "secret" not in repr(settings.enervision_password)

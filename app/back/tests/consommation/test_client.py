from pydantic import SecretStr

from smart_energy_app.config import settings
from smart_energy_app.consommation.client import _auth


def test_auth_none_without_user(monkeypatch):
    """Sans identifiants, httpx ne doit recevoir aucun tuple : None, pas ("", "")."""
    monkeypatch.setattr(settings, "enervision_user", "")

    assert _auth() is None


def test_auth_returns_credentials(monkeypatch):
    monkeypatch.setattr(settings, "enervision_user", "utilisateur")
    monkeypatch.setattr(settings, "enervision_password", SecretStr("motdepasse"))

    assert _auth() == ("utilisateur", "motdepasse")


def test_auth_does_not_leak_password(monkeypatch):
    """Le mot de passe est un SecretStr : sa valeur ne doit sortir que par get_secret_value."""
    monkeypatch.setattr(settings, "enervision_user", "utilisateur")
    monkeypatch.setattr(settings, "enervision_password", SecretStr("motdepasse"))

    assert "motdepasse" not in str(settings.enervision_password)
    assert "motdepasse" not in repr(settings.enervision_password)

from urllib.parse import urlsplit

from smart_energy_app.config import Settings


def test_database_url_default_carries_no_credentials(monkeypatch):
    """Les identifiants viennent de DATABASE_URL, jamais du code.

    Un mot de passe par défaut reste dans l'historique Git, quelle que soit la base visée.
    """
    monkeypatch.delenv("DATABASE_URL", raising=False)

    url = urlsplit(Settings(_env_file=None).database_url)

    assert url.username is None
    assert url.password is None


def test_database_url_is_read_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:secret@db:5432/base")

    assert Settings(_env_file=None).database_url == "postgresql+psycopg://user:secret@db:5432/base"

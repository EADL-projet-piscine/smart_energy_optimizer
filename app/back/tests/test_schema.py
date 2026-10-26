"""Schéma PostgreSQL : tables, contraintes, et droits des rôles applicatifs."""

from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

from smart_energy_app.config import settings
from smart_energy_app.db import engine

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "db" / "migrations" / "001_initial_schema.sql"
# Mots de passe du docker-compose de développement, pas des secrets de production.
APP_ROLE = "enervision_app"
ML_ROLE = "enervision_ml"
APP_PASSWORD = "enervision_app"
ML_PASSWORD = "enervision_ml"
HASH = "x" * 60


def split_sql(script: str) -> list[str]:
    """Découpe un script en requêtes, sans casser les fonctions ni les chaînes."""
    statements: list[str] = []
    buf: list[str] = []
    i = 0
    length = len(script)
    dollar_tag: str | None = None
    in_single = False

    while i < length:
        if dollar_tag is not None:
            if script.startswith(dollar_tag, i):
                buf.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
            buf.append(script[i])
            i += 1
            continue

        if in_single:
            buf.append(script[i])
            if script[i] == "'":
                if i + 1 < length and script[i + 1] == "'":
                    buf.append("'")
                    i += 2
                    continue
                in_single = False
            i += 1
            continue

        if script[i] == "'":
            in_single = True
            buf.append("'")
            i += 1
            continue

        if script[i] == "$":
            end = i + 1
            while end < length and (script[end].isalnum() or script[end] == "_"):
                end += 1
            if end < length and script[end] == "$":
                dollar_tag = script[i : end + 1]
                buf.append(dollar_tag)
                i = end + 1
                continue

        if script.startswith("--", i):
            while i < length and script[i] != "\n":
                i += 1
            continue

        if script[i] == ";":
            statement = "".join(buf).strip()
            if statement:
                statements.append(statement)
            buf = []
            i += 1
            continue

        buf.append(script[i])
        i += 1

    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def test_migration_script_splits_functions():
    statements = split_sql(SCHEMA_PATH.read_text(encoding="utf-8"))
    functions = [item for item in statements if "FUNCTION upsert_current" in item]
    assert len(functions) == 1
    assert "ON CONFLICT (site_id)" in functions[0]
    assert any("CREATE TABLE IF NOT EXISTS sites" in item for item in statements)
    assert any("CREATE TABLE IF NOT EXISTS current" in item for item in statements)
    assert any("CREATE TABLE IF NOT EXISTS predictions" in item for item in statements)


def _schema_ready() -> bool:
    with engine.connect() as conn:
        sites = conn.execute(text("SELECT to_regclass('public.sites')")).scalar()
        function = conn.execute(
            text(
                "SELECT EXISTS ("
                "  SELECT 1 FROM pg_proc p"
                "  JOIN pg_namespace n ON n.oid = p.pronamespace"
                "  WHERE n.nspname = 'public' AND p.proname = 'upsert_current'"
                ")"
            )
        ).scalar()
    return sites is not None and bool(function)


def _apply_schema() -> None:
    script = SCHEMA_PATH.read_text(encoding="utf-8")
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            for statement in split_sql(script):
                conn.execute(text(statement))
            transaction.commit()
        except Exception:
            transaction.rollback()
            raise


@pytest.fixture(scope="module")
def schema():
    if not _schema_ready():
        _apply_schema()


@pytest.fixture
def db(schema):
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            yield conn
        finally:
            transaction.rollback()


def _site(
    conn,
    site_id: str = "SITE901",
    site_type: str | None = "office",
    capacity: int | None = 600,
):
    conn.execute(
        text(
            "SELECT upsert_site("
            "CAST(:site_id AS text), CAST(:site_name AS text),"
            "CAST(:site_type AS text), CAST(:capacity AS numeric))"
        ),
        {
            "site_id": site_id,
            "site_name": f"Site {site_id}",
            "site_type": site_type,
            "capacity": capacity,
        },
    )


def _current(conn, site_id: str = "SITE901", consumption: float | None = 412.5):
    conn.execute(
        text(
            "SELECT upsert_current("
            "  CAST(:site_id AS text), timestamptz '2026-10-21 09:34:44+00',"
            "  CAST(:consumption AS numeric),"
            "  NULL::numeric, 230.0::numeric, NULL::numeric, NULL::numeric,"
            "  NULL::numeric, NULL::numeric, 68.8::numeric,"
            "  'good', ARRAY['network_loss']"
            ")"
        ),
        {"site_id": site_id, "consumption": consumption},
    )


def _prediction(conn, site_id: str = "SITE901", value: float = 480, version: str | None = "v1"):
    return conn.execute(
        text(
            "SELECT upsert_prediction("
            "  CAST(:site_id AS text), CAST(:value AS numeric),"
            "  timestamptz '2026-10-21 10:00:00+00',"
            "  timestamptz '2026-10-21 12:00:00+00',"
            "  'consumption_forecast', CAST(:version AS text)"
            ")"
        ),
        {"site_id": site_id, "value": value, "version": version},
    ).scalar()


@pytest.mark.db
def test_roles_are_seeded(db):
    codes = set(db.execute(text("SELECT code FROM roles")).scalars().all())
    assert {"admin", "operator", "viewer"} <= codes


@pytest.mark.db
def test_user_can_hold_several_roles(db):
    user_id = db.execute(
        text(
            "INSERT INTO users (email, password_hash, display_name) "
            "VALUES ('ada@example.com', :password_hash, 'Ada') RETURNING id"
        ),
        {"password_hash": HASH},
    ).scalar()
    db.execute(
        text(
            "INSERT INTO role_user (user_id, role_id) "
            "SELECT :user_id, id FROM roles WHERE code IN ('admin', 'viewer')"
        ),
        {"user_id": user_id},
    )

    count = db.execute(
        text("SELECT count(*) FROM role_user WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).scalar()
    assert count == 2

    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO role_user (user_id, role_id) "
                "SELECT :user_id, id FROM roles WHERE code = 'admin'"
            ),
            {"user_id": user_id},
        )


@pytest.mark.db
def test_email_is_unique_ignoring_case(db):
    db.execute(
        text(
            "INSERT INTO users (email, password_hash, display_name) "
            "VALUES ('ada@example.com', :password_hash, 'Ada')"
        ),
        {"password_hash": HASH},
    )
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO users (email, password_hash, display_name) "
                "VALUES ('Ada@example.com', :password_hash, 'Autre')"
            ),
            {"password_hash": HASH},
        )


@pytest.mark.db
def test_password_must_be_stored_as_a_hash(db):
    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO users (email, password_hash, display_name) "
                "VALUES ('bob@example.com', 'clair', 'Bob')"
            )
        )


@pytest.mark.db
def test_deleting_a_user_drops_roles_and_detaches_sites(db):
    user_id = db.execute(
        text(
            "INSERT INTO users (email, password_hash, display_name) "
            "VALUES ('ada@example.com', :password_hash, 'Ada') RETURNING id"
        ),
        {"password_hash": HASH},
    ).scalar()
    db.execute(
        text(
            "INSERT INTO role_user (user_id, role_id) "
            "SELECT :user_id, id FROM roles WHERE code = 'viewer'"
        ),
        {"user_id": user_id},
    )
    _site(db)
    db.execute(
        text("UPDATE sites SET client_user_id = :user_id WHERE site_id = 'SITE901'"),
        {"user_id": user_id},
    )

    db.execute(text("DELETE FROM users WHERE id = :user_id"), {"user_id": user_id})

    assert (
        db.execute(
            text("SELECT count(*) FROM role_user WHERE user_id = :user_id"),
            {"user_id": user_id},
        ).scalar()
        == 0
    )
    assert db.execute(text("SELECT 1 FROM roles WHERE code = 'admin'")).scalar() == 1
    client_id = db.execute(
        text("SELECT client_user_id FROM sites WHERE site_id = 'SITE901'")
    ).scalar()
    assert client_id is None


@pytest.mark.db
def test_current_is_upserted_and_requires_a_site(db):
    with pytest.raises(IntegrityError), db.begin_nested():
        _current(db, site_id="SITE404")

    _site(db, site_type="office", capacity=600)
    _site(db, site_type=None, capacity=None)
    kept = db.execute(
        text("SELECT site_type, capacity_kw FROM sites WHERE site_id = 'SITE901'")
    ).one()
    assert kept.site_type == "office"
    assert kept.capacity_kw == 600

    _current(db, consumption=None)
    _current(db, consumption=420)
    row = db.execute(
        text(
            "SELECT consumption_kw, null_reasons, data_quality "
            "FROM current WHERE site_id = 'SITE901'"
        )
    ).one()
    assert row.consumption_kw == 420
    assert row.null_reasons == ["network_loss"]
    assert row.data_quality == "good"
    assert db.execute(text("SELECT count(*) FROM current WHERE site_id = 'SITE901'")).scalar() == 1


@pytest.mark.db
def test_prediction_is_attached_to_a_site_and_keeps_one_row_per_period(db):
    _site(db)
    _current(db)
    first = _prediction(db, value=480, version=None)
    second = _prediction(db, value=510, version=None)
    assert first == second
    count = db.execute(text("SELECT count(*) FROM predictions WHERE site_id = 'SITE901'")).scalar()
    predicted = db.execute(
        text("SELECT predicted_kw FROM predictions WHERE site_id = 'SITE901'")
    ).scalar()
    assert count == 1
    assert predicted == 510

    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text(
                "SELECT upsert_prediction("
                "  'SITE901', 100,"
                "  timestamptz '2026-10-21 12:00:00+00',"
                "  timestamptz '2026-10-21 10:00:00+00',"
                "  'consumption_forecast', 'v1'"
                ")"
            )
        )

    db.execute(text("DELETE FROM sites WHERE site_id = 'SITE901'"))
    assert db.execute(text("SELECT count(*) FROM current WHERE site_id = 'SITE901'")).scalar() == 0
    remaining = db.execute(
        text("SELECT count(*) FROM predictions WHERE site_id = 'SITE901'")
    ).scalar()
    assert remaining == 0


def _role_engine(username: str, password: str):
    url = make_url(settings.database_url).set(username=username, password=password)
    return create_engine(
        url.render_as_string(hide_password=False),
        connect_args={"connect_timeout": 3},
    )


@pytest.mark.db
def test_app_and_ml_roles_have_distinct_access(schema):
    with engine.connect() as conn:
        try:
            app_can_read_users = conn.execute(
                text("SELECT has_table_privilege(:role, 'public.users', 'SELECT')"),
                {"role": APP_ROLE},
            ).scalar()
        except ProgrammingError:
            pytest.skip("rôles absents : sh scripts/apply_schema.sh")
        assert app_can_read_users is True
        assert (
            conn.execute(
                text("SELECT has_table_privilege(:role, 'public.users', 'SELECT')"),
                {"role": ML_ROLE},
            ).scalar()
            is False
        )
        assert (
            conn.execute(
                text("SELECT has_table_privilege(:role, 'public.current', 'INSERT')"),
                {"role": ML_ROLE},
            ).scalar()
            is True
        )
        assert (
            conn.execute(
                text("SELECT has_table_privilege(:role, 'public.predictions', 'DELETE')"),
                {"role": ML_ROLE},
            ).scalar()
            is False
        )
        assert (
            conn.execute(
                text("SELECT rolsuper FROM pg_roles WHERE rolname = :role"),
                {"role": APP_ROLE},
            ).scalar()
            is False
        )

    for username, password, allowed in (
        (APP_ROLE, APP_PASSWORD, True),
        (ML_ROLE, ML_PASSWORD, False),
    ):
        role_engine = _role_engine(username, password)
        try:
            with role_engine.connect() as conn:
                if allowed:
                    admins = conn.execute(
                        text("SELECT count(*) FROM roles WHERE code = 'admin'")
                    ).scalar()
                    assert admins == 1
                else:
                    with pytest.raises(ProgrammingError):
                        conn.execute(text("SELECT count(*) FROM users"))
        except OperationalError:
            return
        finally:
            role_engine.dispose()

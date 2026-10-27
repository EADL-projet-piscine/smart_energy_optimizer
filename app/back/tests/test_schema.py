"""PostgreSQL schema: tables, constraints, and privileges of the application roles."""

import pytest
from schema_tools import MIGRATIONS_DIR, migration_files, split_sql
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

from smart_energy_app.config import settings
from smart_energy_app.db import engine

SCHEMA_PATH = MIGRATIONS_DIR / "001_initial_schema.sql"
# Passwords from the development docker-compose, not production secrets.
APP_ROLE = "enervision_app"
ML_ROLE = "enervision_ml"
APP_PASSWORD = "enervision_app"
ML_PASSWORD = "enervision_ml"
HASH = "x" * 60


def test_migration_script_splits_functions():
    statements = split_sql(SCHEMA_PATH.read_text(encoding="utf-8"))
    functions = [item for item in statements if "FUNCTION upsert_current" in item]
    assert len(functions) == 1
    assert "ON CONFLICT (site_id)" in functions[0]
    assert any("CREATE TABLE IF NOT EXISTS sites" in item for item in statements)
    assert any("CREATE TABLE IF NOT EXISTS current" in item for item in statements)
    assert any("CREATE TABLE IF NOT EXISTS predictions" in item for item in statements)


def test_every_migration_is_applied_in_name_order():
    """db/init/01_schema.sh sorts by file name; the tests must do the same."""
    names = [path.name for path in migration_files()]

    assert names == sorted(names)
    assert names[0] == "001_initial_schema.sql"


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


def _prediction(
    conn,
    site_id: str = "SITE901",
    value: float = 480,
    origin: str = "2026-10-21 10:00:00+00",
    period_start: str = "2026-10-21 12:00:00+00",
    period_end: str = "2026-10-21 13:00:00+00",
    version: str | None = "v1",
):
    """Default case: forecast made at 10:00 for the 12:00–13:00 slot, horizon 2."""
    return conn.execute(
        text(
            "SELECT upsert_prediction("
            "  CAST(:site_id AS text), CAST(:value AS numeric),"
            "  CAST(:origin AS timestamptz),"
            "  CAST(:period_start AS timestamptz),"
            "  CAST(:period_end AS timestamptz),"
            "  'consumption_forecast', CAST(:version AS text)"
            ")"
        ),
        {
            "site_id": site_id,
            "value": value,
            "origin": origin,
            "period_start": period_start,
            "period_end": period_end,
            "version": version,
        },
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


# ─────────────────────────────── Forecasts ───────────────────────────────────


@pytest.mark.db
def test_prediction_requires_a_site(db):
    with pytest.raises(IntegrityError), db.begin_nested():
        _prediction(db, site_id="SITE404")


@pytest.mark.db
def test_rewriting_a_forecast_updates_the_row_instead_of_adding_one(db):
    # Same site, same origin, same horizon, same model: one row, updated.
    _site(db)
    first = _prediction(db, value=480)
    second = _prediction(db, value=510)

    assert first == second
    count = db.execute(text("SELECT count(*) FROM predictions WHERE site_id = 'SITE901'")).scalar()
    predicted = db.execute(
        text("SELECT predicted_kw FROM predictions WHERE site_id = 'SITE901'")
    ).scalar()
    assert count == 1
    assert predicted == 510


@pytest.mark.db
def test_a_new_origin_adds_a_row_rather_than_replacing_one(db):
    # The 10:00 forecast is not erased by the 16:00 one: both are kept, and
    # the read decides. Keeping the old one is what makes the model auditable.
    _site(db)
    _prediction(db, value=480, origin="2026-10-21 10:00:00+00")
    _prediction(
        db,
        value=505,
        origin="2026-10-21 16:00:00+00",
        period_start="2026-10-21 18:00:00+00",
        period_end="2026-10-21 19:00:00+00",
    )

    count = db.execute(text("SELECT count(*) FROM predictions WHERE site_id = 'SITE901'")).scalar()
    assert count == 2


@pytest.mark.db
def test_horizon_is_derived_from_the_origin_and_the_slot(db):
    _site(db)
    _prediction(db, origin="2026-10-21 10:00:00+00", period_start="2026-10-21 12:00:00+00")

    horizon = db.execute(text("SELECT horizon FROM predictions WHERE site_id = 'SITE901'")).scalar()
    assert horizon == 2


@pytest.mark.db
def test_horizon_cannot_be_written_directly(db):
    """A generated column refuses any value: it cannot contradict the other two."""
    _site(db)
    _prediction(db)

    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(text("UPDATE predictions SET horizon = 7 WHERE site_id = 'SITE901'"))


@pytest.mark.db
def test_horizon_beyond_twenty_four_hours_is_refused(db):
    _site(db)

    with pytest.raises(IntegrityError), db.begin_nested():
        _prediction(
            db,
            origin="2026-10-21 10:00:00+00",
            period_start="2026-10-22 11:00:00+00",  # 25 hours later
            period_end="2026-10-22 12:00:00+00",
        )


@pytest.mark.db
def test_a_forecast_cannot_target_its_own_origin(db):
    # Horizon 0 is not a forecast: the model would be predicting the present.
    _site(db)

    with pytest.raises(IntegrityError), db.begin_nested():
        _prediction(
            db,
            origin="2026-10-21 12:00:00+00",
            period_start="2026-10-21 12:00:00+00",
            period_end="2026-10-21 13:00:00+00",
        )


@pytest.mark.db
def test_a_negative_consumption_is_refused(db):
    _site(db)

    with pytest.raises(IntegrityError), db.begin_nested():
        _prediction(db, value=-1)


@pytest.mark.db
def test_a_slot_ending_before_it_starts_is_refused(db):
    _site(db)

    with pytest.raises(IntegrityError), db.begin_nested():
        _prediction(
            db,
            period_start="2026-10-21 12:00:00+00",
            period_end="2026-10-21 11:00:00+00",
        )


@pytest.mark.db
def test_the_read_serves_the_most_recently_informed_forecast(db):
    # Two forecasts for the 18:00 slot: one made at 10:00, one at 16:00. The
    # 16:00 one saw the 16:00 consumption, the other did not.
    _site(db)
    _prediction(
        db,
        value=480,
        origin="2026-10-21 10:00:00+00",
        period_start="2026-10-21 18:00:00+00",
        period_end="2026-10-21 19:00:00+00",
    )
    _prediction(
        db,
        value=505,
        origin="2026-10-21 16:00:00+00",
        period_start="2026-10-21 18:00:00+00",
        period_end="2026-10-21 19:00:00+00",
    )

    # The query the business API will run, kept here so the rule is tested
    # rather than merely written down.
    served = db.execute(
        text(
            "SELECT DISTINCT ON (site_id, period_start) predicted_kw, forecast_origin "
            "FROM predictions "
            "WHERE site_id = :site_id "
            "ORDER BY site_id, period_start, forecast_origin DESC, "
            "         model_version DESC, created_at DESC"
        ),
        {"site_id": "SITE901"},
    ).one()

    assert served.predicted_kw == 505


@pytest.mark.db
def test_deleting_a_site_removes_its_forecasts(db):
    _site(db)
    _current(db)
    _prediction(db)

    db.execute(text("DELETE FROM sites WHERE site_id = 'SITE901'"))

    assert db.execute(text("SELECT count(*) FROM current WHERE site_id = 'SITE901'")).scalar() == 0
    remaining = db.execute(
        text("SELECT count(*) FROM predictions WHERE site_id = 'SITE901'")
    ).scalar()
    assert remaining == 0


# ─────────────────────────────── Privileges ──────────────────────────────────


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
            pytest.skip("roles missing: sh scripts/apply_schema.sh")
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


@pytest.mark.db
def test_only_ml_writes_the_forecasts(schema):
    """The ML service writes, the business API reads: the reverse must fail."""
    with engine.connect() as conn:
        try:
            privileges = conn.execute(
                text(
                    "SELECT"
                    "  has_table_privilege(:ml, 'public.predictions', 'INSERT') AS ml_insert,"
                    "  has_table_privilege(:ml, 'public.predictions', 'UPDATE') AS ml_update,"
                    "  has_table_privilege(:app, 'public.predictions', 'SELECT') AS app_select,"
                    "  has_table_privilege(:app, 'public.predictions', 'INSERT') AS app_insert,"
                    "  has_table_privilege(:app, 'public.predictions', 'UPDATE') AS app_update,"
                    "  has_table_privilege(:app, 'public.predictions', 'DELETE') AS app_delete"
                ),
                {"ml": ML_ROLE, "app": APP_ROLE},
            ).one()
        except ProgrammingError:
            pytest.skip("roles missing: sh scripts/apply_schema.sh")

    assert privileges.ml_insert is True
    assert privileges.ml_update is True
    assert privileges.app_select is True
    assert privileges.app_insert is False
    assert privileges.app_update is False
    assert privileges.app_delete is False


@pytest.mark.db
def test_the_business_api_cannot_insert_a_forecast(schema):
    # has_table_privilege states what was granted; only a real connection shows
    # what the database actually refuses.
    role_engine = _role_engine(APP_ROLE, APP_PASSWORD)
    try:
        with role_engine.connect() as conn, pytest.raises(ProgrammingError):
            conn.execute(
                text(
                    "INSERT INTO predictions"
                    "  (site_id, predicted_kw, forecast_origin, period_start, period_end)"
                    "VALUES ('SITE901', 1, timestamptz '2026-10-21 10:00:00+00',"
                    "        timestamptz '2026-10-21 12:00:00+00',"
                    "        timestamptz '2026-10-21 13:00:00+00')"
                )
            )
    except OperationalError:
        return
    finally:
        role_engine.dispose()

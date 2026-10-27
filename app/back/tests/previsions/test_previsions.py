"""Forecast reading: the most recently informed one wins."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from smart_energy_app.db import engine
from smart_energy_app.main import app

SITE = "SITE902"


def _site(conn, site_id: str = SITE):
    conn.execute(
        text(
            "SELECT upsert_site("
            "CAST(:site_id AS text), CAST(:name AS text), NULL::text, 500::numeric)"
        ),
        {"site_id": site_id, "name": f"Site {site_id}"},
    )


def _forecast(conn, site_id: str, value: float, origin_hours: int, target_hours: int):
    """A forecast made `origin_hours` ago for a slot `target_hours` from now."""
    conn.execute(
        text(
            "SELECT upsert_prediction("
            "  CAST(:site_id AS text), CAST(:value AS numeric),"
            "  date_trunc('hour', now()) - make_interval(hours => :origin_hours),"
            "  date_trunc('hour', now()) + make_interval(hours => :target_hours),"
            "  date_trunc('hour', now()) + make_interval(hours => :target_hours + 1),"
            "  'consumption_forecast', 'test'"
            ")"
        ),
        {
            "site_id": site_id,
            "value": value,
            "origin_hours": origin_hours,
            "target_hours": target_hours,
        },
    )


@pytest.fixture
def seeded(schema):
    """Creates the test site, then deletes it — the cascade takes its forecasts.

    A rollback would not do: the route opens its own connection and only sees
    committed rows, so the test has to commit. Cleaning up therefore means
    deleting, not undoing.

    `schema` comes from tests/conftest.py: in CI the database starts empty, and
    this file runs before tests/test_schema.py.
    """
    with engine.connect() as conn:
        _site(conn)
        conn.commit()
        try:
            yield conn
        finally:
            conn.execute(text("DELETE FROM sites WHERE site_id = :site_id"), {"site_id": SITE})
            conn.commit()


@pytest.mark.db
def test_forecasts_are_grouped_by_site(seeded):
    _forecast(seeded, SITE, value=120, origin_hours=0, target_hours=1)
    seeded.commit()

    body = TestClient(app).get("/api/previsions").json()

    assert SITE in body["sites"]
    assert body["sites"][SITE][0]["predicted_kw"] == 120.0
    assert body["sites"][SITE][0]["horizon"] == 1


@pytest.mark.db
def test_the_most_recently_informed_forecast_wins(seeded):
    # Same slot, two origins: the one made six hours ago saw less.
    _forecast(seeded, SITE, value=480, origin_hours=6, target_hours=2)
    _forecast(seeded, SITE, value=505, origin_hours=0, target_hours=2)
    seeded.commit()

    body = TestClient(app).get("/api/previsions").json()
    points = [item for item in body["sites"][SITE] if item["horizon"] == 2]

    assert len(points) == 1
    assert points[0]["predicted_kw"] == 505.0


@pytest.mark.db
def test_a_past_slot_is_not_served(seeded):
    # The real measurement exists for a slot already gone; a forecast for it
    # would only clutter the chart.
    _forecast(seeded, SITE, value=300, origin_hours=6, target_hours=-3)
    seeded.commit()

    body = TestClient(app).get("/api/previsions").json()

    assert body["sites"].get(SITE, []) == []


@pytest.mark.db
def test_the_window_bounds_the_answer(seeded):
    _forecast(seeded, SITE, value=120, origin_hours=0, target_hours=1)
    _forecast(seeded, SITE, value=130, origin_hours=0, target_hours=20)
    seeded.commit()

    body = TestClient(app).get("/api/previsions").json()
    horizons = [item["horizon"] for item in body["sites"][SITE]]

    assert max(horizons) <= body["horizon_hours"]


@pytest.mark.db
def test_every_point_carries_its_provenance(seeded):
    # A forecast without its origin and its model cannot be checked.
    _forecast(seeded, SITE, value=120, origin_hours=0, target_hours=1)
    seeded.commit()

    point = TestClient(app).get("/api/previsions").json()["sites"][SITE][0]

    assert point["forecast_origin"] is not None
    assert point["model_name"] == "consumption_forecast"
    assert point["model_version"] == "test"
    assert point["period_end"] is not None


@pytest.mark.db
def test_a_site_route_returns_its_own_points(seeded):
    _forecast(seeded, SITE, value=120, origin_hours=0, target_hours=1)
    seeded.commit()

    body = TestClient(app).get(f"/api/previsions/{SITE}").json()

    assert body["site_id"] == SITE
    assert len(body["points"]) == 1


@pytest.mark.db
def test_a_site_without_forecast_is_not_a_404(seeded):
    # The model may simply not have run for it yet.
    response = TestClient(app).get("/api/previsions/SITE999")

    assert response.status_code == 200
    assert response.json()["points"] == []

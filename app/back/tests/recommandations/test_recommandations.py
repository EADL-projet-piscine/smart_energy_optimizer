"""Advice attached to capacity alerts: who gets told what."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from smart_energy_app.alertes.capacite import CapacityAlert, capacity_alerts
from smart_energy_app.consommation.details import state as details_state
from smart_energy_app.consommation.routes import _with_recommendations
from smart_energy_app.consommation.service import state
from smart_energy_app.db import engine
from smart_energy_app.main import app
from smart_energy_app.recommandations.repository import Recommendations, recommendations

SITUATIONS = ("capacite_moyenne", "capacite_critique")
SITE_TYPES = ("office", "factory", "datacenter", "retail", "hospital", "unknown")

# Sites that must never be told to cut their consumption.
CONTINUOUS_SITES = ("hospital", "datacenter")
SHEDDING_WORDS = ("délester", "économie d'énergie", "interrompre")


def _depot(by_key: dict) -> Recommendations:
    """A reference table filled by hand, with no database behind it."""
    depot = Recommendations()
    depot.by_key = by_key
    return depot


def _loaded() -> Recommendations:
    """The real reference table, read from the database."""
    depot = Recommendations()
    assert depot.load(), "the reference table could not be read"
    return depot


# --- Choosing the advice ---------------------------------------------------


def test_the_site_type_decides_which_advice_is_served():
    depot = _depot(
        {
            ("capacite_critique", "office"): [{"action": "Délester"}],
            ("capacite_critique", "hospital"): [{"action": "Vérifier les groupes"}],
        }
    )

    assert depot.for_situation("capacite_critique", "office")[0]["action"] == "Délester"
    assert depot.for_situation("capacite_critique", "hospital")[0]["action"] == (
        "Vérifier les groupes"
    )


def test_an_unknown_site_type_falls_back_instead_of_staying_silent():
    # An alert with no advice at all reads as a broken screen, not as a site
    # with nothing to do.
    depot = _depot({("capacite_critique", "unknown"): [{"action": "Investiguer"}]})

    assert depot.for_situation("capacite_critique", "warehouse")[0]["action"] == "Investiguer"
    assert depot.for_situation("capacite_critique", None)[0]["action"] == "Investiguer"


def test_a_situation_without_any_rule_serves_nothing():
    depot = _depot({("capacite_moyenne", "office"): [{"action": "Reporter"}]})

    assert depot.for_situation("capacite_critique", "office") == []


# --- The reference table itself --------------------------------------------


@pytest.mark.db
def test_every_pair_has_at_least_one_active_advice(schema):
    """Fails the day a situation is added without filling the reference table.

    This is the guarantee that replaces a catch-all row: no pair may be left
    without advice, because nothing on screen would say so.
    """
    depot = _loaded()

    missing = [
        (situation, site_type)
        for situation in SITUATIONS
        for site_type in SITE_TYPES
        if not depot.by_key.get((situation, site_type))
    ]

    assert missing == []


@pytest.mark.db
def test_a_continuous_site_is_never_told_to_cut_its_consumption(schema):
    """A hospital does not shed load, and a data centre does not either."""
    depot = _loaded()

    for site_type in CONTINUOUS_SITES:
        for situation in SITUATIONS:
            actions = " ".join(
                conseil["action"].lower() for conseil in depot.by_key[(situation, site_type)]
            )
            for word in SHEDDING_WORDS:
                assert word not in actions, f"{situation}/{site_type} propose « {word} »"


@pytest.mark.db
def test_advice_comes_in_the_order_the_table_fixes(schema):
    depot = _loaded()
    actions = [conseil["action"] for conseil in depot.by_key[("capacite_critique", "office")]]

    assert actions[0].startswith("Délester")
    assert actions[-1].startswith("Investiguer")


@pytest.mark.db
def test_a_disabled_advice_leaves_the_answer(schema):
    """`active` filters in the API, so a retired advice never reaches a screen."""
    with engine.connect() as conn:
        conn.execute(text("UPDATE recommendations SET active = false WHERE code = 'mode_economie'"))
        conn.commit()
        try:
            actions = [
                conseil["action"] for conseil in _loaded().by_key[("capacite_critique", "office")]
            ]
            assert not any("économie d'énergie" in action for action in actions)
        finally:
            conn.execute(
                text("UPDATE recommendations SET active = true WHERE code = 'mode_economie'")
            )
            conn.commit()


# --- What the database refuses ---------------------------------------------


@pytest.mark.db
def test_the_same_advice_cannot_be_listed_twice_in_one_list(schema):
    # Two different ranks would satisfy the primary key, hence the separate
    # unique constraint.
    with engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(
            text(
                """
                INSERT INTO recommendation_rules
                    (situation, site_type, recommendation_id, priority)
                SELECT situation, site_type, recommendation_id, 99
                FROM recommendation_rules
                WHERE situation = 'capacite_critique'
                  AND site_type = 'office'
                  AND priority = 1
                """
            )
        )


@pytest.mark.db
def test_two_pieces_of_advice_cannot_share_a_rank(schema):
    with engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(
            text(
                """
                INSERT INTO recommendation_rules
                    (situation, site_type, recommendation_id, priority)
                SELECT 'capacite_critique', 'office', id, 1
                FROM recommendations WHERE code = 'prevenir_exploitant'
                """
            )
        )


@pytest.mark.db
def test_a_site_type_outside_the_list_is_refused(schema):
    """The admissible values live in the database, not in the writer's head."""
    with engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(
            text(
                """
                INSERT INTO recommendation_rules
                    (situation, site_type, recommendation_id, priority)
                SELECT 'capacite_critique', 'warehouse', id, 9
                FROM recommendations WHERE code = 'prevenir_exploitant'
                """
            )
        )


@pytest.mark.db
def test_an_advice_still_in_use_cannot_be_deleted(schema):
    # Retiring an advice means disabling it; deleting it would silently empty
    # the lists that point at it.
    with engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(text("DELETE FROM recommendations WHERE code = 'investiguer_hausse'"))


@pytest.mark.db
def test_updated_at_follows_an_edit(schema):
    """The V2 edits this table online: a column nobody maintains would lie."""
    read = text("SELECT updated_at FROM recommendations WHERE code = 'mode_economie'")
    with engine.connect() as conn:
        before = conn.execute(read).scalar_one()
        conn.execute(
            text("UPDATE recommendations SET action = action WHERE code = 'mode_economie'")
        )
        after = conn.execute(read).scalar_one()
        conn.rollback()

    assert after > before


# --- What the route serves -------------------------------------------------


@pytest.fixture
def parc():
    """Puts the API in a state where /api/consommations answers at all."""
    state.data = {"timestamp": "2026-10-28T09:00:00", "sites": []}
    state.fetched_at = datetime.now(UTC)
    capacity_alerts.by_site.clear()
    saved_types = dict(details_state.site_types)
    try:
        yield
    finally:
        state.data = None
        state.fetched_at = None
        capacity_alerts.by_site.clear()
        details_state.site_types = saved_types


def _raise_alert(site_id: str, severity: str, site_type: str | None) -> None:
    if site_type is not None:
        details_state.site_types[site_id] = site_type
    capacity_alerts.by_site[site_id] = CapacityAlert(
        site_id=site_id,
        severity=severity,
        raised_at=datetime.now(UTC),
        load_percent=95.0,
        capacity_kw=500.0,
    )


@pytest.mark.db
def test_an_alert_carries_the_advice_of_its_site_type(parc, schema):
    recommendations.load()
    _raise_alert("SITE901", "critique", "hospital")

    alerte = TestClient(app).get("/api/consommations").json()["alertes"][0]
    actions = [conseil["action"] for conseil in alerte["recommandations"]]

    assert actions
    assert not any("Délester" in action for action in actions)


@pytest.mark.db
def test_two_sites_in_the_same_state_get_different_advice(parc, schema):
    # Same severity, same load: only the type changes what is proposed.
    recommendations.load()
    _raise_alert("SITE901", "critique", "office")
    _raise_alert("SITE902", "critique", "hospital")

    alertes = TestClient(app).get("/api/consommations").json()["alertes"]
    by_site = {alerte["site_id"]: alerte["recommandations"] for alerte in alertes}

    assert by_site["SITE901"][0]["action"] != by_site["SITE902"][0]["action"]


def test_the_advice_key_is_always_there_even_empty():
    """One case for the dashboard instead of two.

    `info` is a severity the source can send; it matches no capacity
    situation, and must not make the key disappear.
    """
    alertes = _with_recommendations([{"site_id": "SITE901", "severity": "info"}])

    assert alertes[0]["recommandations"] == []

from datetime import UTC, datetime

import pytest

from smart_energy_app.alertes.capacite import CRITIQUE, MOYENNE, CapacityAlerts

T1 = datetime(2026, 10, 26, 11, 54, tzinfo=UTC)
T2 = datetime(2026, 10, 26, 12, 54, tzinfo=UTC)


def resume(*sites: dict) -> dict:
    return {"timestamp": "2026-10-26T11:54:00", "sites": list(sites)}


def site(site_id: str, load: object, capacity: object = 200) -> dict:
    return {
        "site_id": site_id,
        "site_name": f"Site {site_id}",
        "current_consumption_kw": 100.0,
        "capacity_kw": capacity,
        "load_percent": load,
        "data_quality": "good",
    }


@pytest.fixture
def alertes():
    return CapacityAlerts()


# ─────────────────────────────── Levée ───────────────────────────────────────


def test_leve_une_alerte_critique_a_pleine_capacite(alertes):
    alertes.evaluate(resume(site("SITE001", 101.3)), T1)

    alerte = alertes.by_site["SITE001"]
    assert alerte.severity == CRITIQUE
    assert alerte.raised_at == T1
    assert alerte.load_percent == 101.3
    assert alerte.capacity_kw == 200


def test_leve_une_alerte_moyenne_a_l_approche(alertes):
    alertes.evaluate(resume(site("SITE001", 92.0)), T1)

    assert alertes.by_site["SITE001"].severity == MOYENNE


def test_ne_leve_rien_sous_le_seuil(alertes):
    alertes.evaluate(resume(site("SITE001", 78.4)), T1)

    assert alertes.by_site == {}


def test_porte_un_message_lisible(alertes):
    alertes.evaluate(resume(site("SITE001", 101.3)), T1)

    assert alertes.as_payload()[0]["message"] == "La capacité de l'installation est dépassée"


# ─────────────────────────────── Hystérésis ──────────────────────────────────


def test_une_alerte_levee_survit_a_la_zone_intermediaire(alertes):
    # Entre 85 et 90, rien ne change : sans cette zone, un site qui oscille
    # autour de 90 verrait son alerte clignoter à chaque cycle.
    alertes.evaluate(resume(site("SITE001", 92.0)), T1)

    alertes.evaluate(resume(site("SITE001", 87.0)), T2)

    assert alertes.by_site["SITE001"].severity == MOYENNE


def test_la_zone_intermediaire_ne_leve_pas_d_alerte(alertes):
    alertes.evaluate(resume(site("SITE001", 87.0)), T1)

    assert alertes.by_site == {}


def test_s_eteint_sous_le_seuil_de_retour(alertes):
    alertes.evaluate(resume(site("SITE001", 101.3)), T1)

    alertes.evaluate(resume(site("SITE001", 84.9)), T2)

    assert alertes.by_site == {}


# ─────────────────────────────── Continuité ──────────────────────────────────


def test_une_alerte_qui_dure_garde_son_horodatage(alertes):
    alertes.evaluate(resume(site("SITE001", 92.0)), T1)

    alertes.evaluate(resume(site("SITE001", 94.0)), T2)

    alerte = alertes.by_site["SITE001"]
    assert alerte.raised_at == T1
    # La charge, elle, suit : c'est ce qui dit si la situation empire.
    assert alerte.load_percent == 94.0


def test_un_changement_de_gravite_est_un_nouvel_evenement(alertes):
    alertes.evaluate(resume(site("SITE001", 92.0)), T1)

    alertes.evaluate(resume(site("SITE001", 101.0)), T2)

    alerte = alertes.by_site["SITE001"]
    assert alerte.severity == CRITIQUE
    assert alerte.raised_at == T2


def test_une_retombee_de_critique_a_moyenne_est_datee(alertes):
    alertes.evaluate(resume(site("SITE001", 101.0)), T1)

    alertes.evaluate(resume(site("SITE001", 95.0)), T2)

    alerte = alertes.by_site["SITE001"]
    assert alerte.severity == MOYENNE
    assert alerte.raised_at == T2


# ─────────────────────────────── Charge inconnue ─────────────────────────────


def test_une_charge_inconnue_ne_leve_aucune_alerte(alertes):
    alertes.evaluate(resume(site("SITE001", None)), T1)

    assert alertes.by_site == {}


def test_une_charge_inconnue_n_eteint_pas_une_alerte(alertes):
    # L'absence de mesure n'est pas une preuve que la situation s'est calmée.
    alertes.evaluate(resume(site("SITE001", 101.3)), T1)

    alertes.evaluate(resume(site("SITE001", None)), T2)

    assert alertes.by_site["SITE001"].severity == CRITIQUE
    assert alertes.by_site["SITE001"].raised_at == T1


def test_ignore_une_charge_non_numerique(alertes):
    alertes.evaluate(resume(site("SITE001", "92 %")), T1)

    assert alertes.by_site == {}


def test_accepte_une_capacite_inconnue(alertes):
    alertes.evaluate(resume(site("SITE001", 101.3, capacity=None)), T1)

    assert alertes.by_site["SITE001"].capacity_kw is None


# ─────────────────────────────── Plusieurs sites ─────────────────────────────


def test_traite_chaque_site_independamment(alertes):
    alertes.evaluate(resume(site("SITE001", 101.3), site("SITE002", 50.0)), T1)

    assert set(alertes.by_site) == {"SITE001"}


def test_eteint_un_site_sans_toucher_aux_autres(alertes):
    alertes.evaluate(resume(site("SITE001", 101.3), site("SITE002", 95.0)), T1)

    alertes.evaluate(resume(site("SITE001", 50.0), site("SITE002", 95.0)), T2)

    assert set(alertes.by_site) == {"SITE002"}
    assert alertes.by_site["SITE002"].raised_at == T1


# ─────────────────────────────── Robustesse ──────────────────────────────────


def test_ignore_un_site_sans_identifiant(alertes):
    alertes.evaluate(resume({"load_percent": 101.3}), T1)

    assert alertes.by_site == {}


def test_supporte_un_resume_illisible(alertes):
    # La boucle de rafraîchissement ne doit jamais mourir sur une réponse
    # inattendue de l'API source.
    alertes.evaluate(None, T1)
    alertes.evaluate([], T1)
    alertes.evaluate({"sites": "pas une liste"}, T1)
    alertes.evaluate({"sites": ["pas un objet"]}, T1)

    assert alertes.by_site == {}


def test_expose_une_liste_serialisable(alertes):
    alertes.evaluate(resume(site("SITE001", 101.3)), T1)

    assert alertes.as_payload() == [
        {
            "site_id": "SITE001",
            "severity": CRITIQUE,
            "message": "La capacité de l'installation est dépassée",
            "raised_at": "2026-10-26T11:54:00+00:00",
            "load_percent": 101.3,
            "capacity_kw": 200.0,
        }
    ]


def test_expose_une_liste_vide_sans_alerte(alertes):
    assert alertes.as_payload() == []

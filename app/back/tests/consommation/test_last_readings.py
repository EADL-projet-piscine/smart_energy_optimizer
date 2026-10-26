from datetime import UTC, datetime

from smart_energy_app.consommation.last_readings import LastReadings

T1 = datetime(2026, 10, 26, 11, 54, tzinfo=UTC)
T2 = datetime(2026, 10, 26, 12, 54, tzinfo=UTC)


def resume(*sites: dict) -> dict:
    return {"timestamp": "2026-10-26T11:54:00", "sites": list(sites)}


def site(site_id: str, consumption: object) -> dict:
    return {
        "site_id": site_id,
        "site_name": f"Site {site_id}",
        "current_consumption_kw": consumption,
        "capacity_kw": 200,
        "load_percent": 50.0,
        "data_quality": "good",
    }


def test_retient_la_consommation_mesuree():
    readings = LastReadings()

    readings.remember(resume(site("SITE001", 176.4)), T1)

    assert readings.by_site["SITE001"]["consumption_kw"] == 176.4
    assert readings.by_site["SITE001"]["at"] == T1


def test_une_valeur_absente_n_efface_pas_la_precedente():
    # C'est la raison d'être du module : l'API renvoie null dès qu'un site se
    # tait, et le cycle suivant effacerait ce qu'on savait.
    readings = LastReadings()
    readings.remember(resume(site("SITE001", 176.4)), T1)

    readings.remember(resume(site("SITE001", None)), T2)

    assert readings.by_site["SITE001"]["consumption_kw"] == 176.4
    assert readings.by_site["SITE001"]["at"] == T1


def test_une_nouvelle_mesure_remplace_l_ancienne():
    readings = LastReadings()
    readings.remember(resume(site("SITE001", 176.4)), T1)

    readings.remember(resume(site("SITE001", 210.0)), T2)

    assert readings.by_site["SITE001"]["consumption_kw"] == 210.0
    assert readings.by_site["SITE001"]["at"] == T2


def test_un_site_muet_n_affecte_pas_les_autres():
    readings = LastReadings()
    readings.remember(resume(site("SITE001", 176.4), site("SITE002", 783.7)), T1)

    readings.remember(resume(site("SITE001", None), site("SITE002", 800.0)), T2)

    assert readings.by_site["SITE001"]["consumption_kw"] == 176.4
    assert readings.by_site["SITE002"]["consumption_kw"] == 800.0


def test_accepte_un_entier():
    readings = LastReadings()

    readings.remember(resume(site("SITE001", 176)), T1)

    assert readings.by_site["SITE001"]["consumption_kw"] == 176.0


def test_refuse_un_booleen():
    # bool est une sous-classe de int : sans garde-fou, true vaudrait 1 kW.
    readings = LastReadings()

    readings.remember(resume(site("SITE001", True)), T1)

    assert readings.by_site == {}


def test_refuse_une_valeur_non_numerique():
    readings = LastReadings()

    readings.remember(resume(site("SITE001", "176,4")), T1)

    assert readings.by_site == {}


def test_ignore_un_site_sans_identifiant():
    readings = LastReadings()

    readings.remember(resume({"current_consumption_kw": 176.4}), T1)

    assert readings.by_site == {}


def test_ignore_un_identifiant_vide():
    readings = LastReadings()

    readings.remember(resume(site("", 176.4)), T1)

    assert readings.by_site == {}


def test_supporte_un_resume_illisible():
    # La boucle de rafraîchissement ne doit jamais mourir sur une réponse
    # inattendue de l'API source.
    readings = LastReadings()

    readings.remember(None, T1)
    readings.remember([], T1)
    readings.remember({"sites": "pas une liste"}, T1)
    readings.remember({"sites": ["pas un objet"]}, T1)

    assert readings.by_site == {}


def test_expose_un_horodatage_serialisable():
    readings = LastReadings()
    readings.remember(resume(site("SITE001", 176.4)), T1)

    payload = readings.as_payload()

    assert payload == {"SITE001": {"consumption_kw": 176.4, "at": "2026-10-26T11:54:00+00:00"}}


def test_expose_un_objet_vide_sans_mesure():
    assert LastReadings().as_payload() == {}

import logging
from datetime import timedelta
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from smart_energy_app.alertes.capacite import SITUATIONS, capacity_alerts
from smart_energy_app.auth import CurrentPrincipal, Principal, forbidden_site
from smart_energy_app.config import settings
from smart_energy_app.consommation.details import state as details_state
from smart_energy_app.consommation.historique import load_history
from smart_energy_app.consommation.last_readings import last_readings
from smart_energy_app.consommation.payload import number_of, site_id_of, sites_of
from smart_energy_app.consommation.service import state
from smart_energy_app.recommandations.repository import recommendations

logger = logging.getLogger(__name__)

router = APIRouter()


def _visible_summary(data: dict, principal: Principal) -> dict:
    """Le résumé de l'API source, réduit aux sites que l'appelant peut voir.

    Les totaux sont recalculés sur ces sites, et toute autre clé agrégée est retirée :
    un client ne doit rien apprendre du reste du parc.
    """
    if principal.site_ids is None:
        return data
    sites = [site for site in sites_of(data) if principal.can_see(site_id_of(site) or "")]
    consumptions = [v for s in sites if (v := number_of(s, "current_consumption_kw")) is not None]
    capacities = [v for s in sites if (v := number_of(s, "capacity_kw")) is not None]
    loads = [v for s in sites if (v := number_of(s, "load_percent")) is not None]
    return {
        "timestamp": data.get("timestamp"),
        "total_sites": len(sites),
        # Comme l'API source : un site sans mesure ne compte pas dans le total.
        "total_consumption_kw": round(sum(consumptions), 2),
        "total_capacity_kw": round(sum(capacities), 2),
        "average_load_percent": round(sum(loads) / len(loads), 1) if loads else None,
        "sites": sites,
    }


def _with_recommendations(alertes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attache à chaque alerte les conseils de sa situation et de son type de site.

    La correspondance se fait ici et non à l'écran : déduire une situation
    d'une gravité serait une règle métier dans le dashboard, qui n'en porte
    aucune.

    La clé est toujours présente, même vide : au dashboard de ne rien afficher
    plutôt que d'avoir à distinguer une absence de clé d'une liste vide.
    """
    enrichies = []
    for alerte in alertes:
        situation = SITUATIONS.get(alerte.get("severity", ""))
        conseils = (
            recommendations.for_situation(situation, details_state.site_type(alerte["site_id"]))
            if situation is not None
            else []
        )
        enrichies.append({**alerte, "recommandations": conseils})
    return enrichies


# Chemin vide : le préfixe du routeur porte déjà « /api/consommations ».
# Un « / » ici produirait une barre finale et une redirection 307 à chaque appel.
@router.get("", summary="Consommation courante de tous les sites")
def consumption_summary(principal: CurrentPrincipal) -> dict:
    if state.data is None:
        raise HTTPException(
            status_code=503,
            detail="Aucune mesure disponible : l'API source n'a pas encore répondu.",
        )
    # next_at annonce quand la prochaine mesure sera disponible : le client peut
    # se caler dessus au lieu de sonder à l'aveugle.
    next_at = state.fetched_at + timedelta(seconds=settings.consumption_refresh_s)
    return {
        "data": _visible_summary(state.data, principal),
        "fetched_at": state.fetched_at.isoformat(),
        "next_at": next_at.isoformat(),
        "stale": state.is_stale(),
        # À côté de la mesure courante, jamais à sa place : le client doit
        # pouvoir distinguer une mesure de l'instant d'un souvenir.
        "last_readings": principal.visible(last_readings.as_payload()),
        # Calculées depuis la charge constatée, contrairement à celles de
        # l'API source qui en sont décorrélées. Les conseils sont attachés
        # après le filtrage : inutile d'en calculer pour une alerte que
        # l'appelant ne verra pas.
        "alertes": _with_recommendations(principal.visible_items(capacity_alerts.as_payload())),
    }


# Singulier : « historique » est une vue calculée sur la collection, pas une
# collection d'historiques. Le pluriel est porté par le préfixe.
@router.get("/historique", summary="Consommation des dernières 24 heures")
async def consumption_history(principal: CurrentPrincipal) -> dict:
    try:
        history = await load_history()
    except httpx.HTTPStatusError as error:
        logger.warning("Historique : l'API source a répondu %s", error.response.status_code)
        raise HTTPException(
            status_code=502,
            detail="L'API source a refusé la demande d'historique.",
        ) from error
    except httpx.HTTPError as error:
        logger.warning("Historique indisponible : %s", error)
        raise HTTPException(
            status_code=503,
            detail="L'API source est injoignable.",
        ) from error
    return {**history, "sites": principal.visible(history["sites"])}


@router.get("/sites", summary="Détail temps réel de tous les sites")
def site_details(principal: CurrentPrincipal) -> dict:
    if not details_state.by_site:
        raise HTTPException(
            status_code=503,
            detail="Aucun détail disponible : l'API source n'a pas encore répondu.",
        )
    return {
        "sites": {
            site_id: details_state.as_payload(site_id)
            for site_id in details_state.by_site
            if principal.can_see(site_id)
        }
    }


@router.get(
    "/sites/{site_id}",
    summary="Détail temps réel d'un site",
    responses={403: {"description": "Site hors du périmètre de l'utilisateur"}},
)
def site_detail(site_id: str, principal: CurrentPrincipal) -> dict:
    # Avant tout autre contrôle : un 404 révélerait qu'un site existe ou non.
    if not principal.can_see(site_id):
        raise forbidden_site(site_id)
    payload = details_state.as_payload(site_id)
    if payload is None:
        # Distinguer les deux cas : un identifiant inconnu est une erreur du
        # client, une absence de mesure est une indisponibilité du service.
        if site_id not in details_state.site_ids:
            raise HTTPException(status_code=404, detail=f"Site inconnu : {site_id}")
        raise HTTPException(
            status_code=503,
            detail=f"Aucune mesure disponible pour {site_id}.",
        )
    return payload

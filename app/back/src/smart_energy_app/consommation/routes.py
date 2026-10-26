import logging
from datetime import timedelta

import httpx
from fastapi import APIRouter, HTTPException

from smart_energy_app.config import settings
from smart_energy_app.consommation.details import state as details_state
from smart_energy_app.consommation.historique import load_history
from smart_energy_app.consommation.service import state

logger = logging.getLogger(__name__)

router = APIRouter()


# Chemin vide : le préfixe du routeur porte déjà « /api/consommations ».
# Un « / » ici produirait une barre finale et une redirection 307 à chaque appel.
@router.get("", summary="Consommation courante de tous les sites")
def consumption_summary() -> dict:
    if state.data is None:
        raise HTTPException(
            status_code=503,
            detail="Aucune mesure disponible : l'API source n'a pas encore répondu.",
        )
    # next_at annonce quand la prochaine mesure sera disponible : le client peut
    # se caler dessus au lieu de sonder à l'aveugle.
    next_at = state.fetched_at + timedelta(seconds=settings.consumption_refresh_s)
    return {
        "data": state.data,
        "fetched_at": state.fetched_at.isoformat(),
        "next_at": next_at.isoformat(),
        "stale": state.is_stale(),
    }


# Singulier : « historique » est une vue calculée sur la collection, pas une
# collection d'historiques. Le pluriel est porté par le préfixe.
@router.get("/historique", summary="Consommation des dernières 24 heures")
async def consumption_history() -> dict:
    try:
        return await load_history()
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


@router.get("/sites", summary="Détail temps réel de tous les sites")
def site_details() -> dict:
    if not details_state.by_site:
        raise HTTPException(
            status_code=503,
            detail="Aucun détail disponible : l'API source n'a pas encore répondu.",
        )
    return {
        "sites": {site_id: details_state.as_payload(site_id) for site_id in details_state.by_site}
    }


@router.get("/sites/{site_id}", summary="Détail temps réel d'un site")
def site_detail(site_id: str) -> dict:
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

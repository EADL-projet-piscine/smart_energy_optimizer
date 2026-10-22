import logging
from datetime import timedelta

import httpx
from fastapi import APIRouter, HTTPException

from smart_energy_app.config import settings
from smart_energy_app.consommation.historique import load_history
from smart_energy_app.consommation.service import state

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/resume", summary="Consommation courante de tous les sites")
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

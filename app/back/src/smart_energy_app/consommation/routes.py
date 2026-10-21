from fastapi import APIRouter, HTTPException

from smart_energy_app.consommation.service import state

router = APIRouter()


@router.get("/resume", summary="Consommation courante de tous les sites")
def consumption_summary() -> dict:
    if state.data is None:
        raise HTTPException(
            status_code=503,
            detail="Aucune mesure disponible : l'API source n'a pas encore répondu.",
        )
    return {
        "data": state.data,
        "fetched_at": state.fetched_at.isoformat(),
        "stale": state.is_stale(),
    }

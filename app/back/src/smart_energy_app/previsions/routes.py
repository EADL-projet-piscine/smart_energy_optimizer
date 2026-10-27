import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from smart_energy_app.previsions.repository import load_forecasts

logger = logging.getLogger(__name__)

router = APIRouter()


# Chemin vide : le préfixe du routeur porte déjà « /api/previsions ».
@router.get("", summary="Prévisions de consommation des prochaines heures")
def forecasts() -> dict:
    try:
        return load_forecasts()
    except SQLAlchemyError as error:
        # Pas de repli : un graphique vide est honnête, un graphique
        # reconstitué ne l'est pas.
        logger.warning("Prévisions indisponibles : %s", error)
        raise HTTPException(
            status_code=503,
            detail="La base de données est injoignable.",
        ) from error


@router.get("/{site_id}", summary="Prévisions de consommation d'un site")
def site_forecasts(site_id: str) -> dict:
    try:
        payload = load_forecasts()
    except SQLAlchemyError as error:
        logger.warning("Prévisions indisponibles : %s", error)
        raise HTTPException(
            status_code=503,
            detail="La base de données est injoignable.",
        ) from error

    # Un site sans prévision n'est pas un site inconnu : le modèle n'a
    # peut-être pas encore tourné pour lui. Rendre une liste vide dit cela,
    # là où un 404 affirmerait à tort que le site n'existe pas.
    return {
        "generated_at": payload["generated_at"],
        "horizon_hours": payload["horizon_hours"],
        "site_id": site_id,
        "points": payload["sites"].get(site_id, []),
    }

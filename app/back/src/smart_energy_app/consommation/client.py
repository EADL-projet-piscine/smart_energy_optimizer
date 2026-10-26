from datetime import datetime
from typing import Any

import httpx

from smart_energy_app.commun.enervision import (
    READINGS_PATH,
    SITE_CURRENT_PATH,
    SITES_PATH,
    SUMMARY_PATH,
)
from smart_energy_app.config import settings


async def fetch_summary() -> dict:
    """Appelle /api/v1/stats/summary et renvoie la réponse telle quelle."""
    return await _get(SUMMARY_PATH)


async def fetch_readings(start: datetime, end: datetime, limit: int) -> list[dict]:
    """Appelle /api/v1/readings sur une fenêtre donnée, tous sites confondus.

    `start` et `end` doivent être en UTC sans fuseau : l'API raisonne en UTC et
    refuse toute borne dans le futur.

    `limit` ne plafonne pas le résultat, il fixe le pas d'échantillonnage :
    l'API découpe la plage demandée et divise le quota entre les sites.
    """
    return await _get(
        READINGS_PATH,
        params={
            "start_time": start.isoformat(timespec="seconds"),
            "end_time": end.isoformat(timespec="seconds"),
            "limit": limit,
        },
    )


def _auth() -> tuple[str, str] | None:
    """Identifiants HTTP Basic, ou None si l'API n'en demande pas."""
    if not settings.enervision_user:
        return None
    return settings.enervision_user, settings.enervision_password.get_secret_value()


async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    url = f"{settings.enervision_api_url}{path}"
    async with httpx.AsyncClient(timeout=settings.enervision_timeout_s, auth=_auth()) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()


async def fetch_sites() -> list[dict]:
    """Appelle /api/v1/sites : le référentiel des sites du parc."""
    return await _get(SITES_PATH)


async def fetch_site_current(site_id: str) -> dict:
    """Appelle /api/v1/sites/{site_id}/current : la mesure détaillée d'un site.

    Contrairement au résumé, la réponse porte la cause d'une mesure absente
    (`data_quality`, `null_reasons`) et les grandeurs électriques du site.
    """
    return await _get(SITE_CURRENT_PATH.format(site_id=site_id))

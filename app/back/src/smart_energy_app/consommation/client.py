import httpx

from smart_energy_app.commun.enervision import SUMMARY_PATH
from smart_energy_app.config import settings


async def fetch_summary() -> dict:
    """Appelle /api/v1/stats/summary et renvoie la réponse telle quelle."""
    return await _get(SUMMARY_PATH)


def _auth() -> tuple[str, str] | None:
    """Identifiants HTTP Basic, ou None si l'API n'en demande pas."""
    if not settings.enervision_user:
        return None
    return settings.enervision_user, settings.enervision_password.get_secret_value()


async def _get(path: str) -> dict:
    url = f"{settings.enervision_api_url}{path}"
    async with httpx.AsyncClient(timeout=settings.enervision_timeout_s, auth=_auth()) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()

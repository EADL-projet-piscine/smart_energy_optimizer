import httpx

from smart_energy_app.config import settings


async def fetch_summary() -> dict:
    """Appelle /api/v1/stats/summary et renvoie la réponse telle quelle."""
    url = f"{settings.enervision_api_url}/api/v1/stats/summary"
    async with httpx.AsyncClient(timeout=settings.enervision_timeout_s) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()
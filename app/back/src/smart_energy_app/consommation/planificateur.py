import asyncio
import logging

from smart_energy_app.config import settings
from smart_energy_app.consommation.service import refresh

logger = logging.getLogger(__name__)


async def refresh_loop() -> None:
    """Rafraîchit la mesure courante à intervalle régulier jusqu'à l'arrêt."""
    logger.info(
        "Démarrage du rafraîchissement toutes les %.0f s",
        settings.consumption_refresh_s,
    )
    while True:
        await refresh()
        await asyncio.sleep(settings.consumption_refresh_s)

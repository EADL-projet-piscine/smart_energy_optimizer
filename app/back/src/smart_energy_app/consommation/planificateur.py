import asyncio
import logging

from smart_energy_app.alertes.capacite import capacity_alerts
from smart_energy_app.config import settings
from smart_energy_app.consommation.details import refresh_details
from smart_energy_app.consommation.service import refresh, state

logger = logging.getLogger(__name__)


async def refresh_loop() -> None:
    """Rafraîchit la mesure courante et le détail des sites jusqu'à l'arrêt."""
    logger.info(
        "Démarrage du rafraîchissement toutes les %.0f s",
        settings.consumption_refresh_s,
    )
    while True:
        # Les deux en parallèle : le détail ne dépend pas du résumé, et les
        # faire à la suite doublerait la latence du cycle.
        await asyncio.gather(refresh(), refresh_details())
        # Les alertes se calculent depuis le résumé déjà en mémoire : aucun
        # appel réseau de plus. Elles sont évaluées même si le rafraîchissement
        # a échoué, pour que rien ne s'éteigne faute de nouvelles.
        if state.data is not None and state.fetched_at is not None:
            capacity_alerts.evaluate(state.data, state.fetched_at)
        await asyncio.sleep(settings.consumption_refresh_s)

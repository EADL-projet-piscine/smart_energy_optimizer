import logging
import time
from datetime import datetime, timezone

import httpx

from smart_energy_app.config import settings
from smart_energy_app.consommation.client import fetch_summary

logger = logging.getLogger(__name__)


class CurrentState:
    """Dernière mesure courante connue, conservée en mémoire."""

    def __init__(self) -> None:
        self.data: dict | None = None
        self.fetched_at: datetime | None = None

    def age_seconds(self) -> float | None:
        if self.fetched_at is None:
            return None
        return (datetime.now(timezone.utc) - self.fetched_at).total_seconds()

    def is_stale(self) -> bool:
        age = self.age_seconds()
        return age is None or age > settings.consumption_staleness_s


state = CurrentState()


async def refresh() -> bool:
    """Interroge l'API source et met à jour l'état si l'appel réussit."""
    started = time.monotonic()
    try:
        data = await fetch_summary()
    except httpx.HTTPStatusError as error:
        logger.warning(
            "Mesure courante : l'API a répondu %s en %.0f ms",
            error.response.status_code,
            (time.monotonic() - started) * 1000,
        )
        return False
    except Exception as error:
        logger.warning(
            "Mesure courante indisponible en %.0f ms : %s",
            (time.monotonic() - started) * 1000,
            error,
        )
        return False

    state.data = data
    state.fetched_at = datetime.now(timezone.utc)
    logger.info(
        "Mesure courante rafraîchie en %.0f ms (%d sites)",
        (time.monotonic() - started) * 1000,
        len(data.get("sites", [])) if isinstance(data, dict) else 0,
    )
    return True
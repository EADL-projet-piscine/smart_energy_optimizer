"""Historique de consommation des dernières heures.

Interroge /api/v1/readings à chaque appel. Cet endpoint sert à l'affichage
uniquement : la source régénère ses valeurs à chaque requête, deux appels ne
donnent pas les mêmes mesures. À terme, il lira ce qui aura été stocké en base.
"""

import logging
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from smart_energy_app.config import settings
from smart_energy_app.consommation.client import fetch_readings

logger = logging.getLogger(__name__)


def _window() -> tuple[datetime, datetime]:
    """Fenêtre des dernières heures, en UTC sans fuseau.

    L'API source raisonne en UTC et refuse toute borne dans le futur : envoyer
    une heure locale depuis une machine à l'heure de Paris provoque un 400.
    La marge couvre l'écart d'horloge entre notre machine et le serveur.
    """
    end = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=settings.history_margin_s)
    return end - timedelta(hours=settings.history_hours), end


def _parse_timestamp(value: str | None) -> datetime | None:
    """Horodatage de la source, parfois avec microsecondes, parfois sans."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _group_by_site(points: list[dict]) -> dict[str, list[dict]]:
    """Convertit la liste plate de la source en un point par site, trié dans le temps.

    Les valeurs absentes restent à None : jamais remplacées par zéro, qui serait
    une mesure, alors que l'absence de mesure n'en est pas une.
    """
    by_site: dict[str, list[dict]] = defaultdict(list)
    for point in points:
        site_id = point.get("site_id")
        if not site_id:
            continue
        by_site[site_id].append(
            {
                "timestamp": point.get("timestamp"),
                "consumption_kw": point.get("consumption_kw"),
                "data_quality": point.get("data_quality"),
            }
        )

    for site_points in by_site.values():
        site_points.sort(
            key=lambda point: (
                _parse_timestamp(point["timestamp"]) or datetime.min.replace(tzinfo=UTC)
            )
        )

    return dict(by_site)


def _warn_on_gaps(by_site: dict[str, list[dict]], expected_per_site: int) -> None:
    """Journalise ce qui manque : sites absents, ou séries incomplètes."""
    if len(by_site) != settings.history_site_count:
        logger.warning(
            "Historique : %d sites reçus, %d attendus",
            len(by_site),
            settings.history_site_count,
        )
    for site_id, site_points in sorted(by_site.items()):
        if len(site_points) != expected_per_site:
            logger.warning(
                "Historique : %s a %d points, %d attendus",
                site_id,
                len(site_points),
                expected_per_site,
            )


async def load_history() -> dict:
    """Historique des dernières heures, groupé par site.

    Laisse remonter les erreurs httpx : l'historique n'a pas de valeur de repli,
    mieux vaut une erreur franche que des chiffres inventés.
    """
    start, end = _window()
    expected_per_site = settings.history_hours
    limit = expected_per_site * settings.history_site_count

    started = time.monotonic()
    points = await fetch_readings(start, end, limit)
    elapsed_ms = (time.monotonic() - started) * 1000

    by_site = _group_by_site(points)
    logger.info(
        "Historique %d h : %d points sur %d sites en %.0f ms",
        settings.history_hours,
        len(points),
        len(by_site),
        elapsed_ms,
    )
    _warn_on_gaps(by_site, expected_per_site)

    return {
        "start": start.replace(tzinfo=UTC).isoformat(),
        "end": end.replace(tzinfo=UTC).isoformat(),
        "sites": by_site,
    }

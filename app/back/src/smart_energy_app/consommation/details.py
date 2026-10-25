"""Détail temps réel de chaque site du parc.

Le résumé dit qu'un site n'a pas de mesure ; ce module dit pourquoi.
Il est rafraîchi par la même boucle, de sorte que le dashboard change
d'onglet sans déclencher le moindre appel réseau.
"""

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Any

from smart_energy_app.config import settings
from smart_energy_app.consommation.client import fetch_site_current, fetch_sites

logger = logging.getLogger(__name__)


class SiteDetails:
    """Dernier détail connu de chaque site, conservé en mémoire.

    Chaque site porte son propre horodatage : un site muet garde sa dernière
    mesure réelle pendant que les autres se rafraîchissent, et le client voit
    lequel date.
    """

    def __init__(self) -> None:
        self.by_site: dict[str, dict[str, Any]] = {}
        self.site_ids: list[str] = []

    def age_seconds(self, site_id: str) -> float | None:
        entry = self.by_site.get(site_id)
        if entry is None:
            return None
        return (datetime.now(UTC) - entry["fetched_at"]).total_seconds()

    def is_stale(self, site_id: str) -> bool:
        age = self.age_seconds(site_id)
        return age is None or age > settings.consumption_staleness_s

    def as_payload(self, site_id: str) -> dict[str, Any] | None:
        entry = self.by_site.get(site_id)
        if entry is None:
            return None
        return {
            "data": entry["data"],
            "fetched_at": entry["fetched_at"].isoformat(),
            "stale": self.is_stale(site_id),
        }


state = SiteDetails()


def _extract_site_ids(payload: Any) -> list[str]:
    """Tire les identifiants de la réponse de /api/v1/sites.

    L'extraction est défensive : la forme exacte de la réponse n'est pas
    garantie par contrat, et une liste vide vaut mieux qu'une exception dans
    une boucle qui ne doit jamais mourir.
    """
    if not isinstance(payload, list):
        return []
    ids = []
    for item in payload:
        if isinstance(item, dict):
            value = item.get("site_id") or item.get("id")
            if isinstance(value, str) and value:
                ids.append(value)
        elif isinstance(item, str) and item:
            ids.append(item)
    return ids


async def _load_site_ids() -> list[str]:
    """Charge la liste des sites une seule fois : le parc ne change pas."""
    if state.site_ids:
        return state.site_ids
    try:
        payload = await fetch_sites()
    except Exception as error:  # noqa: BLE001 - la boucle ne doit jamais mourir
        logger.warning("Référentiel des sites indisponible : %s", error)
        return []
    state.site_ids = _extract_site_ids(payload)
    if not state.site_ids:
        logger.warning("Référentiel des sites illisible : aucun identifiant trouvé")
    return state.site_ids


async def refresh_details() -> bool:
    """Rafraîchit le détail de tous les sites, en parallèle.

    Un site en échec ne fait pas échouer les autres : il garde sa dernière
    valeur connue, que `stale` signalera.
    """
    site_ids = await _load_site_ids()
    if not site_ids:
        return False

    started = time.monotonic()
    results = await asyncio.gather(
        *(fetch_site_current(site_id) for site_id in site_ids),
        return_exceptions=True,
    )
    elapsed_ms = (time.monotonic() - started) * 1000

    now = datetime.now(UTC)
    failed = []
    for site_id, result in zip(site_ids, results, strict=True):
        if isinstance(result, BaseException):
            failed.append(site_id)
            logger.warning("Détail de %s indisponible : %s", site_id, result)
            continue
        state.by_site[site_id] = {"data": result, "fetched_at": now}

    logger.info(
        "Détail des sites rafraîchi en %.0f ms (%d sur %d)",
        elapsed_ms,
        len(site_ids) - len(failed),
        len(site_ids),
    )
    return not failed

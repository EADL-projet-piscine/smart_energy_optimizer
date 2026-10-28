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
        # Type de chaque site, lu une fois avec la liste des identifiants.
        # Il ne vient pas du détail par site, qui le porte aussi : un site
        # dont la mesure échoue garde ainsi son type.
        self.site_types: dict[str, str] = {}

    def age_seconds(self, site_id: str) -> float | None:
        entry = self.by_site.get(site_id)
        if entry is None:
            return None
        return (datetime.now(UTC) - entry["fetched_at"]).total_seconds()

    def is_stale(self, site_id: str) -> bool:
        age = self.age_seconds(site_id)
        return age is None or age > settings.consumption_staleness_s

    def site_type(self, site_id: str) -> str | None:
        """Type du site, ou None tant que le référentiel n'a pas été lu."""
        return self.site_types.get(site_id)

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


def _extract_site_types(payload: Any) -> dict[str, str]:
    """Tire les types de site de la même réponse.

    Aussi défensive que l'extraction des identifiants : un type absent laisse
    le site hors du dictionnaire, et les recommandations retomberont sur leur
    repli plutôt que de disparaître.
    """
    if not isinstance(payload, list):
        return {}
    types: dict[str, str] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        site_id = item.get("site_id") or item.get("id")
        site_type = item.get("site_type")
        if isinstance(site_id, str) and site_id and isinstance(site_type, str) and site_type:
            types[site_id] = site_type
    return types


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
    state.site_types = _extract_site_types(payload)
    if not state.site_ids:
        logger.warning("Référentiel des sites illisible : aucun identifiant trouvé")
    elif len(state.site_types) < len(state.site_ids):
        # Pas bloquant : les recommandations de ces sites retomberont sur le
        # repli. Mais c'est une dérive du contrat de la source, et elle doit
        # se voir dans les journaux.
        logger.warning(
            "Type de site absent pour %d site(s) sur %d",
            len(state.site_ids) - len(state.site_types),
            len(state.site_ids),
        )
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

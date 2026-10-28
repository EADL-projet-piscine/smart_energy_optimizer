"""Lecture du référentiel de recommandations.

Le référentiel est posé par migration et personne ne l'écrit à l'exécution :
il est chargé une fois en mémoire plutôt qu'interrogé à chaque alerte. Une
édition en ligne (V2) devra rappeler `load()` après écriture.

Vingt-neuf règles et quatorze conseils : l'ensemble tient largement en
mémoire, et la route de consommation n'a plus à toucher la base.
"""

import logging
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from smart_energy_app.db import engine

logger = logging.getLogger(__name__)

# Repli du référentiel : un site dont le type n'est pas connu reçoit les
# conseils génériques plutôt qu'aucun conseil.
UNKNOWN_SITE_TYPE = "unknown"

# Délai minimum entre deux tentatives de chargement. La base peut démarrer
# après l'API ; sans nouvelle tentative, le référentiel resterait vide pour
# toute la durée de vie du processus. Sans délai, chaque alerte paierait un
# aller-retour vers une base injoignable.
RETRY_AFTER_S = 60.0

# `active` filtre ici et non à l'affichage : un conseil désactivé ne doit pas
# traverser l'API. L'ordre est celui des rangs, et c'est l'API qui en décide —
# le dashboard affiche la liste telle qu'il la reçoit.
RULES_SQL = text(
    """
    SELECT regle.situation, regle.site_type, conseil.action, conseil.detail
    FROM recommendation_rules AS regle
    JOIN recommendations AS conseil ON conseil.id = regle.recommendation_id
    WHERE conseil.active
    ORDER BY regle.situation, regle.site_type, regle.priority
    """
)


class Recommendations:
    """Le référentiel, chargé en mémoire."""

    def __init__(self) -> None:
        self.by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.last_attempt: float | None = None

    def load(self) -> bool:
        """Relit le référentiel. Rend False si la base n'a pas répondu."""
        self.last_attempt = time.monotonic()
        try:
            with engine.connect() as connexion:
                rows = connexion.execute(RULES_SQL).mappings().all()
        except SQLAlchemyError as erreur:
            logger.warning("Référentiel de recommandations illisible : %s", erreur)
            return False

        by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in rows:
            conseil: dict[str, Any] = {"action": row["action"]}
            # `detail` est facultatif : l'omettre plutôt que d'envoyer un null
            # que le dashboard devrait filtrer.
            if row["detail"] is not None:
                conseil["detail"] = row["detail"]
            by_key.setdefault((row["situation"], row["site_type"]), []).append(conseil)

        self.by_key = by_key
        logger.info(
            "Référentiel de recommandations chargé : %d conseils sur %d couples.",
            sum(len(conseils) for conseils in by_key.values()),
            len(by_key),
        )
        return True

    def ensure_loaded(self) -> None:
        """Charge le référentiel s'il est vide, sans marteler une base absente."""
        if self.by_key:
            return
        if self.last_attempt is not None and time.monotonic() - self.last_attempt < RETRY_AFTER_S:
            return
        self.load()

    def for_situation(self, situation: str, site_type: str | None) -> list[dict[str, Any]]:
        """Les conseils d'une situation pour un type de site, dans l'ordre.

        Un type absent du référentiel retombe sur `unknown` : une alerte sans
        le moindre conseil laisserait l'écran annoncer un problème sans rien
        proposer, ce qui se lit comme une panne.
        """
        self.ensure_loaded()
        conseils = self.by_key.get((situation, site_type or UNKNOWN_SITE_TYPE))
        if conseils is None:
            conseils = self.by_key.get((situation, UNKNOWN_SITE_TYPE), [])
        return conseils


recommendations = Recommendations()

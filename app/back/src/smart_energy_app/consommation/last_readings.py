"""Dernières consommations réellement mesurées, site par site.

Le résumé de l'API source renvoie `null` dès qu'un site cesse de transmettre,
et le cycle suivant écrase la valeur précédente. Sans ce module, l'écran n'a
plus aucun chiffre à montrer alors que l'historique prouve que le site
consommait deux heures plus tôt.

Ce n'est pas un cache : un cache expire et se reconstruit depuis sa source,
alors qu'ici la valeur est conservée précisément parce que la source ne sait
plus la donner. Elle ne remplace jamais la mesure courante, elle la complète.
"""

from datetime import datetime
from typing import Any

from smart_energy_app.consommation.payload import number_of, site_id_of, sites_of


class LastReadings:
    """Dernier relevé connu de chaque site, conservé en mémoire.

    Chaque site porte son propre horodatage : un site muet garde sa dernière
    valeur pendant que les autres se rafraîchissent.
    """

    def __init__(self) -> None:
        self.by_site: dict[str, dict[str, Any]] = {}

    def remember(self, payload: Any, at: datetime) -> None:
        """Retient les consommations présentes, sans effacer les absentes.

        C'est toute la règle : une valeur absente n'est pas une valeur nulle,
        et n'a donc aucune raison d'écraser ce qu'on savait déjà.
        """
        for site in sites_of(payload):
            site_id = site_id_of(site)
            consumption_kw = number_of(site, "current_consumption_kw")
            if site_id is None or consumption_kw is None:
                continue
            self.by_site[site_id] = {"consumption_kw": consumption_kw, "at": at}

    def as_payload(self) -> dict[str, dict[str, Any]]:
        return {
            site_id: {
                "consumption_kw": entry["consumption_kw"],
                "at": entry["at"].isoformat(),
            }
            for site_id, entry in self.by_site.items()
        }


last_readings = LastReadings()

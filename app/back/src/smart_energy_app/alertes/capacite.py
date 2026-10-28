"""Alertes levées quand un site approche de sa capacité.

Les alertes de `/alerts` sont décorrélées des mesures : l'écran annonçait « 0
alerte » avec cinq sites sur sept en panne. Celles-ci sont calculées à chaque
cycle depuis la charge réellement constatée.

Deux seuils distincts pour lever et pour éteindre : avec un seuil unique, un
site qui oscille autour de 90 % verrait son alerte clignoter à chaque cycle.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from smart_energy_app.config import settings
from smart_energy_app.consommation.payload import number_of, site_id_of, sites_of

CRITIQUE = "critique"
MOYENNE = "moyenne"

MESSAGES = {
    CRITIQUE: "La capacité de l'installation est dépassée",
    MOYENNE: "Le site approche de sa capacité",
}

# Situation correspondante dans le référentiel de recommandations.
#
# Un dictionnaire explicite plutôt qu'un `f"capacite_{severity}"` : une
# gravité renommée casserait la clé construite sans la moindre erreur, et les
# conseils disparaîtraient en silence. Ici, le couple est écrit noir sur
# blanc, et le test qui vérifie que chaque situation a des conseils l'attrape.
SITUATIONS = {
    CRITIQUE: "capacite_critique",
    MOYENNE: "capacite_moyenne",
}


@dataclass
class CapacityAlert:
    """Une alerte en cours sur un site.

    `raised_at` date la levée, pas le dernier cycle : une alerte qui dure
    garde l'heure à laquelle elle est apparue. `load_percent`, lui, suit la
    charge courante — c'est ce qui dit si la situation empire.
    """

    site_id: str
    severity: str
    raised_at: datetime
    load_percent: float
    capacity_kw: float | None

    def as_payload(self) -> dict[str, Any]:
        return {
            "site_id": self.site_id,
            "severity": self.severity,
            "message": MESSAGES[self.severity],
            "raised_at": self.raised_at.isoformat(),
            "load_percent": self.load_percent,
            "capacity_kw": self.capacity_kw,
        }


def severity_for(load_percent: float, current: str | None) -> str | None:
    """Sévérité que mérite cette charge, ou `None` s'il n'y a pas lieu d'alerter.

    Entre le seuil d'extinction et celui de levée, rien ne change : une alerte
    déjà levée le reste, et une situation calme le reste aussi.
    """
    if load_percent >= settings.alert_critical_pct:
        return CRITIQUE
    if load_percent >= settings.alert_medium_pct:
        return MOYENNE
    if load_percent < settings.alert_clear_pct:
        return None
    return current


class CapacityAlerts:
    """Alertes de capacité en cours, une au plus par site."""

    def __init__(self) -> None:
        self.by_site: dict[str, CapacityAlert] = {}

    def evaluate(self, payload: Any, at: datetime) -> None:
        for site in sites_of(payload):
            site_id = site_id_of(site)
            if site_id is None:
                continue
            load_percent = number_of(site, "load_percent")
            # Charge inconnue : on ne lève rien et on n'éteint rien. L'absence
            # de mesure n'est pas une preuve que la situation s'est calmée.
            if load_percent is None:
                continue
            self._apply(site_id, load_percent, number_of(site, "capacity_kw"), at)

    def _apply(
        self, site_id: str, load_percent: float, capacity_kw: float | None, at: datetime
    ) -> None:
        current = self.by_site.get(site_id)
        severity = severity_for(load_percent, current.severity if current else None)

        if severity is None:
            self.by_site.pop(site_id, None)
            return

        if current is not None and current.severity == severity:
            # Même alerte qu'au cycle précédent : elle garde son horodatage de
            # levée, mais suit la charge courante.
            current.load_percent = load_percent
            current.capacity_kw = capacity_kw
            return

        # Première levée, ou changement de gravité : c'est un nouvel événement.
        self.by_site[site_id] = CapacityAlert(site_id, severity, at, load_percent, capacity_kw)

    def as_payload(self) -> list[dict[str, Any]]:
        return [alert.as_payload() for alert in self.by_site.values()]


capacity_alerts = CapacityAlerts()

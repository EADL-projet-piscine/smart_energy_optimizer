"""Lecture défensive du résumé renvoyé par l'API source.

La forme de la réponse n'est garantie par aucun contrat. Tout ce qui la lit
tourne dans la boucle de rafraîchissement, qui ne doit jamais mourir : ces
fonctions ignorent donc ce qu'elles ne comprennent pas plutôt que de lever.
"""

from typing import Any


def sites_of(payload: Any) -> list[dict[str, Any]]:
    """Liste des sites du résumé, vide si la réponse n'a pas la forme attendue."""
    if not isinstance(payload, dict):
        return []
    sites = payload.get("sites")
    if not isinstance(sites, list):
        return []
    return [site for site in sites if isinstance(site, dict)]


def site_id_of(site: dict[str, Any]) -> str | None:
    """Identifiant d'un site, s'il est une chaîne non vide."""
    site_id = site.get("site_id")
    if not isinstance(site_id, str) or not site_id:
        return None
    return site_id


def number_of(site: dict[str, Any], key: str) -> float | None:
    """Valeur numérique d'un champ, `None` si elle est absente ou inexploitable."""
    value = site.get(key)
    # bool est une sous-classe de int : sans ce garde-fou, `true` vaudrait 1.
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)

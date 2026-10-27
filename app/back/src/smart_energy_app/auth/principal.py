"""L'appelant d'une requête et le périmètre des sites qu'il peut voir."""

from dataclasses import dataclass
from typing import Any

# Rôles qui voient tout le parc. Les autres (viewer) ne voient que les sites dont
# ils sont le client (sites.client_user_id).
ALL_SITES_ROLES = frozenset({"admin", "operator"})


@dataclass(frozen=True)
class Principal:
    user_id: str | None
    email: str | None
    display_name: str | None
    roles: frozenset[str]
    # None : tous les sites. Un ensemble, même vide : ces sites seulement.
    site_ids: frozenset[str] | None

    @classmethod
    def anonymous(cls) -> "Principal":
        """L'appelant quand l'authentification est désactivée : il voit tout, comme avant."""
        return cls(user_id=None, email=None, display_name=None, roles=frozenset(), site_ids=None)

    def can_see(self, site_id: str) -> bool:
        return self.site_ids is None or site_id in self.site_ids

    def visible(self, by_site: dict[str, Any]) -> dict[str, Any]:
        """Les entrées d'un dictionnaire indexé par site que l'appelant peut voir."""
        if self.site_ids is None:
            return by_site
        return {site_id: value for site_id, value in by_site.items() if site_id in self.site_ids}

    def visible_items(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Les éléments d'une liste portant un `site_id` que l'appelant peut voir."""
        if self.site_ids is None:
            return items
        return [item for item in items if item.get("site_id") in self.site_ids]

    def as_payload(self) -> dict[str, Any]:
        return {
            "id": self.user_id,
            "email": self.email,
            "display_name": self.display_name,
            "roles": sorted(self.roles),
            # None se lit « tous les sites » côté client.
            "site_ids": None if self.site_ids is None else sorted(self.site_ids),
        }

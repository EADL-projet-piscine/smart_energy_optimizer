"""Authentification de l'API : comptes, jetons et périmètre des sites de l'appelant.

Connexion par e-mail et mot de passe (condensé argon2 en base), jeton JWT signé de
courte durée dans un cookie `HttpOnly`, contrôle sur chaque route que le site
demandé est dans le périmètre de l'utilisateur.

Les autres modules n'utilisent que ce qui est exposé ici.
"""

from .dependencies import CurrentPrincipal, forbidden_site
from .principal import Principal

__all__ = ["CurrentPrincipal", "Principal", "forbidden_site"]

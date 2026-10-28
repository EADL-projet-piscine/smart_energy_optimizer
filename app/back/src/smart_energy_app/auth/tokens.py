"""Jetons d'accès : JWT signé (HS256), de courte durée.

Le jeton porte les rôles et les sites de l'utilisateur, figés à la connexion : chaque
requête est contrôlée sans interroger la base. Un changement de droits prend donc
effet au plus tard à l'expiration du jeton (15 minutes par défaut).
"""

from datetime import UTC, datetime, timedelta

import jwt

from smart_energy_app.auth.principal import Principal

ALGORITHM = "HS256"
# Taille minimale de la clé : en dessous, une clé HS256 se devine par force brute.
MIN_SECRET_LENGTH = 32

InvalidTokenError = jwt.InvalidTokenError


def issue_token(principal: Principal, secret: str, ttl: timedelta) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": principal.user_id,
        "email": principal.email,
        "name": principal.display_name,
        "roles": sorted(principal.roles),
        "sites": None if principal.site_ids is None else sorted(principal.site_ids),
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(claims, secret, algorithm=ALGORITHM)


def read_token(token: str, secret: str) -> Principal:
    """Le titulaire d'un jeton valide ; `InvalidTokenError` sinon (signature, expiration…).

    L'algorithme est imposé : un jeton qui annonce `none` ou un autre algorithme est refusé.
    """
    claims = jwt.decode(
        token,
        secret,
        algorithms=[ALGORITHM],
        options={"require": ["sub", "exp", "iat"]},
    )
    roles = claims.get("roles")
    sites = claims.get("sites")
    if not isinstance(roles, list) or not (sites is None or isinstance(sites, list)):
        raise InvalidTokenError("Jeton mal formé")
    return Principal(
        user_id=claims["sub"],
        email=claims.get("email"),
        display_name=claims.get("name"),
        roles=frozenset(roles),
        site_ids=None if sites is None else frozenset(sites),
    )

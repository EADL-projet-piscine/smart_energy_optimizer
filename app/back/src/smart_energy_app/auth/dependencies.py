"""Identification de l'appelant, à déclarer sur chaque route de l'API."""

from typing import Annotated

from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyCookie

from smart_energy_app.auth.principal import Principal
from smart_energy_app.auth.tokens import MIN_SECRET_LENGTH, InvalidTokenError, read_token
from smart_energy_app.config import settings

COOKIE_NAME = "enervision_session"

# Déclaré comme schéma de sécurité : il apparaît dans la spécification OpenAPI.
# auto_error=False : l'absence de cookie est traitée ci-dessous, en 401 et non en 403.
session_cookie = APIKeyCookie(
    name=COOKIE_NAME,
    auto_error=False,
    description="Jeton de session posé par POST /api/auth/login.",
)

UNAUTHENTICATED = HTTPException(status_code=401, detail="Authentification requise.")


def check_configuration() -> None:
    """Refuse de démarrer une API protégée sans clé de signature valable."""
    if settings.auth_enabled and len(settings.jwt_secret.get_secret_value()) < MIN_SECRET_LENGTH:
        raise RuntimeError(
            f"AUTH_ENABLED=true exige JWT_SECRET d'au moins {MIN_SECRET_LENGTH} caractères."
        )


def current_principal(token: Annotated[str | None, Security(session_cookie)]) -> Principal:
    if not settings.auth_enabled:
        return Principal.anonymous()
    if not token:
        raise UNAUTHENTICATED
    try:
        return read_token(token, settings.jwt_secret.get_secret_value())
    except InvalidTokenError as error:
        raise UNAUTHENTICATED from error


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


def forbidden_site(site_id: str) -> HTTPException:
    # Même réponse qu'un site existant ou non : un client ne doit pas pouvoir
    # découvrir les sites des autres en essayant des identifiants.
    return HTTPException(status_code=403, detail=f"Accès refusé au site {site_id}.")

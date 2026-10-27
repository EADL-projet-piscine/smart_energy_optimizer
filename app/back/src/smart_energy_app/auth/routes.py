import logging
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from smart_energy_app.auth.dependencies import COOKIE_NAME, CurrentPrincipal
from smart_energy_app.auth.passwords import (
    hash_password,
    needs_rehash,
    spend_verification_time,
    verify_password,
)
from smart_energy_app.auth.repository import (
    find_active_account,
    principal_of,
    update_password_hash,
)
from smart_energy_app.auth.tokens import MIN_SECRET_LENGTH, issue_token
from smart_energy_app.config import settings
from smart_energy_app.db import engine

logger = logging.getLogger(__name__)

router = APIRouter()

# Le cookie ne part que vers l'API : le reste du site n'en a pas l'usage.
COOKIE_PATH = "/api"


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


@router.post(
    "/login",
    status_code=204,
    summary="Connexion : pose le cookie de session",
    responses={401: {"description": "Identifiants incorrects"}},
)
def login(credentials: Credentials) -> Response:
    secret = settings.jwt_secret.get_secret_value()
    if len(secret) < MIN_SECRET_LENGTH:
        raise HTTPException(status_code=503, detail="L'authentification n'est pas configurée.")
    try:
        with engine.connect() as conn:
            account = find_active_account(conn, credentials.email)
            if account is None:
                spend_verification_time()
            elif verify_password(account.password_hash, credentials.password):
                if needs_rehash(account.password_hash):
                    update_password_hash(conn, account.user_id, hash_password(credentials.password))
                    conn.commit()
                principal = principal_of(conn, account)
            else:
                account = None
    except SQLAlchemyError as error:
        logger.warning("Connexion impossible, base injoignable : %s", error)
        raise HTTPException(
            status_code=503, detail="La base de données est injoignable."
        ) from error

    if account is None:
        # Même message pour un e-mail inconnu et un mauvais mot de passe. L'e-mail n'est
        # pas journalisé : c'est une donnée personnelle, et le compte des échecs suffit
        # à repérer une attaque.
        logger.warning("Échec de connexion")
        raise HTTPException(status_code=401, detail="Identifiant ou mot de passe incorrect.")

    ttl = timedelta(minutes=settings.jwt_ttl_minutes)
    response = Response(status_code=204)
    response.set_cookie(
        COOKIE_NAME,
        issue_token(principal, secret, ttl),
        max_age=int(ttl.total_seconds()),
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
    )
    logger.info("Connexion de l'utilisateur %s", principal.user_id)
    return response


@router.post("/logout", status_code=204, summary="Déconnexion : efface le cookie de session")
def logout() -> Response:
    response = Response(status_code=204)
    response.delete_cookie(
        COOKIE_NAME,
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
    )
    return response


@router.get("/me", summary="L'utilisateur connecté et les sites qu'il peut voir")
def me(principal: CurrentPrincipal) -> dict:
    # auth_enabled dit au dashboard s'il doit afficher la page de connexion.
    return {"auth_enabled": settings.auth_enabled, "user": principal.as_payload()}

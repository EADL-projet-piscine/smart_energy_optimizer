"""Gestion des comptes par un administrateur : liste, création, modification.

Chaque action est journalisée avec son auteur. Un changement de droits prend effet à
la prochaine connexion du compte concerné, au plus tard à l'expiration de son jeton.
"""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from smart_energy_app.auth.dependencies import CurrentPrincipal
from smart_energy_app.auth.passwords import hash_password
from smart_energy_app.auth.principal import Principal
from smart_energy_app.auth.repository import (
    create_account,
    get_account,
    list_accounts,
    list_sites_with_clients,
    set_client_sites,
    set_role,
    update_account_fields,
)
from smart_energy_app.auth.schemas import AccountChanges, NewAccount
from smart_energy_app.config import settings
from smart_energy_app.db import engine

logger = logging.getLogger(__name__)

router = APIRouter()

DATABASE_DOWN = HTTPException(status_code=503, detail="La base de données est injoignable.")


def require_admin(principal: CurrentPrincipal) -> Principal:
    if not settings.auth_enabled:
        # Sans authentification, n'importe qui serait « administrateur ».
        raise HTTPException(
            status_code=403,
            detail="La gestion des comptes exige l'authentification (AUTH_ENABLED=true).",
        )
    if "admin" not in principal.roles:
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs.")
    return principal


Admin = Annotated[Principal, Depends(require_admin)]

FORBIDDEN = {403: {"description": "Réservé aux administrateurs"}}


@router.get("", summary="Comptes, et sites avec leur client", responses=FORBIDDEN)
def accounts(admin: Admin) -> dict:
    try:
        with engine.connect() as conn:
            return {"comptes": list_accounts(conn), "sites": list_sites_with_clients(conn)}
    except SQLAlchemyError as error:
        logger.warning("Comptes indisponibles : %s", error)
        raise DATABASE_DOWN from error


@router.post(
    "",
    status_code=201,
    summary="Crée un compte",
    responses={**FORBIDDEN, 409: {"description": "E-mail déjà utilisé"}},
)
def create(account: NewAccount, admin: Admin) -> dict:
    try:
        with engine.begin() as conn:
            user_id = create_account(
                conn,
                account.email.strip(),
                account.display_name.strip(),
                hash_password(account.password),
                account.role,
                account.site_ids,
            )
            created = get_account(conn, user_id)
    except IntegrityError as error:
        raise HTTPException(
            status_code=409, detail="Un compte existe déjà avec cet e-mail."
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except SQLAlchemyError as error:
        logger.warning("Création de compte impossible : %s", error)
        raise DATABASE_DOWN from error
    logger.info("Compte %s (%s) créé par %s", user_id, account.role, admin.user_id)
    return created


@router.patch(
    "/{user_id}",
    summary="Modifie un compte : nom, activation, rôle, sites, mot de passe",
    responses={**FORBIDDEN, 404: {"description": "Compte inconnu"}},
)
def update(user_id: UUID, changes: AccountChanges, admin: Admin) -> dict:
    target = str(user_id)
    if target == admin.user_id and (
        changes.is_active is False or (changes.role is not None and changes.role != "admin")
    ):
        # Sinon un administrateur peut se fermer la porte, et la rouvrir demande la base.
        raise HTTPException(
            status_code=409,
            detail="Vous ne pouvez pas retirer vos propres droits d'administration.",
        )
    try:
        with engine.begin() as conn:
            found = update_account_fields(
                conn,
                target,
                display_name=None if changes.display_name is None else changes.display_name.strip(),
                is_active=changes.is_active,
                password_hash=None if changes.password is None else hash_password(changes.password),
            )
            if not found:
                raise HTTPException(status_code=404, detail="Compte inconnu.")
            if changes.role is not None:
                set_role(conn, target, changes.role)
            if changes.site_ids is not None:
                set_client_sites(conn, target, changes.site_ids)
            updated = get_account(conn, target)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except SQLAlchemyError as error:
        logger.warning("Modification de compte impossible : %s", error)
        raise DATABASE_DOWN from error
    # Les champs, jamais leurs valeurs : un mot de passe n'a rien à faire dans un journal.
    fields = sorted(changes.model_dump(exclude_none=True))
    logger.info("Compte %s modifié par %s : %s", target, admin.user_id, ", ".join(fields))
    return updated

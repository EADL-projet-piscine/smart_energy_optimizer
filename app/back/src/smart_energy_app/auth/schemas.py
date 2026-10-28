"""Formats d'entrée de la gestion des comptes."""

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["admin", "operator", "viewer"]

# Même règle que la commande create_user : un mot de passe court se devine.
MIN_PASSWORD_LENGTH = 12


class NewAccount(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+$")
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)
    role: Role
    # Sites dont le compte est le client ; utile pour le rôle viewer.
    site_ids: list[str] = Field(default_factory=list, max_length=500)


class AccountChanges(BaseModel):
    """Seuls les champs fournis changent."""

    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    role: Role | None = None
    site_ids: list[str] | None = Field(default=None, max_length=500)
    # Nouveau mot de passe, quand l'utilisateur a perdu le sien.
    password: str | None = Field(default=None, min_length=MIN_PASSWORD_LENGTH, max_length=1024)

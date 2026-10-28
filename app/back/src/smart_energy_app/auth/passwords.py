"""Condensés des mots de passe (argon2id, paramètres par défaut de la RFC 9106)."""

from functools import cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """Vrai quand le condensé date de paramètres plus faibles que ceux d'aujourd'hui."""
    return hasher.check_needs_rehash(password_hash)


@cache
def _dummy_hash() -> str:
    return hasher.hash("compte-inexistant")


def spend_verification_time() -> None:
    """Fait le même calcul qu'une vérification, pour un compte qui n'existe pas.

    Sans cela, la réponse arriverait plus vite pour un e-mail inconnu : le temps de
    réponse suffirait à savoir quels comptes existent.
    """
    verify_password(_dummy_hash(), "mot-de-passe-quelconque")

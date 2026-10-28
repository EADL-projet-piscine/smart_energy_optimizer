"""Création d'un compte, en ligne de commande (il n'y a pas d'inscription en ligne).

    python -m smart_energy_app.auth.create_user --email ada@example.com \\
        --name "Ada Lovelace" --role viewer --site SITE001 --site SITE003

Le mot de passe est demandé au clavier, ou lu dans NEW_USER_PASSWORD pour un script :
jamais en argument, où il resterait dans l'historique du shell.
"""

import argparse
import getpass
import os
import sys

from sqlalchemy.exc import IntegrityError

from smart_energy_app.auth.passwords import hash_password
from smart_energy_app.auth.repository import create_account
from smart_energy_app.db import engine

MIN_PASSWORD_LENGTH = 12


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crée un compte de l'API.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True, help="nom affiché")
    parser.add_argument("--role", required=True, choices=["admin", "operator", "viewer"])
    parser.add_argument(
        "--site",
        action="append",
        default=[],
        help="site dont ce compte est le client (répétable) ; utile pour le rôle viewer",
    )
    args = parser.parse_args(argv)

    password = os.environ.get("NEW_USER_PASSWORD") or getpass.getpass("Mot de passe : ")
    if len(password) < MIN_PASSWORD_LENGTH:
        print(
            f"Mot de passe trop court : {MIN_PASSWORD_LENGTH} caractères au moins.", file=sys.stderr
        )
        return 1

    try:
        with engine.begin() as conn:
            user_id = create_account(
                conn, args.email, args.name, hash_password(password), args.role, args.site
            )
    except IntegrityError:
        print(f"Un compte existe déjà pour {args.email}.", file=sys.stderr)
        return 1
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1

    print(f"Compte créé : {user_id} ({args.role})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

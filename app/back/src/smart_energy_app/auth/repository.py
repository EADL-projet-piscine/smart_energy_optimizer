"""Comptes en base : lecture à la connexion, création par la commande d'administration."""

from dataclasses import dataclass

from sqlalchemy import Connection, text

from smart_energy_app.auth.principal import ALL_SITES_ROLES, Principal


@dataclass(frozen=True)
class Account:
    user_id: str
    email: str
    display_name: str
    password_hash: str


def find_active_account(conn: Connection, email: str) -> Account | None:
    # lower() des deux côtés : l'index unique users_email_lower_idx porte sur lower(email).
    row = (
        conn.execute(
            text(
                "SELECT id, email, display_name, password_hash FROM users"
                " WHERE lower(email) = lower(:email) AND is_active"
            ),
            {"email": email},
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    return Account(str(row["id"]), row["email"], row["display_name"], row["password_hash"])


def update_password_hash(conn: Connection, user_id: str, password_hash: str) -> None:
    conn.execute(
        text("UPDATE users SET password_hash = :hash WHERE id = :id"),
        {"hash": password_hash, "id": user_id},
    )


def principal_of(conn: Connection, account: Account) -> Principal:
    """L'utilisateur, ses rôles et, s'il ne voit pas tout le parc, les sites de son client."""
    roles = frozenset(
        conn.execute(
            text(
                "SELECT r.code FROM role_user ru JOIN roles r ON r.id = ru.role_id"
                " WHERE ru.user_id = :id"
            ),
            {"id": account.user_id},
        ).scalars()
    )
    site_ids = None
    if not roles & ALL_SITES_ROLES:
        site_ids = frozenset(
            conn.execute(
                text("SELECT site_id FROM sites WHERE client_user_id = :id"),
                {"id": account.user_id},
            ).scalars()
        )
    return Principal(
        user_id=account.user_id,
        email=account.email,
        display_name=account.display_name,
        roles=roles,
        site_ids=site_ids,
    )


def create_account(
    conn: Connection,
    email: str,
    display_name: str,
    password_hash: str,
    role: str,
    site_ids: list[str],
) -> str:
    """Crée le compte, lui donne son rôle et le rattache comme client aux sites donnés.

    Lève ValueError si le rôle ou l'un des sites n'existe pas ; l'appelant annule alors
    la transaction, et rien n'est créé.
    """
    user_id = conn.execute(
        text(
            "INSERT INTO users (email, password_hash, display_name)"
            " VALUES (:email, :hash, :name) RETURNING id"
        ),
        {"email": email, "hash": password_hash, "name": display_name},
    ).scalar_one()
    granted = conn.execute(
        text(
            "INSERT INTO role_user (user_id, role_id) SELECT :id, id FROM roles WHERE code = :role"
        ),
        {"id": user_id, "role": role},
    ).rowcount
    if granted != 1:
        raise ValueError(f"Rôle inconnu : {role}")
    if site_ids:
        assigned = conn.execute(
            text("UPDATE sites SET client_user_id = :id WHERE site_id = ANY(:sites)"),
            {"id": user_id, "sites": site_ids},
        ).rowcount
        if assigned != len(set(site_ids)):
            raise ValueError(f"Site inconnu parmi : {', '.join(site_ids)}")
    return str(user_id)

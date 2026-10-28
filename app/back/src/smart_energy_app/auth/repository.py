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
    user_id = str(
        conn.execute(
            text(
                "INSERT INTO users (email, password_hash, display_name)"
                " VALUES (:email, :hash, :name) RETURNING id"
            ),
            {"email": email, "hash": password_hash, "name": display_name},
        ).scalar_one()
    )
    set_role(conn, user_id, role)
    set_client_sites(conn, user_id, site_ids)
    return user_id


def set_role(conn: Connection, user_id: str, role: str) -> None:
    """Remplace les rôles du compte par celui-ci : un compte a un seul rôle à la fois."""
    conn.execute(text("DELETE FROM role_user WHERE user_id = :id"), {"id": user_id})
    granted = conn.execute(
        text(
            "INSERT INTO role_user (user_id, role_id) SELECT :id, id FROM roles WHERE code = :role"
        ),
        {"id": user_id, "role": role},
    ).rowcount
    if granted != 1:
        raise ValueError(f"Rôle inconnu : {role}")


def set_client_sites(conn: Connection, user_id: str, site_ids: list[str]) -> None:
    """Fait du compte le client de ces sites, et seulement de ceux-là.

    Un site n'a qu'un client : le rattacher ici le retire à son client précédent.
    """
    conn.execute(
        text(
            "UPDATE sites SET client_user_id = NULL"
            " WHERE client_user_id = :id AND NOT (site_id = ANY(:sites))"
        ),
        {"id": user_id, "sites": site_ids},
    )
    if not site_ids:
        return
    assigned = conn.execute(
        text("UPDATE sites SET client_user_id = :id WHERE site_id = ANY(:sites)"),
        {"id": user_id, "sites": site_ids},
    ).rowcount
    if assigned != len(set(site_ids)):
        raise ValueError(f"Site inconnu parmi : {', '.join(site_ids)}")


# Une ligne par compte : rôles et sites agrégés, triés pour un résultat stable.
ACCOUNTS_SQL = """
    SELECT
      u.id, u.email, u.display_name, u.is_active, u.created_at,
      COALESCE(
        (SELECT array_agg(r.code ORDER BY r.code) FROM role_user ru
         JOIN roles r ON r.id = ru.role_id WHERE ru.user_id = u.id),
        ARRAY[]::text[]
      ) AS roles,
      COALESCE(
        (SELECT array_agg(s.site_id ORDER BY s.site_id) FROM sites s
         WHERE s.client_user_id = u.id),
        ARRAY[]::text[]
      ) AS site_ids
    FROM users u
"""


def _account_payload(row) -> dict:
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "display_name": row["display_name"],
        "is_active": row["is_active"],
        "created_at": row["created_at"].isoformat(),
        "roles": list(row["roles"]),
        "site_ids": list(row["site_ids"]),
    }


def list_accounts(conn: Connection) -> list[dict]:
    rows = conn.execute(text(ACCOUNTS_SQL + " ORDER BY lower(u.email)")).mappings()
    return [_account_payload(row) for row in rows]


def get_account(conn: Connection, user_id: str) -> dict | None:
    row = conn.execute(text(ACCOUNTS_SQL + " WHERE u.id = :id"), {"id": user_id}).mappings()
    first = row.first()
    return None if first is None else _account_payload(first)


def list_sites_with_clients(conn: Connection) -> list[dict]:
    """Le référentiel des sites et leur client, pour choisir les sites d'un compte."""
    rows = conn.execute(
        text("SELECT site_id, site_name, client_user_id FROM sites ORDER BY site_id")
    ).mappings()
    return [
        {
            "site_id": row["site_id"],
            "site_name": row["site_name"],
            "client_user_id": None if row["client_user_id"] is None else str(row["client_user_id"]),
        }
        for row in rows
    ]


def update_account_fields(
    conn: Connection,
    user_id: str,
    display_name: str | None = None,
    is_active: bool | None = None,
    password_hash: str | None = None,
) -> bool:
    """Met à jour les champs fournis ; faux si le compte n'existe pas."""
    found = conn.execute(
        text(
            "UPDATE users SET"
            " display_name = COALESCE(:name, display_name),"
            " is_active = COALESCE(:active, is_active),"
            " password_hash = COALESCE(:hash, password_hash)"
            " WHERE id = :id"
        ),
        {"id": user_id, "name": display_name, "active": is_active, "hash": password_hash},
    ).rowcount
    return found == 1

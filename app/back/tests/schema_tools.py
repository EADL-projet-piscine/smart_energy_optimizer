"""Applying the migrations from the tests.

In CI the database starts empty: nothing plays db/init there. Whichever test
file runs first must therefore be able to build the schema, hence this module
rather than a copy inside each one.
"""

from pathlib import Path

from sqlalchemy import text

from smart_energy_app.db import engine

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "db" / "migrations"

# Migrations wrap themselves in BEGIN/COMMIT so that psql applies them
# atomically. Replayed through SQLAlchemy, which already opened a transaction,
# that COMMIT would end the test transaction and defeat the rollback.
TRANSACTION_KEYWORDS = {"BEGIN", "COMMIT", "ROLLBACK", "START TRANSACTION"}


def split_sql(script: str) -> list[str]:
    """Split a script into statements, without breaking functions or strings."""
    statements: list[str] = []
    buf: list[str] = []
    i = 0
    length = len(script)
    dollar_tag: str | None = None
    in_single = False

    while i < length:
        if dollar_tag is not None:
            if script.startswith(dollar_tag, i):
                buf.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
            buf.append(script[i])
            i += 1
            continue

        if in_single:
            buf.append(script[i])
            if script[i] == "'":
                if i + 1 < length and script[i + 1] == "'":
                    buf.append("'")
                    i += 2
                    continue
                in_single = False
            i += 1
            continue

        if script[i] == "'":
            in_single = True
            buf.append("'")
            i += 1
            continue

        if script[i] == "$":
            end = i + 1
            while end < length and (script[end].isalnum() or script[end] == "_"):
                end += 1
            if end < length and script[end] == "$":
                dollar_tag = script[i : end + 1]
                buf.append(dollar_tag)
                i = end + 1
                continue

        if script.startswith("--", i):
            while i < length and script[i] != "\n":
                i += 1
            continue

        if script[i] == ";":
            statement = "".join(buf).strip()
            if statement:
                statements.append(statement)
            buf = []
            i += 1
            continue

        buf.append(script[i])
        i += 1

    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def executable(statements: list[str]) -> list[str]:
    """Drop the transaction control statements, handled by the caller."""
    return [item for item in statements if item.strip().upper() not in TRANSACTION_KEYWORDS]


def migration_files() -> list[Path]:
    """Same order as db/init/01_schema.sh: sorted by file name."""
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def schema_ready() -> bool:
    """A database stopping at 001 has every table, and is not ready."""
    with engine.connect() as conn:
        sites = conn.execute(text("SELECT to_regclass('public.sites')")).scalar()
        origin = conn.execute(
            text(
                "SELECT EXISTS ("
                "  SELECT 1 FROM information_schema.columns"
                "  WHERE table_schema = 'public'"
                "    AND table_name = 'predictions'"
                "    AND column_name = 'forecast_origin'"
                ")"
            )
        ).scalar()
    return sites is not None and bool(origin)


def apply_schema() -> None:
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            for path in migration_files():
                for statement in executable(split_sql(path.read_text(encoding="utf-8"))):
                    conn.execute(text(statement))
            transaction.commit()
        except Exception:
            transaction.rollback()
            raise

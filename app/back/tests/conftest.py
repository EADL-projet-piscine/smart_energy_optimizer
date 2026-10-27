import os

import pytest

from smart_energy_app.db import database_available


def pytest_collection_modifyitems(config, items):
    """Skip tests marked `db` when no database can be reached.

    In CI, REQUIRE_DB=1 disables this behaviour: a `db` test must then fail
    rather than be skipped, otherwise a missing database would go unnoticed.
    """
    if os.environ.get("REQUIRE_DB") == "1":
        return
    db_tests = [item for item in items if "db" in item.keywords]
    if not db_tests or database_available():
        return
    reason = pytest.mark.skip(reason="PostgreSQL unreachable (set REQUIRE_DB=1 to require it)")
    for item in db_tests:
        item.add_marker(reason)

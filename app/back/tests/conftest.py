import os

import pytest

from smart_energy_app.db import database_available


def pytest_collection_modifyitems(config, items):
    """Ignore les tests marqués `db` quand aucune base n'est joignable.

    En CI, REQUIRE_DB=1 désactive ce comportement : un test `db` doit alors échouer
    plutôt qu'être ignoré, sinon une base absente passerait inaperçue.
    """
    if os.environ.get("REQUIRE_DB") == "1":
        return
    tests_db = [item for item in items if "db" in item.keywords]
    if not tests_db or database_available():
        return
    raison = pytest.mark.skip(reason="base PostgreSQL injoignable (REQUIRE_DB=1 pour l'exiger)")
    for item in tests_db:
        item.add_marker(raison)

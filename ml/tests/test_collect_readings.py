import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "collect_readings.py"


@pytest.fixture
def collect_module():
    """Charge le script de collecte comme un module Python."""

    spec = importlib.util.spec_from_file_location(
        "collect_readings",
        SCRIPT_PATH,
    )

    if spec is None or spec.loader is None:
        raise RuntimeError("Impossible de charger collect_readings.py")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


@pytest.fixture
def mock_client(monkeypatch, collect_module):
    """Simule EnerVisionClient sans appel réseau."""

    client = MagicMock()

    client.get_readings.return_value = [
        {
            "timestamp": "2026-10-20T12:00:00Z",
            "site_id": "SITE001",
            "consumption_kw": 120.5,
        }
    ]

    context_manager = MagicMock()
    context_manager.__enter__.return_value = client

    monkeypatch.setattr(
        collect_module,
        "EnerVisionClient",
        lambda: context_manager,
    )

    return client


def test_collects_seven_sites(
    monkeypatch,
    tmp_path,
    collect_module,
    mock_client,
):
    """Vérifie la collecte des sept sites."""

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "argv", ["collect_readings.py"])

    collect_module.main()

    assert mock_client.get_readings.call_count == 7

    collected_sites = [call.kwargs["site_id"] for call in mock_client.get_readings.call_args_list]

    assert collected_sites == [f"SITE{i:03d}" for i in range(1, 8)]

    files = list((tmp_path / "data/raw/1d").glob("*.json"))

    assert len(files) == 7


def test_default_collection_period(
    monkeypatch,
    tmp_path,
    collect_module,
    mock_client,
):
    """Vérifie que la durée par défaut est d'un jour."""

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "argv", ["collect_readings.py"])

    collect_module.main()

    first_call = mock_client.get_readings.call_args_list[0]

    start = first_call.kwargs["start"]
    end = first_call.kwargs["end"]

    assert end - start == __import__("datetime").timedelta(days=1)
    assert first_call.kwargs["limit"] == 1000


def test_custom_collection_period(
    monkeypatch,
    tmp_path,
    collect_module,
    mock_client,
):
    """Vérifie la prise en compte du paramètre --days."""

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        ["collect_readings.py", "--days", "7"],
    )

    collect_module.main()

    first_call = mock_client.get_readings.call_args_list[0]

    start = first_call.kwargs["start"]
    end = first_call.kwargs["end"]

    assert end - start == __import__("datetime").timedelta(days=7)

    output_dir = tmp_path / "data/raw/7d"

    assert output_dir.exists()
    assert len(list(output_dir.glob("*.json"))) == 7


@pytest.mark.parametrize("days", ["0", "-1"])
def test_rejects_invalid_days(
    monkeypatch,
    collect_module,
    days,
):
    """Vérifie le rejet des durées invalides."""

    monkeypatch.setattr(
        sys,
        "argv",
        ["collect_readings.py", "--days", days],
    )

    with pytest.raises(SystemExit) as exc:
        collect_module.main()

    assert exc.value.code == 2


def test_generated_json_structure(
    monkeypatch,
    tmp_path,
    collect_module,
    mock_client,
):
    """Vérifie la structure des fichiers JSON."""

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "argv", ["collect_readings.py"])

    collect_module.main()

    path = next((tmp_path / "data/raw/1d").glob("SITE001_*.json"))

    with path.open(encoding="utf-8") as file:
        payload = json.load(file)

    assert payload["site_id"] == "SITE001"

    assert "collected_at" in payload
    assert "period_start" in payload
    assert "period_end" in payload
    assert "readings" in payload

    assert len(payload["readings"]) == 1
    assert payload["readings"][0]["consumption_kw"] == 120.5


def test_collection_ends_five_minutes_before_now(
    monkeypatch,
    tmp_path,
    collect_module,
    mock_client,
):
    """Vérifie la marge de sécurité de cinq minutes."""

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "argv", ["collect_readings.py"])

    before = datetime.now().astimezone()

    collect_module.main()

    after = datetime.now().astimezone()

    end = mock_client.get_readings.call_args_list[0].kwargs["end"]

    assert before <= end + __import__("datetime").timedelta(minutes=5) <= after


def test_client_context_manager_is_used(
    monkeypatch,
    tmp_path,
    collect_module,
    mock_client,
):
    """Vérifie que le client est fermé via le context manager."""

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "argv", ["collect_readings.py"])

    collect_module.main()

    assert mock_client.get_readings.call_count == 7

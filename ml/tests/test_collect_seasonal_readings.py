import importlib.util
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "collect_seasonal_readings.py"


@pytest.fixture
def seasonal_module():
    """Charge le script de collecte saisonnière."""

    spec = importlib.util.spec_from_file_location(
        "collect_seasonal_readings",
        SCRIPT_PATH,
    )

    if spec is None or spec.loader is None:
        raise RuntimeError("Impossible de charger le script saisonnier")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


@pytest.fixture
def mock_client(monkeypatch, seasonal_module):
    """Simule le client EnerVision sans appel réseau."""

    client = MagicMock()

    client.get_readings.return_value = [
        {
            "timestamp": "2026-01-07T12:00:00Z",
            "consumption_kw": 125.5,
            "temperature_celsius": 15.0,
            "humidity_percent": 70.0,
        }
    ]

    context_manager = MagicMock()
    context_manager.__enter__.return_value = client

    monkeypatch.setattr(
        seasonal_module,
        "EnerVisionClient",
        lambda: context_manager,
    )

    return client


@pytest.fixture
def output_dir(monkeypatch, tmp_path, seasonal_module):
    """Redirige les fichiers générés vers un dossier temporaire."""

    directory = tmp_path / "data" / "raw" / "yearly"

    monkeypatch.setattr(
        seasonal_module,
        "OUTPUT_DIR",
        directory,
    )

    return directory


@pytest.mark.parametrize(
    ("year", "month", "expected_day"),
    [
        (2026, 1, 7),
        (2026, 2, 4),
        (2026, 3, 4),
        (2026, 4, 1),
        (2026, 5, 6),
        (2026, 6, 3),
        (2026, 7, 1),
        (2026, 8, 5),
        (2026, 9, 2),
        (2026, 10, 7),
    ],
)
def test_first_wednesday(seasonal_module, year, month, expected_day):
    """Vérifie le premier mercredi de chaque mois étudié."""

    result = seasonal_module.first_wednesday(year, month)

    assert result == datetime(
        year,
        month,
        expected_day,
        tzinfo=UTC,
    )

    assert result.weekday() == 2


def test_collects_all_sites_and_months(
    seasonal_module,
    mock_client,
    output_dir,
):
    """Vérifie la collecte des 70 combinaisons site/mois."""

    seasonal_module.main()

    files = list(output_dir.glob("*.json"))

    assert len(files) == 70
    assert mock_client.get_readings.call_count == 70

    expected_files = {
        (f"SITE{site_number:03d}_{seasonal_module.first_wednesday(2026, month):%Y%m%d}.json")
        for month in range(1, 11)
        for site_number in range(1, 8)
    }

    assert {file.name for file in files} == expected_files


def test_api_parameters(
    seasonal_module,
    mock_client,
    output_dir,
):
    """Vérifie les paramètres envoyés à l'API."""

    seasonal_module.main()

    calls = mock_client.get_readings.call_args_list

    assert len(calls) == 70

    for call in calls:
        kwargs = call.kwargs

        assert kwargs["site_id"] in {f"SITE{i:03d}" for i in range(1, 8)}

        assert kwargs["limit"] == 1000

        assert kwargs["end"] - kwargs["start"] == timedelta(days=1)

        assert kwargs["start"].weekday() == 2
        assert kwargs["start"].year == 2026
        assert 1 <= kwargs["start"].month <= 10


def test_generated_json_structure(
    seasonal_module,
    mock_client,
    output_dir,
):
    """Vérifie le contenu des fichiers générés."""

    seasonal_module.main()

    path = output_dir / "SITE001_20260107.json"

    assert path.exists()

    with path.open(encoding="utf-8") as file:
        payload = json.load(file)

    assert payload["site_id"] == "SITE001"

    assert payload["period_start"] == (datetime(2026, 1, 7, tzinfo=UTC).isoformat())

    assert payload["period_end"] == (datetime(2026, 1, 8, tzinfo=UTC).isoformat())

    collected_at = datetime.fromisoformat(payload["collected_at"])

    assert collected_at.tzinfo is not None

    assert len(payload["readings"]) == 1
    assert payload["readings"][0]["consumption_kw"] == 125.5


def test_existing_file_is_not_overwritten(
    seasonal_module,
    mock_client,
    output_dir,
):
    """Vérifie qu'un fichier existant est conservé à l'identique."""

    output_dir.mkdir(parents=True)

    path = output_dir / "SITE001_20260107.json"

    original_content = '{"existing": true}'

    path.write_text(original_content, encoding="utf-8")

    seasonal_module.main()

    assert path.read_text(encoding="utf-8") == original_content

    assert mock_client.get_readings.call_count == 69

    requested_combinations = {
        (
            call.kwargs["site_id"],
            call.kwargs["start"].date(),
        )
        for call in mock_client.get_readings.call_args_list
    }

    assert ("SITE001", datetime(2026, 1, 7).date()) not in (requested_combinations)


def test_collects_only_missing_files(
    seasonal_module,
    mock_client,
    output_dir,
):
    """Vérifie qu'une collecte partielle ne régénère pas l'existant."""

    output_dir.mkdir(parents=True)

    existing_files = [
        "SITE001_20260107.json",
        "SITE002_20260107.json",
        "SITE003_20260107.json",
    ]

    for filename in existing_files:
        (output_dir / filename).write_text(
            '{"existing": true}',
            encoding="utf-8",
        )

    seasonal_module.main()

    assert mock_client.get_readings.call_count == 67
    assert len(list(output_dir.glob("*.json"))) == 70

    for filename in existing_files:
        assert (output_dir / filename).read_text(encoding="utf-8") == '{"existing": true}'


def test_second_run_does_not_call_api(
    seasonal_module,
    mock_client,
    output_dir,
):
    """Vérifie l'idempotence de la collecte."""

    seasonal_module.main()

    assert mock_client.get_readings.call_count == 70

    mock_client.reset_mock()

    seasonal_module.main()

    assert mock_client.get_readings.call_count == 0
    assert len(list(output_dir.glob("*.json"))) == 70

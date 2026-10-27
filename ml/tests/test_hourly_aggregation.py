import json
from datetime import UTC, datetime, timedelta

import pandas as pd
import pytest

from smart_energy_ml.preprocessing.hourly_aggregation import (
    build_hourly_dataset,
    find_raw_files,
)

START = datetime(2026, 6, 15, tzinfo=UTC)
END = datetime(2026, 6, 16, tzinfo=UTC)


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------


def make_readings(
    count: int,
    hour: int = 0,
    value: float = 50.0,
    site_id: str = "SITE001",
    site_type: str = "office",
) -> list[dict]:
    """Génère des mesures espacées de cinq minutes."""

    origin = START + timedelta(hours=hour)

    return [
        {
            "site_id": site_id,
            "site_type": site_type,
            "timestamp": (origin + timedelta(minutes=5 * i)).isoformat(),
            "consumption_kw": value,
        }
        for i in range(count)
    ]


def write_readings(
    raw_dir,
    readings: list[dict],
    site_id: str = "SITE001",
    day: str = "20260615",
) -> None:
    """Écrit un fichier au format du collecteur EnerVision."""

    site_dir = raw_dir / site_id
    site_dir.mkdir(parents=True, exist_ok=True)

    path = site_dir / f"{site_id}_{day}.json"

    payload = {
        "site_id": site_id,
        "period_start": START.isoformat(),
        "period_end": END.isoformat(),
        "readings": readings,
    }

    path.write_text(
        json.dumps(payload),
        encoding="utf-8",
    )


# ---------------------------------------------------------
# Agrégation et couverture
# ---------------------------------------------------------


def test_full_hour_has_correct_average(tmp_path):
    readings = make_readings(12)

    for index, reading in enumerate(readings):
        reading["consumption_kw"] = float(index + 1)

    write_readings(tmp_path, readings)

    df = build_hourly_dataset(START, END, tmp_path)

    first_hour = df.iloc[0]

    assert len(df) == 24
    assert first_hour["consumption_kw"] == pytest.approx(6.5)
    assert first_hour["valid_readings"] == 12
    assert first_hour["total_readings"] == 12
    assert first_hour["coverage_pct"] == pytest.approx(100.0)


def test_nine_valid_readings_are_accepted(tmp_path):
    write_readings(
        tmp_path,
        make_readings(9, value=42.0),
    )

    df = build_hourly_dataset(START, END, tmp_path)

    first_hour = df.iloc[0]

    assert first_hour["valid_readings"] == 9
    assert first_hour["coverage_pct"] == pytest.approx(75.0)
    assert first_hour["consumption_kw"] == pytest.approx(42.0)


def test_eight_valid_readings_are_rejected(tmp_path):
    write_readings(
        tmp_path,
        make_readings(8),
    )

    df = build_hourly_dataset(START, END, tmp_path)

    first_hour = df.iloc[0]

    assert first_hour["valid_readings"] == 8
    assert first_hour["coverage_pct"] == pytest.approx(8 / 12 * 100)
    assert pd.isna(first_hour["consumption_kw"])


def test_missing_hours_are_reconstructed(tmp_path):
    write_readings(
        tmp_path,
        make_readings(12, hour=0),
    )

    df = build_hourly_dataset(START, END, tmp_path)

    assert len(df) == 24

    missing_hour = df.iloc[1]

    assert missing_hour["timestamp"] == pd.Timestamp("2026-06-15T01:00:00Z")
    assert missing_hour["valid_readings"] == 0
    assert missing_hour["coverage_pct"] == 0
    assert pd.isna(missing_hour["consumption_kw"])


def test_invalid_values_are_excluded_from_average(tmp_path):
    readings = make_readings(12, value=50.0)

    readings[0]["consumption_kw"] = None
    readings[1]["consumption_kw"] = "invalid"
    readings[2]["consumption_kw"] = 100.0

    write_readings(tmp_path, readings)

    df = build_hourly_dataset(START, END, tmp_path)

    first_hour = df.iloc[0]

    assert first_hour["valid_readings"] == 10
    assert first_hour["coverage_pct"] == pytest.approx(10 / 12 * 100)
    assert first_hour["consumption_kw"] == pytest.approx(55.0)


# ---------------------------------------------------------
# Validation des données
# ---------------------------------------------------------


def test_duplicate_readings_raise_error(tmp_path):
    readings = make_readings(12)
    readings.append(readings[0].copy())

    write_readings(tmp_path, readings)

    with pytest.raises(ValueError, match="Doublons"):
        build_hourly_dataset(START, END, tmp_path)


def test_multiple_site_types_raise_error(tmp_path):
    readings = make_readings(12, site_type="office") + make_readings(
        12,
        hour=1,
        site_type="factory",
    )

    write_readings(tmp_path, readings)

    with pytest.raises(ValueError, match="Plusieurs types"):
        build_hourly_dataset(START, END, tmp_path)


def test_files_outside_period_are_ignored(tmp_path):
    write_readings(
        tmp_path,
        make_readings(12),
        day="20260615",
    )

    # Fichier hors période contenant volontairement
    # des données invalides.
    site_dir = tmp_path / "SITE001"

    (site_dir / "SITE001_20260614.json").write_text(
        "{invalid json",
        encoding="utf-8",
    )

    df = build_hourly_dataset(START, END, tmp_path)

    assert len(df) == 24
    assert df.iloc[0]["consumption_kw"] == pytest.approx(50.0)


def test_missing_files_raise_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        build_hourly_dataset(START, END, tmp_path)


def test_naive_dates_raise_error(tmp_path):
    naive_start = datetime(2026, 6, 15)
    naive_end = datetime(2026, 6, 16)

    with pytest.raises(ValueError, match="fuseau horaire"):
        build_hourly_dataset(
            naive_start,
            naive_end,
            tmp_path,
        )


def test_invalid_period_raises_error(tmp_path):
    with pytest.raises(ValueError, match="précéder"):
        build_hourly_dataset(
            END,
            START,
            tmp_path,
        )


def test_non_aligned_hours_raise_error(tmp_path):
    start = START + timedelta(minutes=30)

    with pytest.raises(ValueError, match="heures entières"):
        build_hourly_dataset(
            start,
            END,
            tmp_path,
        )


# ---------------------------------------------------------
# Cohérence temporelle et multisite
# ---------------------------------------------------------


def test_multiple_sites_are_aggregated_separately(tmp_path):
    write_readings(
        tmp_path,
        make_readings(12, value=40.0, site_id="SITE001"),
        site_id="SITE001",
    )

    write_readings(
        tmp_path,
        make_readings(
            12,
            value=80.0,
            site_id="SITE002",
            site_type="factory",
        ),
        site_id="SITE002",
    )

    df = build_hourly_dataset(START, END, tmp_path)

    assert len(df) == 48
    assert df["site_id"].nunique() == 2

    first_hours = df.loc[df["timestamp"] == pd.Timestamp("2026-06-15T00:00:00Z")]

    values = dict(
        zip(
            first_hours["site_id"],
            first_hours["consumption_kw"],
        )
    )

    assert values["SITE001"] == pytest.approx(40.0)
    assert values["SITE002"] == pytest.approx(80.0)


def test_end_boundary_is_exclusive(tmp_path):
    readings = make_readings(12)

    readings.append(
        {
            "site_id": "SITE001",
            "site_type": "office",
            "timestamp": END.isoformat(),
            "consumption_kw": 999.0,
        }
    )

    write_readings(tmp_path, readings)

    df = build_hourly_dataset(START, END, tmp_path)

    assert len(df) == 24
    assert df["timestamp"].max() == pd.Timestamp("2026-06-15T23:00:00Z")


def test_find_raw_files_accepts_valid_file(tmp_path):
    site_dir = tmp_path / "SITE001"
    site_dir.mkdir()

    expected_file = site_dir / "SITE001_20261027.json"
    expected_file.write_text('{"readings": []}', encoding="utf-8")

    days = pd.date_range("2026-10-27", periods=1, tz="UTC")

    result = find_raw_files(tmp_path, days)

    assert result == [expected_file.resolve()]


def test_find_raw_files_rejects_external_symlink(tmp_path):
    raw_dir = tmp_path / "raw"
    site_dir = raw_dir / "SITE001"
    site_dir.mkdir(parents=True)

    external_file = tmp_path / "external.json"
    external_file.write_text(
        '{"readings": []}',
        encoding="utf-8",
    )

    symlink = site_dir / "SITE001_20261027.json"

    try:
        symlink.symlink_to(external_file)
    except (OSError, NotImplementedError):
        pytest.skip("Création de liens symboliques indisponible")

    days = pd.date_range("2026-10-27", periods=1, tz="UTC")

    with pytest.raises(ValueError, match="symbolique"):
        find_raw_files(raw_dir, days)

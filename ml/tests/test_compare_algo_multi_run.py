import importlib.util
import json
import math
import os
import tempfile
from datetime import datetime
from pathlib import Path

import matplotlib
import numpy as np
import pytest

matplotlib.use("Agg")

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "compare_algo_multi_run.py"


@pytest.fixture(scope="module")
def algo():
    """Charge le script de comparaison Random Forest / XGBoost."""

    # Le script crée graphiques_multi_runs/ à l'import : on l'importe depuis un dossier temporaire.
    spec = importlib.util.spec_from_file_location("compare_algo_multi_run", SCRIPT_PATH)

    if spec is None or spec.loader is None:
        raise RuntimeError("Impossible de charger le script de comparaison")

    module = importlib.util.module_from_spec(spec)

    previous_dir = os.getcwd()

    with tempfile.TemporaryDirectory() as directory:
        os.chdir(directory)

        try:
            spec.loader.exec_module(module)
        finally:
            os.chdir(previous_dir)

    return module


def make_profile(**overrides):
    """Construit un profil de site simple (saisonnalité et week-end neutres par défaut)."""

    profile = {
        "base_consumption": 100.0,
        "peak_consumption": 200.0,
        "working_hours": [8, 18],
        "working_days": [0, 1, 2, 3, 4],
        "seasonal_variation": 0.0,
        "noise_level": 0.1,
    }
    profile.update(overrides)

    return profile


def write_site_file(directory, site_id, site_type, start, end, **overrides):
    """Écrit une fiche SITE00X_metadata.json minimale."""

    directory.mkdir(parents=True, exist_ok=True)

    payload = {
        "site_type": site_type,
        "start_date": start,
        "end_date": end,
        "profile": make_profile(**overrides),
    }

    (directory / f"{site_id}_metadata.json").write_text(
        json.dumps(payload),
        encoding="utf-8",
    )


@pytest.fixture
def data_dir(monkeypatch, tmp_path, algo):
    """Crée deux sites de 90 jours et redirige DATA_DIR vers eux."""

    directory = tmp_path / "data"

    write_site_file(directory, "SITE001", "office", "2023-01-01", "2023-04-01")
    write_site_file(
        directory,
        "SITE002",
        "factory",
        "2023-01-01",
        "2023-04-01",
        noise_level=0.2,
        peak_consumption=300.0,
    )

    monkeypatch.setattr(algo, "DATA_DIR", directory)

    return directory


@pytest.fixture
def output_dir(monkeypatch, tmp_path, algo):
    """Redirige les graphiques vers un dossier temporaire."""

    directory = tmp_path / "graphiques"
    directory.mkdir()

    monkeypatch.setattr(algo, "OUT_DIR", directory)

    return directory


@pytest.fixture
def base(data_dir, algo):
    """Base d'entraînement/test construite sur les deux sites temporaires."""

    X, clean, sigma, train_mask = algo.construire_base()

    return {"X": X, "clean": clean, "sigma": sigma, "train_mask": train_mask}


# ----------------------------------------------------------------------
# serie_propre_site
# ----------------------------------------------------------------------
def test_clean_series_has_one_value_per_hour_and_excludes_end(algo):
    """Vérifie une valeur par heure, la date de fin étant exclue."""

    lines, clean, _ = algo.serie_propre_site(
        make_profile(),
        datetime(2023, 1, 1),
        datetime(2023, 1, 8),
    )

    assert len(lines) == 7 * 24
    assert len(clean) == 7 * 24
    assert lines[-1][0] == datetime(2023, 1, 7, 23)


def test_clean_series_empty_period(algo):
    """Vérifie qu'une période vide ne produit aucune ligne."""

    lines, clean, _ = algo.serie_propre_site(
        make_profile(),
        datetime(2023, 1, 1),
        datetime(2023, 1, 1),
    )

    assert lines == []
    assert len(clean) == 0


def test_clean_series_line_format(algo):
    """Vérifie le format (date, heure, jour, mois, week-end, base, pic)."""

    lines, _, _ = algo.serie_propre_site(
        make_profile(),
        datetime(2023, 1, 7, 10),
        datetime(2023, 1, 7, 11),
    )

    assert lines[0] == (datetime(2023, 1, 7, 10), 10, 5, 1, 1, 100.0, 200.0)


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        (datetime(2023, 1, 2, 10), 200.0),  # lundi, heure de travail
        (datetime(2023, 1, 2, 3), 130.0),  # lundi, hors horaires
        (datetime(2023, 1, 2, 7), 130.0),  # juste avant l'ouverture
        (datetime(2023, 1, 2, 8), 200.0),  # première heure active
        (datetime(2023, 1, 2, 17), 200.0),  # dernière heure active
        (datetime(2023, 1, 2, 18), 130.0),  # fermeture : heure exclue
        (datetime(2023, 1, 7, 10), 130.0),  # samedi : jour non travaillé
    ],
)
def test_clean_series_activity(algo, moment, expected):
    """Vérifie la consommation selon l'heure et le jour (base 100, pic 200)."""

    _, clean, _ = algo.serie_propre_site(
        make_profile(),
        moment,
        moment.replace(hour=moment.hour + 1),
    )

    assert clean[0] == pytest.approx(expected)


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        (datetime(2023, 1, 7, 10), 100 + 100 * 0.3 * 0.5),  # samedi
        (datetime(2023, 1, 8, 10), 100 + 100 * 0.3 * 0.5),  # dimanche
        (datetime(2023, 1, 2, 10), 200.0),  # lundi : aucun effet
    ],
)
def test_clean_series_weekend_factor(algo, moment, expected):
    """Vérifie que weekend_factor ne s'applique que le samedi et le dimanche."""

    _, clean, _ = algo.serie_propre_site(
        make_profile(weekend_factor=0.5),
        moment,
        moment.replace(hour=moment.hour + 1),
    )

    assert clean[0] == pytest.approx(expected)


def test_clean_series_missing_weekend_factor_means_one(algo):
    """Vérifie qu'un weekend_factor absent équivaut à 1.0."""

    start, end = datetime(2023, 1, 7), datetime(2023, 1, 9)

    _, without, _ = algo.serie_propre_site(make_profile(), start, end)
    _, with_one, _ = algo.serie_propre_site(make_profile(weekend_factor=1.0), start, end)

    np.testing.assert_allclose(without, with_one)


def test_clean_series_seasonality_formula(algo):
    """Vérifie la saisonnalité en cosinus (lundi 2 janvier = 2e jour de l'année)."""

    _, clean, _ = algo.serie_propre_site(
        make_profile(seasonal_variation=0.2),
        datetime(2023, 1, 2, 10),
        datetime(2023, 1, 2, 11),
    )

    expected = 100 + 100 * (1 + 0.2 * math.cos(2 * math.pi * 2 / 365))

    assert clean[0] == pytest.approx(expected)


def test_clean_series_peaks_in_winter(algo):
    """Vérifie que la consommation est plus forte en hiver qu'en été."""

    profile = make_profile(seasonal_variation=0.2)

    _, winter, _ = algo.serie_propre_site(
        profile, datetime(2023, 1, 2, 10), datetime(2023, 1, 2, 11)
    )
    _, summer, _ = algo.serie_propre_site(
        profile, datetime(2023, 7, 3, 10), datetime(2023, 7, 3, 11)
    )

    assert winter[0] > summer[0]


def test_clean_series_noise_is_proportional_to_peak(algo):
    """Vérifie sigma = noise_level x peak_consumption."""

    _, _, sigma = algo.serie_propre_site(
        make_profile(noise_level=0.15),
        datetime(2023, 1, 1),
        datetime(2023, 1, 2),
    )

    assert sigma == pytest.approx(0.15 * 200.0)


def test_clean_series_never_below_base(algo):
    """Vérifie que la consommation propre ne descend jamais sous la base."""

    _, clean, _ = algo.serie_propre_site(
        make_profile(seasonal_variation=0.2),
        datetime(2023, 1, 1),
        datetime(2023, 12, 31),
    )

    assert clean.min() >= 100.0


# ----------------------------------------------------------------------
# construire_base
# ----------------------------------------------------------------------
def test_build_base_sizes(base):
    """Vérifie les dimensions : 2 sites x 90 jours x 24 h, 7 features."""

    expected_rows = 2 * 90 * 24

    # heure, jour, mois, week-end, base, pic, code du type de site
    assert base["X"].shape == (expected_rows, 7)
    assert len(base["clean"]) == expected_rows
    assert len(base["sigma"]) == expected_rows
    assert len(base["train_mask"]) == expected_rows


def test_build_base_has_no_missing_values(base):
    """Vérifie l'absence de valeurs manquantes."""

    assert not np.isnan(base["X"]).any()
    assert not np.isnan(base["clean"]).any()


def test_build_base_site_type_codes_are_alphabetical(base):
    """Vérifie les codes de type de site : factory = 0, office = 1."""

    X = base["X"]

    assert (X[X[:, 5] == 200.0][:, 6] == 1).all()  # office
    assert (X[X[:, 5] == 300.0][:, 6] == 0).all()  # factory


def test_build_base_keeps_one_sigma_per_site(base):
    """Vérifie que chaque site garde son propre niveau de bruit."""

    assert set(np.round(base["sigma"], 6)) == {0.1 * 200.0, 0.2 * 300.0}


def test_build_base_is_sorted_by_date(base):
    """Vérifie que les deux sites sont mélangés dans l'ordre chronologique."""

    X = base["X"]

    assert X[0, 0] == X[1, 0]
    assert set(X[:2, 6]) == {0.0, 1.0}


def test_build_base_test_set_is_last_sixty_days(base):
    """Vérifie que le test contient les 60 derniers jours (1441 lignes par site)."""

    test_rows = int((~base["train_mask"]).sum())

    assert test_rows == 2 * (60 * 24 + 1)
    assert int(base["train_mask"].sum()) == 2 * 90 * 24 - test_rows


def test_build_base_has_no_train_test_leakage(base):
    """Vérifie que les premières lignes sont en train et les dernières en test."""

    assert base["train_mask"][:100].all()
    assert not base["train_mask"][-100:].any()


def test_build_base_calendar_features_are_consistent(base):
    """Vérifie les bornes des features calendaires."""

    hour, weekday, month, weekend = (base["X"][:, i] for i in range(4))

    assert ((hour >= 0) & (hour <= 23)).all()
    assert ((weekday >= 0) & (weekday <= 6)).all()
    assert set(month) <= {1.0, 2.0, 3.0}
    np.testing.assert_array_equal(weekend, (weekday >= 5).astype(float))


# ----------------------------------------------------------------------
# un_run
# ----------------------------------------------------------------------
@pytest.fixture(scope="module")
def run_context(algo, tmp_path_factory):
    """Entraîne une fois les deux modèles (utilisé par plusieurs tests)."""

    directory = tmp_path_factory.mktemp("run") / "data"

    write_site_file(
        directory,
        "SITE001",
        "office",
        "2023-01-01",
        "2023-05-01",
        seasonal_variation=0.2,
    )

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(algo, "DATA_DIR", directory)
        context = algo.construire_base()

    return {"args": context, "result": algo.un_run(1, *context)}


def test_run_evaluates_both_models(algo, run_context):
    """Vérifie que Random Forest et XGBoost sont évalués."""

    assert set(run_context["result"]) == {algo.NOM_RF, algo.NOM_BOOST}


def test_run_metrics_are_valid(run_context):
    """Vérifie MAE > 0, RMSE >= MAE et un temps positif."""

    for mae, rmse, duration in run_context["result"].values():
        assert math.isfinite(mae)
        assert mae > 0
        assert rmse >= mae
        assert duration >= 0


def test_run_same_seed_gives_same_result(algo, run_context):
    """Vérifie la reproductibilité à graine identique."""

    again = algo.un_run(1, *run_context["args"])

    for name, (mae, rmse, _) in run_context["result"].items():
        assert again[name][0] == pytest.approx(mae)
        assert again[name][1] == pytest.approx(rmse)


def test_run_other_seed_gives_other_result(algo, run_context):
    """Vérifie qu'une autre graine change le résultat."""

    other = algo.un_run(2, *run_context["args"])

    assert other[algo.NOM_RF][0] != pytest.approx(run_context["result"][algo.NOM_RF][0])


def test_run_mae_is_close_to_theoretical_floor(run_context):
    """Vérifie que la MAE reste entre 0,85x et 1,5x le plancher théorique.

    Le bruit étant gaussien, aucun modèle ne peut descendre sous sigma x sqrt(2/pi).
    """

    _, _, sigma, train_mask = run_context["args"]
    floor = float(np.mean(sigma[~train_mask]) * np.sqrt(2 / np.pi))

    for mae, _, _ in run_context["result"].values():
        assert mae > 0.85 * floor
        assert mae < 1.5 * floor


# ----------------------------------------------------------------------
# graphiques
# ----------------------------------------------------------------------
@pytest.mark.parametrize("runs_count", [4, 20])
def test_charts_are_created(algo, output_dir, runs_count):
    """Vérifie les deux PNG, avec peu et beaucoup de lancements."""

    runs = [
        {
            algo.NOM_RF: (10.0 + i, 12.0 + i, 0.5),
            algo.NOM_BOOST: (9.5 + i, 11.5 + i, 0.1),
        }
        for i in range(runs_count)
    ]

    algo.graphiques(runs, plancher=8.0)

    assert (output_dir / "1_metriques_par_lancement.png").stat().st_size > 0
    assert (output_dir / "2_ecart_mae_par_lancement.png").stat().st_size > 0


# ----------------------------------------------------------------------
# main
# ----------------------------------------------------------------------
def test_main_full_execution(monkeypatch, tmp_path, algo, data_dir, output_dir, capsys):
    """Vérifie le CSV, la synthèse affichée et les graphiques d'un main() complet."""

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(algo, "N_RUNS", 2)

    algo.main()

    lines = (tmp_path / "comparatif_multi_runs.csv").read_text(encoding="utf-8").splitlines()

    assert lines[0] == "run,seed,algorithme,mae_kwh,rmse_kwh,temps_s"
    assert len(lines) == 1 + 2 * 2  # 2 lancements x 2 algorithmes

    seeds = {line.split(",")[1] for line in lines[1:]}

    assert seeds == {str(algo.SEED_DEPART), str(algo.SEED_DEPART + 1)}

    output = capsys.readouterr().out

    assert "SYNTHÈSE SUR 2 LANCEMENTS" in output
    assert "plancher théorique" in output
    assert len(list(output_dir.glob("*.png"))) == 2

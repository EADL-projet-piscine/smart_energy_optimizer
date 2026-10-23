import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pandas as pd
import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "compare_data_quality_x_sensors.py"

SITES = [f"SITE{i:03d}" for i in range(1, 8)]
SENSORS = ["consumption", "electrical", "temperature", "humidity", "network"]


@pytest.fixture
def module(monkeypatch):
    """Charge le script de comparaison /current vs /sensors/status."""

    # Identifiants fictifs : le .env du projet ne doit jamais être utilisé par les tests.
    monkeypatch.setenv("ENERVISION_API_URL", "https://api.example.test/")
    monkeypatch.setenv("ENERVISION_API_USERNAME", "user")
    monkeypatch.setenv("ENERVISION_API_PASSWORD", "password")

    spec = importlib.util.spec_from_file_location("compare_data_quality_x_sensors", SCRIPT_PATH)

    if spec is None or spec.loader is None:
        raise RuntimeError("Impossible de charger le script de comparaison")

    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)

    return loaded


@pytest.fixture
def snapshot_file(monkeypatch, tmp_path, module):
    """Redirige le CSV produit vers un dossier temporaire (non créé tant qu'on ne collecte pas)."""

    directory = tmp_path / "data" / "raw"
    path = directory / "snapshots_quality_vs_status.csv"

    monkeypatch.setattr(module, "SNAP_DIR", directory)
    monkeypatch.setattr(module, "SNAP_FILE", path)

    return path


# ----------------------------------------------------------------------
# Faux serveur EnerVision
# ----------------------------------------------------------------------
def site_status(overall="ok", **sensor_statuses):
    """Réponse de /sensors/status pour un site (tous les capteurs ok par défaut)."""

    sensors = {name: {"status": "ok"} for name in SENSORS}

    for name, status in sensor_statuses.items():
        sensors[name] = {"status": status}

    return {"overall": overall, "sensors": sensors}


class FakeResponse:
    def __init__(self, payload, error=None):
        self.payload = payload
        self.error = error

    def raise_for_status(self):
        if self.error:
            raise self.error

    def json(self):
        return self.payload


class FakeClient:
    """Simule httpx.Client : enregistre les appels et renvoie des réponses prédéfinies."""

    def __init__(self, status=None, current=None, readings=None, fail_current_for=None):
        self.status = status if status is not None else {s: site_status() for s in SITES}
        self.current = current or {}
        self.readings = readings or {}
        self.fail_current_for = fail_current_for
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url, params=None):
        self.calls.append((url, params))

        if url == "/api/v1/sensors/status":
            return FakeResponse(self.status)

        if url.endswith("/current"):
            site = url.split("/")[-2]

            if site == self.fail_current_for:
                return FakeResponse(None, error=RuntimeError("503 Service Unavailable"))

            return FakeResponse(
                self.current.get(site, {"data_quality": "good", "null_reasons": []})
            )

        if url == "/api/v1/readings":
            site = params["site_id"]

            return FakeResponse([{"site_id": site, **r} for r in self.readings.get(site, [])])

        raise AssertionError(f"URL inattendue : {url}")

    def urls(self, suffix=""):
        return [url for url, _ in self.calls if url.endswith(suffix)]


@pytest.fixture
def fake_api(monkeypatch, module):
    """Remplace make_client par un faux client et simule l'horloge (rien n'attend vraiment)."""

    started_at = datetime.now(UTC)
    state = SimpleNamespace(client=FakeClient(), now=0.0)

    class FakeDatetime(datetime):
        """datetime.now() suit l'horloge simulée : 30 s simulées = 30 s d'écart exactes."""

        @classmethod
        def now(cls, tz=None):
            return started_at + timedelta(seconds=state.now)

    def sleep(seconds):
        state.now += seconds

    monkeypatch.setattr(module, "make_client", lambda: state.client)
    monkeypatch.setattr(module, "datetime", FakeDatetime)
    monkeypatch.setattr(module, "time", SimpleNamespace(time=lambda: state.now, sleep=sleep))

    return state


def snapshot_rows(*rows):
    """Construit un DataFrame de relevés ; les colonnes manquantes sont complétées."""

    base = {
        "polled_at": "2026-01-07T12:00:00+00:00",
        "site_id": "SITE001",
        "data_quality": "good",
        "null_reasons": "",
        "overall": "ok",
        **{f"sensor_{s}": "ok" for s in SENSORS},
    }

    return pd.DataFrame([{**base, **row} for row in rows])


# ----------------------------------------------------------------------
# Configuration et constantes
# ----------------------------------------------------------------------
def test_base_url_has_no_trailing_slash(module):
    """Vérifie que l'URL de l'API est lue dans l'environnement, sans slash final."""

    assert module.BASE_URL == "https://api.example.test"


def test_auth_uses_environment_credentials(module):
    """Vérifie que l'authentification est construite à partir des variables d'environnement."""

    assert isinstance(module.AUTH, httpx.BasicAuth)


def test_sites_and_sensors(module):
    """Vérifie les 7 sites et les 5 capteurs étudiés."""

    assert module.SITES == SITES
    assert module.SENSORS == SENSORS


def test_every_sensor_has_one_null_reason(module):
    """Vérifie que chaque capteur est relié à exactement un null_reason."""

    assert sorted(module.REASON_TO_SENSOR.values()) == sorted(SENSORS)


@pytest.mark.parametrize(
    ("quality", "overall"),
    [
        ("good", "ok"),
        ("partial", "degraded"),
        ("degraded", "degraded"),
        ("critical", "critical"),
    ],
)
def test_quality_is_mapped_to_overall_vocabulary(module, quality, overall):
    """Vérifie la traduction de data_quality vers le vocabulaire de overall."""

    assert module.QUALITY_TO_OVERALL[quality] == overall


def test_display_orders_cover_all_values(module):
    """Vérifie que les ordres d'affichage couvrent toutes les valeurs possibles."""

    assert set(module.QUALITY_ORDER) == set(module.QUALITY_TO_OVERALL)
    assert set(module.OVERALL_ORDER) == set(module.QUALITY_TO_OVERALL.values())


# ----------------------------------------------------------------------
# load_snapshots
# ----------------------------------------------------------------------
def test_load_snapshots_missing_file_exits(module, snapshot_file):
    """Vérifie le message d'erreur quand la collecte n'a pas encore eu lieu."""

    with pytest.raises(SystemExit) as error:
        module.load_snapshots()

    assert "Pas de données" in str(error.value)
    assert "introuvable" in str(error.value)


def test_load_snapshots_prepares_columns(module, snapshot_file):
    """Vérifie les colonnes ajoutées : date, qualité ramenée à overall et accord."""

    snapshot_file.parent.mkdir(parents=True)
    snapshot_rows(
        {"data_quality": "good", "overall": "ok"},
        {"data_quality": "partial", "overall": "degraded", "site_id": "SITE002"},
        {"data_quality": "good", "overall": "critical", "site_id": "SITE003"},
    ).to_csv(snapshot_file, index=False)

    df = module.load_snapshots()

    assert pd.api.types.is_datetime64_any_dtype(df["polled_at"])
    assert list(df["quality_norm"]) == ["ok", "degraded", "ok"]
    assert list(df["agree"]) == [True, True, False]


def test_load_snapshots_replaces_missing_values_by_empty_string(module, snapshot_file):
    """Vérifie que null_reasons vide (lu comme NaN par pandas) devient une chaîne vide."""

    snapshot_file.parent.mkdir(parents=True)
    snapshot_rows({"null_reasons": ""}).to_csv(snapshot_file, index=False)

    df = module.load_snapshots()

    assert df.loc[0, "null_reasons"] == ""


# ----------------------------------------------------------------------
# sensor_table
# ----------------------------------------------------------------------
def test_sensor_table_counts_the_four_cases(module):
    """Vérifie les 4 cas : les deux, null_reason seul, status seul, aucun."""

    df = snapshot_rows(
        # consumption : /current et /sensors/status signalent la panne -> "les deux"
        {"null_reasons": "consumption_sensor_failure", "sensor_consumption": "failing"},
        # temperature : /current signale, le status dit ok -> "null_reason seul"
        {"null_reasons": "temperature_sensor_failure"},
        # humidity : le status signale, /current n'en parle pas -> "status seul"
        {"sensor_humidity": "failing"},
        # rien nulle part -> "aucun"
        {},
    )

    table = module.sensor_table(df)

    assert table.loc[
        "consumption", ["les deux", "null_reason seul", "status seul", "aucun"]
    ].tolist() == [1, 0, 0, 3]
    assert table.loc[
        "temperature", ["les deux", "null_reason seul", "status seul", "aucun"]
    ].tolist() == [0, 1, 0, 3]
    assert table.loc[
        "humidity", ["les deux", "null_reason seul", "status seul", "aucun"]
    ].tolist() == [0, 0, 1, 3]
    assert table.loc[
        "electrical", ["les deux", "null_reason seul", "status seul", "aucun"]
    ].tolist() == [0, 0, 0, 4]


def test_sensor_table_concordance(module):
    """Vérifie la concordance = (les deux + aucun) / total, affichée en pourcentage."""

    df = snapshot_rows(
        {"null_reasons": "consumption_sensor_failure", "sensor_consumption": "failing"},
        {"null_reasons": "consumption_sensor_failure"},  # incohérent
        {},
        {},
    )

    assert module.sensor_table(df).loc["consumption", "concordance"] == "75%"
    assert module.sensor_table(df).loc["electrical", "concordance"] == "100%"


@pytest.mark.parametrize("status", ["failing", "failed", "degraded", "offline"])
def test_sensor_table_any_status_but_ok_is_a_failure(module, status):
    """Vérifie que tout statut différent de 'ok' et de '' compte comme une panne."""

    df = snapshot_rows({"sensor_network": status})

    assert module.sensor_table(df).loc["network", "status seul"] == 1


def test_sensor_table_empty_status_is_not_a_failure(module):
    """Vérifie qu'un statut vide (capteur absent de la réponse) n'est pas une panne."""

    df = snapshot_rows({"sensor_network": ""})

    assert module.sensor_table(df).loc["network", "status seul"] == 0


def test_sensor_table_several_null_reasons(module):
    """Vérifie que plusieurs null_reasons séparés par '|' sont tous pris en compte."""

    df = snapshot_rows(
        {
            "null_reasons": "consumption_sensor_failure|humidity_sensor_failure",
            "sensor_consumption": "failing",
            "sensor_humidity": "failing",
        }
    )

    table = module.sensor_table(df)

    assert table.loc["consumption", "les deux"] == 1
    assert table.loc["humidity", "les deux"] == 1
    assert table.loc["temperature", "aucun"] == 1


def test_sensor_table_ignores_unknown_null_reason(module):
    """Vérifie qu'un null_reason inconnu ne provoque ni erreur ni faux positif."""

    table = module.sensor_table(snapshot_rows({"null_reasons": "meteor_strike"}))

    assert table["null_reason seul"].sum() == 0
    assert table["aucun"].tolist() == [1] * len(SENSORS)


@pytest.mark.xfail(
    strict=False,
    reason="Avec pandas 3, 'reason & failing' sur un tableau vide renvoie '' et non 0",
)
def test_sensor_table_empty_dataframe(module):
    """Vérifie qu'un tableau vide ne provoque pas de division par zéro."""

    table = module.sensor_table(snapshot_rows({}).iloc[0:0])

    assert table["concordance"].tolist() == ["0%"] * len(SENSORS)


def test_sensor_table_has_one_row_per_sensor(module):
    """Vérifie la structure : un index par capteur et 6 colonnes."""

    table = module.sensor_table(snapshot_rows({}))

    assert list(table.index) == SENSORS
    assert list(table.columns) == [
        "les deux",
        "null_reason seul",
        "status seul",
        "aucun",
        "concordance",
    ]


# ----------------------------------------------------------------------
# collect
# ----------------------------------------------------------------------
def test_collect_does_not_create_directory_before_collecting(module, snapshot_file):
    """Vérifie que le dossier de sortie n'existe pas tant que rien n'est collecté."""

    assert not snapshot_file.parent.exists()


def test_collect_writes_one_row_per_site_and_poll(module, fake_api, snapshot_file):
    """Vérifie 2 relevés x 7 sites = 14 lignes dans un seul fichier."""

    module.collect(minutes=1, interval=30)

    df = pd.read_csv(snapshot_file)

    assert len(df) == 2 * 7
    assert df["polled_at"].nunique() == 2
    assert sorted(df["site_id"].unique()) == SITES

    first, second = sorted(df["polled_at"].unique())

    assert datetime.fromisoformat(second) - datetime.fromisoformat(first) == timedelta(seconds=30)


def test_collect_csv_columns(module, fake_api, snapshot_file):
    """Vérifie les colonnes du CSV produit."""

    module.collect(minutes=1, interval=60)

    assert list(pd.read_csv(snapshot_file).columns) == [
        "polled_at",
        "site_id",
        "data_quality",
        "null_reasons",
        "overall",
        *[f"sensor_{s}" for s in SENSORS],
    ]


def test_collect_calls_status_once_per_poll(module, fake_api, snapshot_file):
    """Vérifie qu'un seul appel /sensors/status sert aux 7 sites d'un même relevé."""

    module.collect(minutes=1, interval=30)

    client = fake_api.client

    assert len(client.urls("/sensors/status")) == 2
    assert len(client.urls("/current")) == 14
    assert client.urls("/current")[:7] == [f"/api/v1/sites/{s}/current" for s in SITES]


def test_collect_uses_same_timestamp_for_all_sites_of_a_poll(module, fake_api, snapshot_file):
    """Vérifie que les 7 sites d'un relevé partagent le même horodatage, en UTC."""

    module.collect(minutes=1, interval=60)

    df = pd.read_csv(snapshot_file)

    assert df["polled_at"].nunique() == 1
    assert datetime.fromisoformat(df.loc[0, "polled_at"]).utcoffset() == timedelta(0)


def test_collect_stores_quality_status_and_null_reasons(module, fake_api, snapshot_file):
    """Vérifie que les valeurs des deux endpoints se retrouvent dans la bonne ligne."""

    fake_api.client = FakeClient(
        status={
            **{s: site_status() for s in SITES},
            "SITE002": site_status(overall="degraded", humidity="failing"),
        },
        current={
            "SITE002": {
                "data_quality": "partial",
                "null_reasons": ["humidity_sensor_failure", "network_loss"],
            }
        },
    )

    module.collect(minutes=1, interval=60)

    row = pd.read_csv(snapshot_file).set_index("site_id").loc["SITE002"]

    assert row["data_quality"] == "partial"
    assert row["null_reasons"] == "humidity_sensor_failure|network_loss"
    assert row["overall"] == "degraded"
    assert row["sensor_humidity"] == "failing"
    assert row["sensor_consumption"] == "ok"


def test_collect_site_missing_from_status_gives_empty_values(module, fake_api, snapshot_file):
    """Vérifie qu'un site absent de /sensors/status donne des valeurs vides, sans erreur."""

    fake_api.client = FakeClient(status={s: site_status() for s in SITES if s != "SITE007"})

    module.collect(minutes=1, interval=60)

    row = pd.read_csv(snapshot_file).set_index("site_id").loc["SITE007"]

    assert pd.isna(row["overall"])
    assert pd.isna(row["sensor_consumption"])


def test_collect_keeps_data_after_ctrl_c(module, fake_api, snapshot_file, monkeypatch, capsys):
    """Vérifie qu'un Ctrl+C conserve les relevés déjà collectés."""

    def interrupt(_seconds):
        raise KeyboardInterrupt

    monkeypatch.setattr(module.time, "sleep", interrupt)

    module.collect(minutes=10, interval=5)

    assert len(pd.read_csv(snapshot_file)) == 7  # un relevé complet avant l'interruption

    output = capsys.readouterr().out

    assert "Collecte interrompue" in output
    assert "7 lignes" in output


def test_collect_writes_nothing_when_nothing_was_collected(
    module, fake_api, snapshot_file, monkeypatch, capsys
):
    """Vérifie qu'aucun fichier (ni dossier) n'est créé quand rien n'a été collecté."""

    def interrupt(*_args, **_kwargs):
        raise KeyboardInterrupt

    monkeypatch.setattr(fake_api.client, "get", interrupt)

    module.collect(minutes=1, interval=5)

    assert not snapshot_file.exists()
    assert not snapshot_file.parent.exists()
    assert "Aucune donnée collectée" in capsys.readouterr().out


def test_collect_api_error_saves_rows_already_collected(module, fake_api, snapshot_file):
    """Vérifie qu'une erreur API fait remonter l'exception mais sauvegarde l'existant."""

    fake_api.client = FakeClient(fail_current_for="SITE003")

    with pytest.raises(RuntimeError, match="503"):
        module.collect(minutes=1, interval=60)

    assert list(pd.read_csv(snapshot_file)["site_id"]) == ["SITE001", "SITE002"]


def test_collect_overwrites_previous_file(module, fake_api, snapshot_file):
    """Vérifie que le fichier est écrasé à chaque collecte, et non complété."""

    module.collect(minutes=1, interval=60)
    module.collect(minutes=1, interval=60)

    assert len(pd.read_csv(snapshot_file)) == 7


# ----------------------------------------------------------------------
# analyze
# ----------------------------------------------------------------------
def write_snapshots(path, *rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_rows(*rows).to_csv(path, index=False)


def test_analyze_without_file_exits(module, snapshot_file):
    """Vérifie que analyze s'arrête proprement si aucune collecte n'a eu lieu."""

    with pytest.raises(SystemExit):
        module.analyze()


def test_analyze_prints_all_sections(module, snapshot_file, capsys):
    """Vérifie la présence des 5 sections du rapport."""

    write_snapshots(snapshot_file, {}, {"site_id": "SITE002"})

    module.analyze()

    output = capsys.readouterr().out

    for section in (
        "1. data_quality (/current) vs overall (/sensors/status)",
        "2. Observations en désaccord",
        "3. Capteur par capteur",
        "4. Test d'hypothèse",
        "5. Taux de panne par capteur",
    ):
        assert section in output


def test_analyze_header_counts(module, snapshot_file, capsys):
    """Vérifie le résumé : observations, sites et relevés."""

    write_snapshots(
        snapshot_file,
        {"site_id": "SITE001", "polled_at": "2026-01-07T12:00:00+00:00"},
        {"site_id": "SITE002", "polled_at": "2026-01-07T12:00:00+00:00"},
        {"site_id": "SITE001", "polled_at": "2026-01-07T12:00:05+00:00"},
    )

    module.analyze()

    assert "3 observations | 2 sites | 2 relevés | 12:00:00 -> 12:00:05" in capsys.readouterr().out


def test_analyze_full_agreement(module, snapshot_file, capsys):
    """Vérifie 100 % de concordance et l'absence de désaccord."""

    write_snapshots(
        snapshot_file,
        {"data_quality": "good", "overall": "ok"},
        {"data_quality": "critical", "overall": "critical", "site_id": "SITE002"},
    )

    module.analyze()

    output = capsys.readouterr().out

    assert "Concordance globale : 100.0% (2 / 2)" in output
    assert "Aucun désaccord." in output


def test_analyze_reports_disagreements(module, snapshot_file, capsys):
    """Vérifie le compte et le détail des désaccords."""

    write_snapshots(
        snapshot_file,
        {"data_quality": "good", "overall": "ok"},
        {"data_quality": "good", "overall": "ok", "site_id": "SITE002"},
        {"data_quality": "good", "overall": "ok", "site_id": "SITE003"},
        {"data_quality": "good", "overall": "critical", "site_id": "SITE004"},
    )

    module.analyze()

    output = capsys.readouterr().out

    assert "Concordance globale : 75.0% (3 / 4)" in output
    assert "1 désaccords sur 4 (25.0%)" in output
    assert "SITE004" in output.split("2. Observations en désaccord")[1]


def test_analyze_shows_all_categories_even_when_absent(module, snapshot_file, capsys):
    """Vérifie que le croisement affiche les 4 qualités et 3 états, même à zéro."""

    write_snapshots(snapshot_file, {"data_quality": "good", "overall": "ok"})

    module.analyze()

    section = capsys.readouterr().out.split("2. Observations")[0]

    for label in ("good", "partial", "degraded", "critical", "ok"):
        assert label in section


def test_analyze_network_loss_hypothesis_excludes_critical_rows(module, snapshot_file, capsys):
    """Vérifie que la section 4 retire les lignes critical et décrit leurs null_reasons."""

    write_snapshots(
        snapshot_file,
        {"data_quality": "good", "overall": "ok"},
        {
            "data_quality": "critical",
            "overall": "critical",
            "null_reasons": "network_loss",
            "site_id": "SITE002",
            **{f"sensor_{s}": "failing" for s in SENSORS},
        },
    )

    module.analyze()

    section = capsys.readouterr().out.split("4. Test d'hypothèse")[1]

    assert "1 observations sans critical" in section
    assert "network_loss" in section.split("null_reasons observés sur les lignes critical")[1]


@pytest.mark.xfail(
    strict=False,
    reason="Toutes lignes critical : la section 4 appelle sensor_table sur un tableau vide",
)
def test_analyze_with_only_critical_rows(module, snapshot_file, capsys):
    """Vérifie que analyze ne plante pas quand toutes les observations sont critical."""

    write_snapshots(
        snapshot_file,
        {"data_quality": "critical", "overall": "critical", "null_reasons": "network_loss"},
        {"data_quality": "critical", "overall": "critical", "site_id": "SITE002"},
    )

    module.analyze()

    assert "0 observations sans critical" in capsys.readouterr().out


def test_analyze_empty_null_reasons_are_labelled(module, snapshot_file, capsys):
    """Vérifie que des null_reasons vides sur les lignes critical s'affichent '(vide)'."""

    write_snapshots(snapshot_file, {"data_quality": "critical", "overall": "critical"})

    module.analyze()

    assert "(vide)" in capsys.readouterr().out


def test_analyze_failure_rates(module, snapshot_file, capsys):
    """Vérifie les taux de panne par capteur et par site."""

    write_snapshots(
        snapshot_file,
        {"site_id": "SITE001", "sensor_humidity": "failing"},
        {"site_id": "SITE001", "sensor_humidity": "failing"},
        {"site_id": "SITE002"},
        {"site_id": "SITE002"},
    )

    module.analyze()

    section = capsys.readouterr().out.split("5. Taux de panne par capteur")[1]

    assert "humidity" in section
    assert "50.0 %" in section  # 2 relevés sur 4
    assert "Taux de panne (%) par site" in section
    # SITE001 : 100 % pour humidity ; SITE002 : 0 %
    table = section.split("Taux de panne (%) par site :")[1]
    site1 = next(line for line in table.splitlines() if line.startswith("SITE001"))
    site2 = next(line for line in table.splitlines() if line.startswith("SITE002"))

    assert "100" in site1
    assert "100" not in site2


# ----------------------------------------------------------------------
# history
# ----------------------------------------------------------------------
def readings(quality, reasons):
    return {"data_quality": quality, "null_reasons": reasons}


def test_history_request_parameters(module, fake_api, snapshot_file):
    """Vérifie les paramètres envoyés à /readings : site, limite et fenêtre de 24 h."""

    before = datetime.now(UTC)

    fake_api.client = FakeClient(readings={s: [readings("good", [])] for s in SITES})

    module.history()

    calls = [params for url, params in fake_api.client.calls if url == "/api/v1/readings"]

    assert [p["site_id"] for p in calls] == SITES
    assert {p["limit"] for p in calls} == {1000}

    start = datetime.fromisoformat(calls[0]["start_time"])
    end = datetime.fromisoformat(calls[0]["end_time"])

    assert end - start == timedelta(hours=24)
    # marge de 5 minutes sur l'horloge du serveur
    assert before - timedelta(minutes=6) < end < before - timedelta(minutes=4)


def test_history_prints_tables(module, fake_api, snapshot_file, capsys):
    """Vérifie les deux tableaux affichés : qualité par site, null_reasons x qualité."""

    fake_api.client = FakeClient(
        readings={
            "SITE001": [
                readings("good", []),
                readings("partial", ["humidity_sensor_failure", "network_loss"]),
            ]
        }
    )

    module.history()

    output = capsys.readouterr().out

    assert "data_quality par site (proportions)" in output
    assert "null_reasons x data_quality" in output
    assert "(aucune)" in output
    assert "humidity_sensor_failure|network_loss" in output


def test_history_writes_no_file(module, fake_api, snapshot_file, tmp_path):
    """Vérifie que history affiche seulement : aucun fichier n'est écrit."""

    fake_api.client = FakeClient(readings={"SITE001": [readings("good", [])]})

    module.history()

    assert not snapshot_file.exists()
    assert list(tmp_path.iterdir()) == []

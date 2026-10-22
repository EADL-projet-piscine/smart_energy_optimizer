"""
Corrélation data_quality (/sites/{id}/current) <-> /sensors/status (EnerVision)

Usage (depuis le dossier ml/) :
    python scripts/compare_data_quality_x_sensors.py                  # collecte 10 min + analyse
    python scripts/compare_data_quality_x_sensors.py --minutes 30     # collecte 30 min + analyse
    python scripts/compare_data_quality_x_sensors.py collect --minutes 30
    python scripts/compare_data_quality_x_sensors.py analyze          # ré-analyse le CSV existant
    python scripts/compare_data_quality_x_sensors.py history          # /readings seul (optionnel)

Les identifiants sont lus dans le .env du projet :
    ENERVISION_API_URL, ENERVISION_API_USERNAME, ENERVISION_API_PASSWORD
"""
import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd
from dotenv import load_dotenv

# --------------------------------------------------------------------------
# Config : recherche du .env en remontant depuis le dossier du script
# --------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
ML_DIR = SCRIPT_DIR.parent

for folder in [SCRIPT_DIR, *SCRIPT_DIR.parents]:
    env_file = folder / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        print(f"[config] .env chargé : {env_file}")
        break
else:
    print("[config] Aucun .env trouvé, utilisation des variables d'environnement.")

BASE_URL = os.getenv("ENERVISION_API_URL", "https://api-mock.charlieandre.fr").rstrip("/")
USERNAME = os.getenv("ENERVISION_API_USERNAME")
PASSWORD = os.getenv("ENERVISION_API_PASSWORD")
AUTH = httpx.BasicAuth(USERNAME, PASSWORD) if USERNAME and PASSWORD else None
if AUTH is None:
    print("[config] ATTENTION : ENERVISION_API_USERNAME / PASSWORD absents -> appels sans auth")

SITES = [f"SITE{i:03d}" for i in range(1, 8)]
OUT = ML_DIR / "data" / "raw"
OUT.mkdir(parents=True, exist_ok=True)
SNAP_FILE = OUT / "snapshots_quality_vs_status.csv"

REASON_TO_SENSOR = {
    "consumption_sensor_failure": "consumption",
    "electrical_sensor_failure": "electrical",
    "temperature_sensor_failure": "temperature",
    "humidity_sensor_failure": "humidity",
    "network_loss": "network",
}
SENSORS = ["consumption", "electrical", "temperature", "humidity", "network"]


def make_client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, auth=AUTH, timeout=30.0)


# --------------------------------------------------------------------------
# 1. COLLECTE : /current + /sensors/status au même instant
# --------------------------------------------------------------------------
def collect(minutes: int, interval: int):
    rows = []
    end_at = time.time() + minutes * 60
    print(f"Collecte pendant {minutes} min (toutes les {interval}s) sur {BASE_URL}")
    with make_client() as c:
        while time.time() < end_at:
            t0 = datetime.now(timezone.utc)
            r = c.get("/api/v1/sensors/status")
            r.raise_for_status()
            status = r.json()
            for site in SITES:
                r = c.get(f"/api/v1/sites/{site}/current")
                r.raise_for_status()
                cur = r.json()
                st = status.get(site, {})
                row = {
                    "polled_at": t0.isoformat(),
                    "site_id": site,
                    "data_quality": cur.get("data_quality"),
                    "null_reasons": "|".join(cur.get("null_reasons", [])),
                    "overall": st.get("overall"),
                }
                for s in SENSORS:
                    row[f"sensor_{s}"] = st.get("sensors", {}).get(s, {}).get("status")
                rows.append(row)
            print(f"[{t0:%H:%M:%S}] {len(rows)} lignes")
            pd.DataFrame(rows).to_csv(SNAP_FILE, index=False)
            time.sleep(interval)
    print(f"Écrit : {SNAP_FILE}")


# --------------------------------------------------------------------------
# 2. ANALYSE : concordance /current vs /sensors/status
# --------------------------------------------------------------------------
def analyze():
    if not SNAP_FILE.exists():
        sys.exit(f"Pas de données : lancez d'abord la collecte ({SNAP_FILE} introuvable)")
    df = pd.read_csv(SNAP_FILE).fillna("")
    print(f"\n{len(df)} observations\n")

    print("=== data_quality (/current) x overall (/sensors/status) ===")
    print(pd.crosstab(df["data_quality"], df["overall"], margins=True), "\n")

    norm = {"good": "ok", "partial": "degraded", "degraded": "degraded", "critical": "critical"}
    df["quality_norm"] = df["data_quality"].map(norm)
    agree = (df["quality_norm"] == df["overall"]).mean()
    print(f"Concordance globale (après normalisation) : {agree:.1%}\n")

    print("=== Valeurs de statut observées par capteur ===")
    for s in SENSORS:
        print(f"{s:12s}", df[f"sensor_{s}"].value_counts().to_dict())
    print()

    print("=== Par capteur : null_reasons (/current) vs statut (/sensors/status) ===")
    for s in SENSORS:
        reason_hit = df["null_reasons"].apply(
            lambda r: any(REASON_TO_SENSOR.get(x) == s for x in r.split("|") if x)
        )
        status_fail = ~df[f"sensor_{s}"].isin(["ok", ""])
        ct = pd.crosstab(
            reason_hit.rename("null_reason présent"),
            status_fail.rename("status en panne"),
        )
        print(f"-- {s}")
        print(ct, "\n")


# --------------------------------------------------------------------------
# 3. HISTORIQUE (optionnel) : /readings seul
# --------------------------------------------------------------------------
def history():
    end = datetime.now(timezone.utc) - timedelta(minutes=5)
    start = end - timedelta(hours=24)
    rows = []
    with make_client() as c:
        for site in SITES:
            r = c.get("/api/v1/readings", params={
                "site_id": site, "limit": 1000,
                "start_time": start.isoformat(), "end_time": end.isoformat(),
            })
            r.raise_for_status()
            for x in r.json():
                x["null_reasons"] = "|".join(x.get("null_reasons", []))
                rows.append(x)
    df = pd.DataFrame(rows)
    df.to_csv(OUT / "readings_24h.csv", index=False)

    print("=== data_quality par site ===")
    print(pd.crosstab(df["site_id"], df["data_quality"], normalize="index").round(3), "\n")
    print("=== null_reasons x data_quality ===")
    print(pd.crosstab(df["null_reasons"].replace("", "(aucune)"), df["data_quality"]))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--minutes", type=int, default=2)
    p.add_argument("--interval", type=int, default=5)
    sub = p.add_subparsers(dest="cmd")  # sous-commande OPTIONNELLE
    pc = sub.add_parser("collect")
    pc.add_argument("--minutes", type=int, default=2)
    pc.add_argument("--interval", type=int, default=5)
    sub.add_parser("analyze")
    sub.add_parser("history")
    a = p.parse_args()

    if a.cmd == "analyze":
        analyze()
    elif a.cmd == "history":
        history()
    elif a.cmd == "collect":
        collect(a.minutes, a.interval)
    else:  # aucune sous-commande : collecte + analyse
        collect(a.minutes, a.interval)
        analyze()
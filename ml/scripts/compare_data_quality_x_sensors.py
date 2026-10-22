"""
Corrélation data_quality (/sites/{id}/current) <-> /sensors/status (EnerVision)

Idée : on interroge les deux endpoints presque au même instant, puis on regarde
si l'état annoncé par /current (data_quality, null_reasons) est cohérent avec
l'état des capteurs annoncé par /sensors/status (overall, statut par capteur).

Usage (depuis le dossier ml/) :
    python scripts/compare_data_quality_x_sensors.py                 # collecte 2 min + analyse
    python scripts/compare_data_quality_x_sensors.py --minutes 10    # collecte plus longue + analyse
    python scripts/compare_data_quality_x_sensors.py analyze         # ré-analyse le CSV existant (sans appel API)
    python scripts/compare_data_quality_x_sensors.py history         # stats sur /readings (affichage seul)

Fichier produit (un seul, écrasé à chaque collecte) :
    ml/data/raw/snapshots_quality_vs_status.csv

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

# ==========================================================================
# CONFIGURATION
# ==========================================================================
SCRIPT_DIR = Path(__file__).resolve().parent
ML_DIR = SCRIPT_DIR.parent

# On remonte les dossiers parents jusqu'à trouver un fichier .env
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
    print("[config] ATTENTION : identifiants absents du .env -> appels sans authentification")

SITES = [f"SITE{i:03d}" for i in range(1, 8)]
SENSORS = ["consumption", "electrical", "temperature", "humidity", "network"]

# Fichier unique de sortie. Le dossier n'est créé que si on collecte vraiment.
SNAP_DIR = ML_DIR / "data" / "raw"
SNAP_FILE = SNAP_DIR / "snapshots_quality_vs_status.csv"

# Lien entre un null_reason de /current et le capteur correspondant dans /sensors/status
REASON_TO_SENSOR = {
    "consumption_sensor_failure": "consumption",
    "electrical_sensor_failure": "electrical",
    "temperature_sensor_failure": "temperature",
    "humidity_sensor_failure": "humidity",
    "network_loss": "network",
}

# /current et /sensors/status n'utilisent pas le même vocabulaire :
#   data_quality : good | partial | degraded | critical
#   overall      : ok   | degraded | critical
# On ramène data_quality au vocabulaire de overall pour pouvoir les comparer.
QUALITY_TO_OVERALL = {
    "good": "ok",
    "partial": "degraded",
    "degraded": "degraded",
    "critical": "critical",
}
QUALITY_ORDER = ["good", "partial", "degraded", "critical"]
OVERALL_ORDER = ["ok", "degraded", "critical"]


def make_client() -> httpx.Client:
    """Client HTTP avec l'authentification du .env."""
    return httpx.Client(base_url=BASE_URL, auth=AUTH, timeout=30.0)


def titre(texte: str) -> None:
    """Affiche un titre de section lisible dans le terminal."""
    print("\n" + "=" * 70)
    print(texte)
    print("=" * 70)


# ==========================================================================
# 1. COLLECTE : /sensors/status + /current relevés au même instant
# ==========================================================================
def collect(minutes: int, interval: int) -> None:
    rows = []
    end_at = time.time() + minutes * 60
    print(f"Collecte pendant {minutes} min (1 relevé toutes les {interval}s) sur {BASE_URL}")
    print("Ctrl+C pour arrêter plus tôt : les données déjà collectées sont conservées.\n")

    try:
        with make_client() as c:
            while time.time() < end_at:
                t0 = datetime.now(timezone.utc)

                # Un seul appel /sensors/status renvoie les 7 sites d'un coup :
                # tous les sites sont comparés à un état des capteurs du même instant.
                r = c.get("/api/v1/sensors/status")
                r.raise_for_status()
                status = r.json()

                # Puis /current pour chaque site, rapproché de son statut capteurs.
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

                print(f"[{t0:%H:%M:%S}] {len(rows)} observations collectées")
                time.sleep(interval)
    except KeyboardInterrupt:
        print("\nCollecte interrompue par l'utilisateur.")
    finally:
        # On écrit le fichier UNE seule fois, à la fin (ou à l'interruption).
        if rows:
            SNAP_DIR.mkdir(parents=True, exist_ok=True)
            pd.DataFrame(rows).to_csv(SNAP_FILE, index=False)
            print(f"\nÉcrit : {SNAP_FILE} ({len(rows)} lignes)")
        else:
            print("Aucune donnée collectée, aucun fichier écrit.")


# ==========================================================================
# 2. ANALYSE : /current vs /sensors/status
# ==========================================================================
def load_snapshots() -> pd.DataFrame:
    """Charge le CSV et prépare les colonnes utiles à l'analyse."""
    if not SNAP_FILE.exists():
        sys.exit(f"Pas de données : lancez d'abord la collecte ({SNAP_FILE} introuvable)")
    df = pd.read_csv(SNAP_FILE).fillna("")
    df["polled_at"] = pd.to_datetime(df["polled_at"])
    # data_quality ramené au vocabulaire de overall, puis test d'accord
    df["quality_norm"] = df["data_quality"].map(QUALITY_TO_OVERALL)
    df["agree"] = df["quality_norm"] == df["overall"]
    return df


def sensor_table(df: pd.DataFrame) -> pd.DataFrame:
    """
    Pour chaque capteur, croise 'panne signalée par /current' (null_reasons)
    et 'panne signalée par /sensors/status' (statut != ok) :

      les deux          : les deux endpoints signalent la panne      -> cohérent
      null_reason seul  : /current signale, le status dit ok         -> incohérent
      status seul       : le status signale, /current n'en parle pas -> incohérent
      aucun             : ni l'un ni l'autre                         -> cohérent
    """
    lignes = []
    for s in SENSORS:
        # Vrai si /current cite ce capteur dans null_reasons
        reason = df["null_reasons"].apply(
            lambda r: any(REASON_TO_SENSOR.get(x) == s for x in r.split("|") if x)
        )
        # Vrai si /sensors/status ne dit pas "ok" pour ce capteur
        failing = ~df[f"sensor_{s}"].isin(["ok", ""])

        both = int((reason & failing).sum())
        only_reason = int((reason & ~failing).sum())
        only_status = int((~reason & failing).sum())
        none = int((~reason & ~failing).sum())
        lignes.append({
            "capteur": s,
            "les deux": both,
            "null_reason seul": only_reason,
            "status seul": only_status,
            "aucun": none,
            "concordance": f"{(both + none) / max(len(df), 1):.0%}",
        })
    return pd.DataFrame(lignes).set_index("capteur")


def analyze() -> None:
    df = load_snapshots()
    n = len(df)
    print(f"\n{n} observations | {df['site_id'].nunique()} sites | "
          f"{df['polled_at'].nunique()} relevés | "
          f"{df['polled_at'].min():%H:%M:%S} -> {df['polled_at'].max():%H:%M:%S}")

    # ---- 2.1 Vue d'ensemble -------------------------------------------------
    titre("1. data_quality (/current) vs overall (/sensors/status)")
    print(f"Concordance globale : {df['agree'].mean():.1%} "
          f"({int(df['agree'].sum())} / {n})\n")

    effectifs = pd.crosstab(df["data_quality"], df["overall"]).reindex(
        index=QUALITY_ORDER, columns=OVERALL_ORDER, fill_value=0
    )
    print("Effectifs (lignes = data_quality, colonnes = overall) :")
    print(effectifs.to_string(), "\n")

    # En % par ligne : "quand data_quality vaut X, que vaut overall ?"
    pct = (effectifs.div(effectifs.sum(axis=1).replace(0, 1), axis=0) * 100).round(0).astype(int)
    print("En % par ligne (pour chaque data_quality, répartition de overall) :")
    print(pct.to_string())

    # ---- 2.2 Désaccords -----------------------------------------------------
    titre("2. Observations en désaccord")
    dis = df[~df["agree"]].sort_values("polled_at")
    if dis.empty:
        print("Aucun désaccord.")
    else:
        print(f"{len(dis)} désaccords sur {n} ({len(dis) / n:.1%}). "
              "S'ils sont isolés, c'est probablement un décalage de timing entre les 2 appels.\n")
        vue = dis[["polled_at", "site_id", "data_quality", "overall", "null_reasons"]].copy()
        vue["polled_at"] = vue["polled_at"].dt.strftime("%H:%M:%S")
        print(vue.to_string(index=False))

    # ---- 2.3 Capteur par capteur -------------------------------------------
    titre("3. Capteur par capteur : null_reasons (/current) vs statut (/sensors/status)")
    print(sensor_table(df).to_string())

    # ---- 2.4 Hypothèse network_loss ----------------------------------------
    titre("4. Test d'hypothèse : l'effet de la perte réseau (lignes critical exclues)")
    print("Hypothèse : en cas de perte réseau, /current ne cite que 'network_loss' alors que\n"
          "/sensors/status marque tous les capteurs en panne. Si c'est vrai, la colonne\n"
          "'status seul' doit presque disparaître une fois les lignes critical retirées.\n")
    sans_critical = df[df["data_quality"] != "critical"]
    print(f"{len(sans_critical)} observations sans critical :")
    print(sensor_table(sans_critical).to_string())
    print("\nnull_reasons observés sur les lignes critical :")
    print(df[df["data_quality"] == "critical"]["null_reasons"]
          .replace("", "(vide)").value_counts().to_string())

    # ---- 2.5 Taux de panne --------------------------------------------------
    titre("5. Taux de panne par capteur (d'après /sensors/status)")
    taux = pd.Series(
        {s: (~df[f"sensor_{s}"].isin(["ok", ""])).mean() * 100 for s in SENSORS}
    ).sort_values(ascending=False)
    for s, v in taux.items():
        print(f"  {s:12s} {v:5.1f} %")

    par_site = pd.DataFrame(
        {s: (~df[f"sensor_{s}"].isin(["ok", ""])).groupby(df["site_id"]).mean() * 100
         for s in SENSORS}
    ).round(0).astype(int)
    print("\nTaux de panne (%) par site :")
    print(par_site.to_string())


# ==========================================================================
# 3. HISTORIQUE (optionnel) : /readings seul, affichage uniquement
# ==========================================================================
def history() -> None:
    """Statistiques sur /readings des dernières 24 h. Aucun fichier écrit."""
    end = datetime.now(timezone.utc) - timedelta(minutes=5)  # marge sur l'horloge serveur
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

    titre("data_quality par site (proportions)")
    print(pd.crosstab(df["site_id"], df["data_quality"], normalize="index").round(2).to_string())
    titre("null_reasons x data_quality")
    print(pd.crosstab(df["null_reasons"].replace("", "(aucune)"), df["data_quality"]).to_string())


# ==========================================================================
# POINT D'ENTRÉE
# ==========================================================================
if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--minutes", type=int, default=2, help="durée de collecte (défaut 2)")
    p.add_argument("--interval", type=int, default=5, help="secondes entre 2 relevés (défaut 5)")
    sub = p.add_subparsers(dest="cmd")  # sous-commande OPTIONNELLE
    sub.add_parser("analyze", help="analyse le CSV existant")
    sub.add_parser("history", help="stats sur /readings (affichage seul)")
    a = p.parse_args()

    if a.cmd == "analyze":
        analyze()
    elif a.cmd == "history":
        history()
    else:  # aucune sous-commande : collecte puis analyse
        collect(a.minutes, a.interval)
        analyze()
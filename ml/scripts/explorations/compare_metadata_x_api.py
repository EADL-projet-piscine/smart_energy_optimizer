"""
Comparaison metadatas (dossier data/) <-> API EnerVision

Deux niveaux de comparaison :
  1. SCHÉMA  : les colonnes / champs correspondent-ils (noms, types, valeurs nulles) ?
  2. DONNÉES : les valeurs correspondent-elles (sites, valeurs catégorielles, plages) ?

Cas particulier géré : fichiers d'ÉVÉNEMENTS (colonnes timestamp / type / severity /
description, un fichier par site). Ils sont fusionnés, comparés à /alerts, puis on teste
si les événements sont visibles dans les mesures de /readings (ex : un 'spike' correspond-il
à un pic de consommation ?).

Usage (depuis le dossier ml/) :
    python scripts/compare_metadata_x_api.py inspect          # décrit les metadatas (sans appel API)
    python scripts/compare_metadata_x_api.py                  # comparaison complète
    python scripts/compare_metadata_x_api.py --sample 15      # 15 événements testés par type (défaut 8)
    python scripts/compare_metadata_x_api.py --sample 0       # pas de test sur /readings
    python scripts/compare_metadata_x_api.py --dir ../data --file SITE001

Aucun fichier n'est écrit : tout s'affiche dans le terminal.
Les identifiants API sont lus dans le .env du projet.
"""

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import UTC, datetime, timedelta
from difflib import get_close_matches
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

BASE_URL = os.getenv("ENERVISION_API_URL", "https://api-mock.charlieandre.fr").rstrip("/")
USERNAME = os.getenv("ENERVISION_API_USERNAME")
PASSWORD = os.getenv("ENERVISION_API_PASSWORD")
AUTH = httpx.BasicAuth(USERNAME, PASSWORD) if USERNAME and PASSWORD else None

# Extensions de fichiers de metadatas prises en charge
EXTENSIONS = {".csv", ".tsv", ".json", ".yaml", ".yml", ".parquet"}

# Champs de /alerts (d'après la doc). Sert de schéma si l'API ne renvoie aucune alerte.
ALERT_COLUMNS = [
    "alert_id",
    "timestamp",
    "site_id",
    "severity",
    "type",
    "message",
    "value",
    "threshold",
]

# Noms de colonnes "alternatifs" que l'on sait rattacher à un champ de l'API.
# Clé = nom normalisé (minuscules, sans espaces ni ponctuation), valeur = champ API.
# >>> Complétez ce dictionnaire si vos metadatas utilisent d'autres noms. <<<
# Attention : 'type' n'est volontairement PAS ici (trop ambigu : type de site ou d'événement ?).
ALIASES = {
    "id": "site_id",
    "siteid": "site_id",
    "idsite": "site_id",
    "codesite": "site_id",
    "name": "site_name",
    "nom": "site_name",
    "nomsite": "site_name",
    "nomdusite": "site_name",
    "sitename": "site_name",
    "typesite": "site_type",
    "sitetype": "site_type",
    "capacity": "capacity_kw",
    "capacite": "capacity_kw",
    "capacitekw": "capacity_kw",
    "puissancemax": "capacity_kw",
    "puissancekw": "capacity_kw",
    "localisation": "location",
    "ville": "location",
    "lieu": "location",
    "statut": "status",
    "etat": "status",
    "date": "timestamp",
    "datetime": "timestamp",
    "horodatage": "timestamp",
    "qualite": "data_quality",
    "dataquality": "data_quality",
    "description": "message",
    "gravite": "severity",
}

pd.set_option("display.width", 220)
pd.set_option("display.max_columns", 30)
pd.set_option("display.max_colwidth", 60)


def titre(texte: str) -> None:
    """Affiche un titre de section lisible dans le terminal."""
    print("\n" + "=" * 78)
    print(texte)
    print("=" * 78)


# ==========================================================================
# 1. LECTURE DES METADATAS (formats variés -> DataFrame)
# ==========================================================================
def find_files(data_dir: Path, name_filter: str | None) -> list[Path]:
    """Liste les fichiers de metadatas du dossier (en ignorant les données collectées)."""
    files = []
    for p in sorted(data_dir.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in EXTENSIONS:
            continue
        rel = p.relative_to(data_dir)
        # data/raw = données collectées depuis l'API, ce ne sont pas des metadatas
        if "raw" in rel.parts:
            continue
        if name_filter and name_filter.lower() not in p.name.lower():
            continue
        files.append(p)
    return files


def json_to_df(data) -> pd.DataFrame:
    """Transforme un contenu JSON/YAML en tableau, quelle que soit sa forme."""
    if isinstance(data, list):
        return pd.json_normalize(data)
    if isinstance(data, dict):
        # Forme {"SITE001": {...}, "SITE002": {...}} : la clé devient une colonne
        if data and all(isinstance(v, dict) for v in data.values()):
            rows = [{"_key": k, **v} for k, v in data.items()]
            df = pd.json_normalize(rows)
            if df["_key"].astype(str).str.match(r"^SITE\d+$").all():
                df = df.rename(columns={"_key": "site_id"})
            return df
        # Forme {"sites": [ {...}, {...} ]} : on prend la première liste d'objets
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return pd.json_normalize(v)
        return pd.json_normalize([data])
    raise ValueError("structure JSON non reconnue")


def load_table(path: Path) -> pd.DataFrame:
    """Lit un fichier de metadatas et renvoie un DataFrame."""
    ext = path.suffix.lower()
    if ext in (".csv", ".tsv"):
        # sep=None : détecte automatiquement , ou ; ou tabulation
        return pd.read_csv(path, sep=None, engine="python")
    if ext == ".json":
        return json_to_df(json.loads(path.read_text(encoding="utf-8")))
    if ext in (".yaml", ".yml"):
        import yaml  # pip install pyyaml

        return json_to_df(yaml.safe_load(path.read_text(encoding="utf-8")))
    if ext == ".parquet":
        return pd.read_parquet(path)  # nécessite pyarrow
    raise ValueError(f"extension non gérée : {ext}")


# ==========================================================================
# 2. OUTILS DE COMPARAISON
# ==========================================================================
def strip_accents(x) -> str:
    """Texte comparable : sans accents, sans majuscules, sans espaces autour."""
    t = unicodedata.normalize("NFKD", str(x))
    return "".join(c for c in t if not unicodedata.combining(c)).casefold().strip()


def norm(name: str) -> str:
    """Nom de colonne normalisé : 'Site_ID' et 'siteid' deviennent identiques."""
    return re.sub(r"[^a-z0-9]", "", strip_accents(name))


def kind(s: pd.Series) -> str:
    """Famille de type d'une colonne : nombre / date / booléen / texte / vide."""
    s = s.dropna()
    if s.empty:
        return "vide"
    if pd.api.types.is_bool_dtype(s):
        return "booléen"
    if pd.api.types.is_numeric_dtype(s):
        return "nombre"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "date"
    sample = s.astype(str).head(50)
    if sample.str.match(r"^\d{4}-\d{2}-\d{2}").all():
        return "date"
    return "texte"


def same(a, b) -> bool:
    """Deux valeurs sont-elles égales (tolérance sur les nombres, insensible à la casse) ?"""
    if pd.isna(a) and pd.isna(b):
        return True
    if pd.isna(a) or pd.isna(b):
        return False
    try:
        fa, fb = float(a), float(b)
        return abs(fa - fb) <= max(1e-6, 1e-4 * abs(fb))
    except (TypeError, ValueError):
        return strip_accents(a) == strip_accents(b)


def map_columns(meta_cols, api_cols):
    """
    Associe chaque colonne des metadatas à un champ de l'API.
    Retourne (correspondances {col_meta: champ_api}, colonnes non associées).
    """
    api_norm = {norm(c): c for c in api_cols}
    mapping, unmatched = {}, []
    for mc in meta_cols:
        n = norm(mc)
        if n in api_norm:  # même nom (à la casse/ponctuation près)
            mapping[mc] = api_norm[n]
        elif ALIASES.get(n) in api_cols:  # nom alternatif connu
            mapping[mc] = ALIASES[n]
        else:
            unmatched.append(mc)
    return mapping, unmatched


def pick_resource(meta, resources: dict):
    """
    Décide quelle ressource de l'API le fichier décrit (sites / alerts / readings),
    d'après le nombre de colonnes en commun. En cas d'égalité, l'ordre du dictionnaire prime.
    """
    meilleur, best_n = None, -1
    for name, api in resources.items():
        mapping, _ = map_columns(meta.columns, api.columns)
        if len(mapping) > best_n:
            meilleur, best_n = name, len(mapping)
    return meilleur


def parse_duration_h(desc) -> float | None:
    """Durée en heures lue dans une description : 'Coupure électrique (5h)' -> 5.0, '(30min)' -> 0.5."""
    s = str(desc)
    m = re.search(r"\((\d+(?:[.,]\d+)?)\s*h", s)
    if m:
        return float(m.group(1).replace(",", "."))
    m = re.search(r"\((\d+(?:[.,]\d+)?)\s*min", s)
    if m:
        return float(m.group(1).replace(",", ".")) / 60
    return None


# ==========================================================================
# 3. LECTURE DE L'API (en mémoire uniquement)
# ==========================================================================
def fetch_api_sites(c: httpx.Client) -> pd.DataFrame:
    r = c.get("/api/v1/sites")
    r.raise_for_status()
    return pd.DataFrame(r.json())


def fetch_api_readings(c: httpx.Client, site_ids, hours: int) -> pd.DataFrame:
    """Historique /readings des dernières heures pour chaque site."""
    end = datetime.now(UTC) - timedelta(minutes=5)  # marge sur l'horloge serveur
    start = end - timedelta(hours=hours)
    rows = []
    for sid in site_ids:
        r = c.get(
            "/api/v1/readings",
            params={
                "site_id": sid,
                "limit": 1000,
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
            },
        )
        r.raise_for_status()
        for x in r.json():
            x["null_reasons"] = "|".join(x.get("null_reasons", []))  # liste -> texte
            rows.append(x)
    return pd.DataFrame(rows)


def fetch_api_alerts(c: httpx.Client) -> pd.DataFrame:
    """Alertes actives. Si l'API n'en renvoie aucune, on garde au moins les noms de colonnes."""
    r = c.get("/api/v1/alerts")
    r.raise_for_status()
    df = pd.DataFrame(r.json())
    return df if not df.empty else pd.DataFrame(columns=ALERT_COLUMNS)


# ==========================================================================
# 4. COMMANDE inspect : décrire les metadatas
# ==========================================================================
def describe(df: pd.DataFrame) -> pd.DataFrame:
    """Une ligne par colonne : type, % de nuls, nombre de valeurs distinctes, exemple."""
    return pd.DataFrame(
        {
            "type": [kind(df[c]) for c in df.columns],
            "% null": [round(df[c].isna().mean() * 100, 1) for c in df.columns],
            "distinct": [df[c].nunique() for c in df.columns],
            "exemple": [df[c].dropna().iloc[0] if df[c].notna().any() else "" for c in df.columns],
        },
        index=df.columns,
    )


def inspect_files(files: list[Path]) -> None:
    for path in files:
        titre(f"FICHIER : {path.name}")
        try:
            df = load_table(path)
        except Exception as e:  # noqa: BLE001 # fichier illisible : on continue avec les autres
            print(f"Lecture impossible : {e}")
            continue
        print(f"{len(df)} lignes x {len(df.columns)} colonnes\n")
        print(describe(df).to_string())

        # Pour les colonnes de dates : période couverte (utile pour savoir si on peut
        # la comparer à l'API) + valeurs des colonnes catégorielles
        for c in df.columns:
            if kind(df[c]) == "date":
                t = pd.to_datetime(df[c], errors="coerce")
                print(f"\nPériode '{c}' : {t.min()} -> {t.max()}")
            elif kind(df[c]) == "texte" and df[c].nunique() <= 10:
                print(f"Valeurs de '{c}' : {df[c].value_counts().to_dict()}")


# ==========================================================================
# 5. COMPARAISON DE SCHÉMA
# ==========================================================================
def compare_schema(meta, api, mapping, unmatched, api_name):
    print(f"\n--- SCHÉMA : metadatas vs API /{api_name} ---")
    if not mapping:
        print("Aucune colonne en commun avec cette ressource de l'API.")
        return

    lignes = []
    for mc, ac in mapping.items():
        km, ka = kind(meta[mc]), kind(api[ac])
        lignes.append(
            {
                "colonne metadata": mc,
                "champ API": ac,
                "type metadata": km,
                "type API": ka,
                "types compatibles": "oui" if km == ka or "vide" in (km, ka) else "NON",
                "% null meta": round(meta[mc].isna().mean() * 100, 1),
                "% null API": round(api[ac].isna().mean() * 100, 1) if len(api) else "n/a",
            }
        )
    print("\nColonnes en correspondance :")
    print(pd.DataFrame(lignes).to_string(index=False))

    if unmatched:
        api_norm = {norm(c): c for c in api.columns}
        print("\nColonnes SEULEMENT dans les metadatas (avec rapprochement possible) :")
        for mc in unmatched:
            proche = get_close_matches(norm(mc), list(api_norm), n=1, cutoff=0.6)
            piste = f"  -> ressemble à '{api_norm[proche[0]]}' ?" if proche else ""
            print(f"  - {mc}{piste}")
    manquants = [c for c in api.columns if c not in mapping.values()]
    if manquants:
        print("\nChamps SEULEMENT dans l'API :")
        print("  " + ", ".join(manquants))


# ==========================================================================
# 6. COMPARAISON DES DONNÉES (génériques)
# ==========================================================================
def compare_sites_data(meta, mapping, sites, readings):
    print("\n--- DONNÉES : metadatas vs API /sites ---")
    if "site_id" not in mapping.values():
        print("Pas de colonne identifiant (site_id) dans les metadatas : jointure impossible.")
        return

    # On renomme les colonnes des metadatas avec les noms de l'API pour pouvoir les joindre
    m = meta[list(mapping.keys())].rename(columns=mapping).copy()
    m = m.loc[:, ~m.columns.duplicated()]
    m["site_id"] = m["site_id"].astype(str).str.strip().str.upper()
    a = sites.copy()
    a["site_id"] = a["site_id"].astype(str).str.strip().str.upper()

    # Sites présents d'un seul côté
    ids_m, ids_a = set(m["site_id"]), set(a["site_id"])
    print(
        f"Sites : {len(ids_m)} dans les metadatas, {len(ids_a)} dans l'API, {len(ids_m & ids_a)} en commun"
    )
    if ids_m - ids_a:
        print(f"  Seulement dans les metadatas : {sorted(ids_m - ids_a)}")
    if ids_a - ids_m:
        print(f"  Seulement dans l'API         : {sorted(ids_a - ids_m)}")

    # Comparaison valeur par valeur sur les sites communs
    j = m.merge(a, on="site_id", suffixes=("_meta", "_api"))
    cols = [c for c in m.columns if c != "site_id" and c in a.columns]
    resume = []
    for c in cols:
        diff = j[~j.apply(lambda r, c=c: same(r[f"{c}_meta"], r[f"{c}_api"]), axis=1)]
        resume.append({"champ": c, "sites comparés": len(j), "valeurs différentes": len(diff)})
        if len(diff):
            print(f"\nDifférences sur '{c}' :")
            print(diff[["site_id", f"{c}_meta", f"{c}_api"]].head(15).to_string(index=False))
    if resume:
        print("\nRésumé :")
        print(pd.DataFrame(resume).to_string(index=False))

    # Cohérence capacité (metadatas) <-> consommation réelle (API)
    if "capacity_kw" in m.columns and not readings.empty:
        cap = m.set_index("site_id")["capacity_kw"]
        pic = readings.groupby("site_id")["consumption_kw"].max()
        t = pd.DataFrame({"capacité metadata (kW)": cap, "pic conso API (kW)": pic}).dropna()
        if not t.empty:
            t["pic / capacité"] = (t["pic conso API (kW)"] / t["capacité metadata (kW)"]).map(
                "{:.0%}".format
            )
            t["dépassement"] = t["pic conso API (kW)"] > t["capacité metadata (kW)"]
            print("\nCohérence capacité (metadatas) vs pic de consommation observé (API) :")
            print(t.round(1).to_string())


def compare_values(meta, mapping, api, api_name):
    """Valeurs catégorielles (mêmes valeurs possibles ?) et plages numériques, pour /readings ou /alerts."""
    print(f"\n--- DONNÉES : metadatas vs API /{api_name} ---")
    if api.empty:
        print(
            f"(l'API ne renvoie actuellement aucune donnée pour /{api_name} : comparaison impossible)"
        )
        return
    m = meta[list(mapping.keys())].rename(columns=mapping)
    m = m.loc[:, ~m.columns.duplicated()]

    # Colonnes catégorielles : mêmes valeurs possibles des deux côtés ?
    for c in m.columns:
        if c == "message":  # texte libre : comparer ses valeurs n'aurait pas de sens
            continue
        if m[c].nunique() <= 20 and kind(m[c]) in ("texte", "booléen"):
            vm, va = set(m[c].dropna().astype(str)), set(api[c].dropna().astype(str))
            etat = "identiques" if vm == va else "DIFFÉRENTES"
            print(f"\n'{c}' : valeurs {etat}")
            print(f"  metadatas : {sorted(vm)}")
            print(f"  API       : {sorted(va)}")

    # Colonnes numériques : plages comparées
    lignes = []
    for c in m.columns:
        if kind(m[c]) == "nombre" and kind(api[c]) == "nombre":
            lignes.append(
                {
                    "champ": c,
                    "min meta": m[c].min(),
                    "max meta": m[c].max(),
                    "min API": api[c].min(),
                    "max API": api[c].max(),
                }
            )
    if lignes:
        print("\nPlages numériques :")
        print(pd.DataFrame(lignes).round(2).to_string(index=False))


# ==========================================================================
# 7. ÉVÉNEMENTS : metadatas (timestamp / type / severity) <-> alerts + readings
# ==========================================================================
def is_events_table(df: pd.DataFrame) -> bool:
    """Vrai si le fichier ressemble à une liste d'événements (timestamp + type + severity)."""
    mapped = set(map_columns(df.columns, ALERT_COLUMNS)[0].values())
    return {"timestamp", "type", "severity"} <= mapped


def add_site_id_from_filename(df: pd.DataFrame, path: Path) -> pd.DataFrame:
    """Les fichiers d'événements n'ont pas de colonne site_id : on la déduit du nom ('SITE001_...')."""
    if "site_id" not in [norm(c) for c in df.columns] and "siteid" not in [
        norm(c) for c in df.columns
    ]:
        m = re.search(r"SITE\d+", path.name, re.IGNORECASE)
        if m:
            df = df.copy()
            df["site_id"] = m.group(0).upper()
    return df


def probe_event(c: httpx.Client, row) -> dict:
    """
    Interroge /readings autour d'un événement et compare 'pendant' à 'avant'.
    Fenêtre : [ts - durée ; ts + durée]. 'avant' = moitié gauche, 'pendant' = moitié droite.
    """
    dur = row["dur_h"] if pd.notna(row["dur_h"]) else 1.0
    dur = min(max(dur, 0.5), 24.0)  # bornes : 30 min à 24 h
    ts = row["ts"]
    debut, fin = ts - pd.Timedelta(hours=dur), ts + pd.Timedelta(hours=dur)
    try:
        r = c.get(
            "/api/v1/readings",
            params={
                "site_id": row["site_id"],
                "limit": 1000,
                "start_time": debut.isoformat(),
                "end_time": fin.isoformat(),
            },
        )
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPError:
        return {"statut": "erreur API"}
    if not data:
        return {"statut": "aucune mesure"}

    rr = pd.DataFrame(data)
    # Horodatages ramenés à des dates sans fuseau pour pouvoir les comparer à l'événement
    rr["ts"] = pd.to_datetime(rr["timestamp"], utc=True).dt.tz_localize(None)
    avant = rr[rr["ts"] < ts]
    pendant = rr[(rr["ts"] >= ts) & (rr["ts"] <= ts + pd.Timedelta(hours=dur))]
    if avant.empty or pendant.empty:
        return {"statut": "mesures partielles"}

    conso_avant = avant["consumption_kw"].mean()
    conso_pendant = pendant["consumption_kw"].mean()
    ratio = conso_pendant / conso_avant if pd.notna(conso_avant) and conso_avant else float("nan")
    return {
        "statut": "ok",
        "ratio": ratio,  # >1 : conso plus haute pendant
        "null_pendant": pendant["consumption_kw"].isna().mean(),  # part de valeurs manquantes
        "nongood_avant": (avant["data_quality"] != "good").mean(),
        "nongood_pendant": (pendant["data_quality"] != "good").mean(),
    }


def compare_events(events, resources, c, sample):
    titre(
        f"ÉVÉNEMENTS ({len(events)} lignes, {events['site_id'].nunique() if 'site_id' in events else '?'} sites)"
    )
    alerts = resources["alerts"]

    # ---- 7.1 Schéma et valeurs vs /alerts ----------------------------------
    mapping, unmatched = map_columns(events.columns, alerts.columns)
    compare_schema(events, alerts, mapping, unmatched, "alerts")
    compare_values(events, mapping, alerts, "alerts")

    # ---- 7.2 Vue d'ensemble des événements ---------------------------------
    ev = events.copy()
    ev["ts"] = pd.to_datetime(ev["timestamp"], errors="coerce")
    ev["dur_h"] = (
        ev["description"].map(parse_duration_h) if "description" in ev.columns else float("nan")
    )

    print("\n--- Vue d'ensemble des événements ---")
    print(f"Période : {ev['ts'].min()} -> {ev['ts'].max()}")
    if "site_id" in ev.columns:
        print("\nÉvénements par site :")
        print(ev["site_id"].value_counts().sort_index().to_string())
    print("\nType x gravité :")
    print(pd.crosstab(ev["type"], ev["severity"], margins=True).to_string())
    d = ev.groupby("type")["dur_h"].agg(["count", "median", "max"]).round(1)
    d.columns = ["durées lues", "durée médiane (h)", "durée max (h)"]
    print("\nDurées lues dans 'description' :")
    print(d.to_string())

    # ---- 7.3 Les événements sont-ils visibles dans /readings ? -------------
    if sample <= 0 or "site_id" not in ev.columns:
        return
    print(f"\n--- Test sur /readings : {sample} événements tirés au hasard par type ---")
    print("Pour chaque événement : consommation 'pendant' vs 'avant', valeurs manquantes, qualité.")
    res = []
    for t, g in ev.dropna(subset=["ts"]).groupby("type"):
        for _, row in g.sample(min(len(g), sample), random_state=0).iterrows():
            out = probe_event(c, row)
            out["type"] = t
            res.append(out)
    res = pd.DataFrame(res)

    print("\nDisponibilité des mesures pour la période des événements :")
    print(pd.crosstab(res["type"], res["statut"]).to_string())

    ok = res[res["statut"] == "ok"]
    if ok.empty:
        print(
            "\nL'API ne renvoie pas de mesures exploitables pour les dates des événements "
            "(voir le tableau ci-dessus) : on ne peut pas faire correspondre les données."
        )
        return
    synth = (
        ok.groupby("type")
        .agg(
            n=("ratio", "size"),
            ratio_conso_median=("ratio", "median"),
            null_pendant=("null_pendant", "mean"),
            nongood_avant=("nongood_avant", "mean"),
            nongood_pendant=("nongood_pendant", "mean"),
        )
        .round(2)
    )
    print("\nSynthèse par type (sur les événements avec mesures) :")
    print(synth.to_string())
    print(
        "\nLecture : si les événements étaient reflétés par l'API, on attendrait\n"
        "  spike   -> ratio_conso_median nettement > 1\n"
        "  drop    -> ratio < 1\n"
        "  outage  -> null_pendant et nongood_pendant en hausse\n"
        "  plateau -> ratio proche de 1\n"
        "Des ratios proches de 1 partout indiquent que l'API ne rejoue pas ces événements."
    )


# ==========================================================================
# 8. COMPARAISON COMPLÈTE
# ==========================================================================
def compare(files: list[Path], hours: int, sample: int) -> None:
    try:
        with httpx.Client(base_url=BASE_URL, auth=AUTH, timeout=30.0) as c:
            # Lecture de l'API (une seule fois pour tous les fichiers)
            sites = fetch_api_sites(c)
            readings = fetch_api_readings(c, sites["site_id"], hours)
            alerts = fetch_api_alerts(c)
            resources = {"sites": sites, "alerts": alerts, "readings": readings}
            print(
                f"[API] {len(sites)} sites, {len(readings)} mesures sur {hours} h, {len(alerts)} alertes actives"
            )
            if len(readings) and len(readings) % 1000 == 0:
                print(
                    "[API] NB : nombre de mesures = multiple de 1000 -> l'historique est peut-être "
                    "tronqué par 'limit'."
                )

            events_frames = []
            for path in files:
                try:
                    meta = load_table(path)
                except Exception as e:  # noqa: BLE001
                    titre(f"FICHIER : {path.name}")
                    print(f"Lecture impossible : {e}")
                    continue

                # Fichiers d'événements : fusionnés et traités ensemble plus bas
                if is_events_table(meta):
                    events_frames.append(add_site_id_from_filename(meta, path))
                    continue

                # Autres fichiers : comparaison générique
                titre(f"FICHIER : {path.name}")
                print(f"{len(meta)} lignes x {len(meta.columns)} colonnes")
                resource = pick_resource(meta, resources)
                api = resources[resource]
                mapping, unmatched = map_columns(meta.columns, api.columns)
                print(f"Ressource API la plus proche : /{resource}")
                compare_schema(meta, api, mapping, unmatched, resource)
                if resource == "sites":
                    compare_sites_data(meta, mapping, sites, readings)
                elif mapping:
                    compare_values(meta, mapping, api, resource)

            if events_frames:
                print(f"\n[événements] {len(events_frames)} fichier(s) d'événements fusionnés")
                compare_events(pd.concat(events_frames, ignore_index=True), resources, c, sample)
    except httpx.HTTPError as e:
        sys.exit(f"Erreur d'appel à l'API ({BASE_URL}) : {e}")


# ==========================================================================
# POINT D'ENTRÉE
# ==========================================================================
if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--dir", help="dossier des metadatas (défaut : ml/data puis ../data)")
    p.add_argument("--file", help="ne traiter que les fichiers dont le nom contient ce texte")
    p.add_argument(
        "--hours", type=int, default=24, help="historique /readings à comparer (défaut 24)"
    )
    p.add_argument(
        "--sample",
        type=int,
        default=8,
        help="événements testés par type sur /readings (défaut 8, 0 = désactivé)",
    )
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("inspect", help="décrit les metadatas sans appeler l'API")
    sub.add_parser("compare", help="comparaison complète (défaut)")
    a = p.parse_args()

    # Dossier des metadatas
    candidats = [Path(a.dir)] if a.dir else [ML_DIR / "data", ML_DIR.parent / "data"]
    data_dir = next((d for d in candidats if d.is_dir()), None)
    if data_dir is None:
        sys.exit(
            f"Dossier de metadatas introuvable. Essayé : {[str(d) for d in candidats]}\n"
            "Utilisez --dir pour l'indiquer."
        )
    files = find_files(data_dir, a.file)
    print(f"[metadatas] dossier : {data_dir.resolve()}")
    print(f"[metadatas] {len(files)} fichier(s) : {[f.name for f in files]}  (dossier raw/ ignoré)")
    if not files:
        sys.exit("Aucun fichier de metadatas trouvé (csv, json, yaml, parquet).")

    if a.cmd == "inspect":
        inspect_files(files)
    else:
        compare(files, a.hours, a.sample)

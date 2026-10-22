"""Reconnaissance de /api/v1/readings : que fait réellement le paramètre limit ?

À lancer depuis app/back, avec le .env du projet :
    python ../../ml/scripts/probe_readings.py
ou depuis n'importe où si les variables d'environnement sont déjà chargées.
"""

import os
from collections import Counter
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "app" / "back" / ".env", override=True)

BASE = os.environ.get("ENERVISION_API_URL", "https://api-mock.charlieandre.fr")
AUTH = (os.environ["ENERVISION_USER"], os.environ["ENERVISION_PASSWORD"])

end = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=5)
start = end - timedelta(hours=24)
params_communs = {
    "start_time": start.isoformat(timespec="seconds"),
    "end_time": end.isoformat(timespec="seconds"),
}


def interroger(limit: int, site_id: str | None = None) -> list[dict]:
    params = dict(params_communs, limit=limit)
    if site_id:
        params["site_id"] = site_id
    reponse = httpx.get(f"{BASE}/api/v1/readings", params=params, auth=AUTH, timeout=30)
    if reponse.status_code != 200:
        print(f"   {reponse.status_code} : {reponse.text[:300]}")
    reponse.raise_for_status()
    return reponse.json()


def decrire(titre: str, points: list[dict]) -> None:
    par_site = Counter(point["site_id"] for point in points)
    horodatages = sorted({point["timestamp"] for point in points})
    pas = "—"
    if len(horodatages) > 1:
        ecarts = [
            (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() / 60
            for a, b in pairwise(horodatages)
        ]
        pas = f"{min(ecarts):.0f}–{max(ecarts):.0f} min"

    print(f"\n── {titre}")
    print(f"   {len(points)} points, {len(par_site)} sites")
    print(f"   par site : {dict(sorted(par_site.items()))}")
    print(f"   pas entre horodatages : {pas}")
    print(f"   premier horodatage : {horodatages[0] if horodatages else '—'}")
    print(f"   dernier horodatage  : {horodatages[-1] if horodatages else '—'}")
    if points:
        exemple = points[0]
        print(
            f"   fuseau déclaré : {'oui' if exemple['timestamp'][-6:].startswith(('+', '-')) or exemple['timestamp'].endswith('Z') else 'NON — horodatage naïf'}"
        )
        print(f"   kw == kwh : {exemple['consumption_kw'] == exemple['consumption_kwh']}")
        print(f"   data_quality vues : {sorted({p['data_quality'] for p in points})}")
        nuls = sum(1 for p in points if p["consumption_kw"] is None)
        print(f"   valeurs nulles : {nuls}/{len(points)}")


for limit in (100, 168, 500, 1000):
    decrire(f"limit={limit}, tous les sites", interroger(limit))

decrire("limit=24, SITE001 seul", interroger(24, "SITE001"))

print("\n── reproductibilité : deux appels identiques")
a = interroger(168)
b = interroger(168)
identiques = [x["consumption_kw"] for x in a] == [y["consumption_kw"] for y in b]
print(f"   mêmes valeurs d'un appel à l'autre : {identiques}")

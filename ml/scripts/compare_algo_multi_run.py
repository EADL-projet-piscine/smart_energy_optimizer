"""
Comparatif Random Forest vs XGBoost, répété N fois — EnerVision.

Pourquoi relancer plusieurs fois ?
  Un seul lancement donne UN chiffre (ex : écart de 0,26 kWh). On ne sait pas
  si cet écart est solide ou dû au hasard. En relançant N fois avec une graine
  différente à chaque fois (bruit des données + hasard des modèles), on voit
  si le résultat est STABLE : c'est ce qui le rend citable dans le dossier.

Rappel de la limite (identique au script initial) : la série de consommation
est SYNTHÉTIQUE (reconstruite depuis les profils des sites, avec hypothèses).
Les écarts relatifs entre algorithmes sont informatifs, pas les valeurs
absolues. À refaire sur les vraies données (/api/v1/readings).

Installation (sans pandas) :
    python -m pip install xgboost

Prérequis : data/SITE00X_metadata.json

Pour Exécuter depuis le dossier ml : 
    python .\scripts\compare_algo_multi_run.py 

Sorties : comparatif_multi_runs.csv, graphiques_multi_runs/*.png
"""

import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

from xgboost import XGBRegressor
    


# ----------------------------------------------------------------------
# PARAMÈTRES
# ----------------------------------------------------------------------
N_RUNS = 20            # nombre de lancements
SEED_DEPART = 1        # run i utilise la graine SEED_DEPART + i
DATA_DIR = Path("data")
OUT_DIR = Path("graphiques_multi_runs")
OUT_DIR.mkdir(exist_ok=True)

NOM_RF = "Random Forest"
NOM_BOOST = "XGBoost"
COULEURS = {NOM_RF: "#2a6fb0", NOM_BOOST: "#d9822b"}
MARQUEURS = {NOM_RF: "o", NOM_BOOST: "s"}  # forme différente : pas que la couleur
ENCRE, ENCRE_2 = "#1f2328", "#59636e"


# ----------------------------------------------------------------------
# DONNÉES : partie déterministe calculée UNE fois, bruit tiré à chaque run
# ----------------------------------------------------------------------
def serie_propre_site(profil, start, end):
    """Consommation 'propre' (sans bruit) heure par heure + écart-type du bruit.
    Mêmes formules et mêmes HYPOTHÈSES que le script initial
    (activité hors horaires = 0.3 ; saisonnalité en cosinus, pic en hiver)."""
    base, pic = profil["base_consumption"], profil["peak_consumption"]
    h_debut, h_fin = profil["working_hours"]
    jours_actifs = set(profil["working_days"])
    var_saison = profil["seasonal_variation"]
    f_weekend = profil.get("weekend_factor", 1.0)

    lignes, propre = [], []
    t = start
    while t < end:
        actif = (h_debut <= t.hour < h_fin) and (t.weekday() in jours_actifs)
        activite = 1.0 if actif else 0.3                      # HYPOTHÈSE
        if t.weekday() >= 5 and f_weekend != 1.0:
            activite *= f_weekend
        saison = 1 + var_saison * np.cos(2 * np.pi * t.timetuple().tm_yday / 365)  # HYPOTHÈSE
        propre.append(base + (pic - base) * activite * saison)
        lignes.append((t, t.hour, t.weekday(), t.month, int(t.weekday() >= 5), base, pic))
        t += timedelta(hours=1)
    sigma = profil["noise_level"] * pic
    return lignes, np.array(propre), sigma


def construire_base():
    """Charge les 7 sites ; renvoie features X, conso propre, sigma, dates."""
    lignes_all, propre_all, sigma_all = [], [], []
    types = sorted({json.load(open(f, encoding="utf-8"))["site_type"]
                    for f in DATA_DIR.glob("SITE*_metadata.json")})
    for f in sorted(DATA_DIR.glob("SITE*_metadata.json")):
        d = json.load(open(f, encoding="utf-8"))
        start = datetime.fromisoformat(d["start_date"])
        end = datetime.fromisoformat(d["end_date"])
        lignes, propre, sigma = serie_propre_site(d["profile"], start, end)
        code_type = types.index(d["site_type"])
        lignes_all += [l + (code_type,) for l in lignes]
        propre_all.append(propre)
        sigma_all.append(np.full(len(propre), sigma))

    ordre = sorted(range(len(lignes_all)), key=lambda i: lignes_all[i][0])
    lignes_all = [lignes_all[i] for i in ordre]
    propre = np.concatenate(propre_all)[ordre]
    sigma = np.concatenate(sigma_all)[ordre]
    dates = [l[0] for l in lignes_all]
    X = np.array([l[1:] for l in lignes_all], dtype=float)
    limite = max(dates) - timedelta(days=60)   # test = 60 derniers jours
    masque_train = np.array([d < limite for d in dates])
    return X, propre, sigma, masque_train


# ----------------------------------------------------------------------
# UN RUN
# ----------------------------------------------------------------------
def un_run(seed, X, propre, sigma, masque_train):
    rng = np.random.default_rng(seed)                       # bruit propre à ce run
    y = np.maximum(0.0, propre + rng.normal(0, sigma))
    Xtr, Xte, ytr, yte = X[masque_train], X[~masque_train], y[masque_train], y[~masque_train]

    if NOM_BOOST == "XGBoost":
        boost = XGBRegressor(n_estimators=200, max_depth=6, random_state=seed, n_jobs=-1)
    else:
        boost = HistGradientBoostingRegressor(max_iter=200, max_depth=6, random_state=seed)
    modeles = {
        NOM_RF: RandomForestRegressor(n_estimators=200, max_depth=12,
                                      random_state=seed, n_jobs=-1),
        NOM_BOOST: boost,
    }
    res = {}
    for nom, m in modeles.items():
        t0 = time.time()
        m.fit(Xtr, ytr)
        duree = time.time() - t0
        p = m.predict(Xte)
        res[nom] = (mean_absolute_error(yte, p),
                    float(np.sqrt(mean_squared_error(yte, p))), duree)
    return res


# ----------------------------------------------------------------------
# GRAPHIQUES
# ----------------------------------------------------------------------
def style_axes(ax, titre, ylabel):
    ax.set_title(titre, loc="left", fontsize=11, color=ENCRE)
    ax.set_xlabel("Numéro du lancement", color=ENCRE_2)
    ax.set_ylabel(ylabel, color=ENCRE_2)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#c9ced3")
    ax.grid(axis="y", color="#e6e9ec", linewidth=0.7)
    ax.set_axisbelow(True)
    ax.tick_params(colors=ENCRE_2)


def tracer_metrique(ax, runs, idx, titre, ylabel, zero=False):
    x = np.arange(1, len(runs) + 1)
    for nom in (NOM_RF, NOM_BOOST):
        v = np.array([r[nom][idx] for r in runs])
        ax.plot(x, v, color=COULEURS[nom], linewidth=1.6, marker=MARQUEURS[nom],
                markersize=5, markeredgecolor="#fcfcfb", markeredgewidth=1.0, label=nom)
    style_axes(ax, titre, ylabel)
    ax.set_xticks(x[::2] if len(x) > 12 else x)
    if zero:
        ax.set_ylim(bottom=0)


def graphiques(runs, plancher):
    # --- Figure 1 : trois métriques, un panneau chacune (échelles différentes) ---
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.4))
    tracer_metrique(axes[0], runs, 0, "Erreur moyenne (MAE)", "kWh")
    tracer_metrique(axes[1], runs, 1, "RMSE", "kWh")
    tracer_metrique(axes[2], runs, 2, "Temps d'entraînement",
                    "secondes", zero=True)
    axes[0].axhline(plancher, color="#8c959f", linestyle="--", linewidth=1)
    # axes[0].text(0.98, 0.02, "- - -",
    #              transform=axes[0].transAxes, color=ENCRE_2, fontsize=8,
    #              va="bottom", ha="right",
    #              bbox=dict(facecolor="#fcfcfb", edgecolor="none", pad=2))
    h, l = axes[0].get_legend_handles_labels()
    fig.legend(h, l, loc="lower center", ncol=2, frameon=False, labelcolor=ENCRE)
    fig.suptitle(f"Random Forest vs XGBoost sur {len(runs)} lancements "
                 "(données synthétiques, graine différente à chaque lancement)",
                 x=0.01, ha="left", fontsize=12, color=ENCRE)
    fig.tight_layout(rect=(0, 0.07, 1, 0.94))
    fig.savefig(OUT_DIR / "1_metriques_par_lancement.png", dpi=150)
    plt.close(fig)

    # --- Figure 2 : écart de MAE par lancement (XGB - RF) ---
    ecarts = np.array([r[NOM_BOOST][0] - r[NOM_RF][0] for r in runs])
    x = np.arange(1, len(runs) + 1)
    fig, ax = plt.subplots(figsize=(8.5, 4.2))
    ax.bar(x, ecarts, width=0.6, color="#6b7785")
    ax.axhline(0, color=ENCRE_2, linewidth=0.9)
    style_axes(ax, "Écart de MAE : XGBoost − Random Forest  (sous 0 = XGBoost plus précis)",
               "kWh")
    ax.set_xticks(x[::2] if len(x) > 12 else x)
    ax.axhline(ecarts.mean(), color="#b3261e", linestyle="--", linewidth=1.2)
    ax.text(0.99, 0.04, f"- - -  moyenne {ecarts.mean():+.2f} kWh",
            transform=ax.transAxes, color=ENCRE, fontsize=9, va="bottom", ha="right",
            bbox=dict(facecolor="#fcfcfb", edgecolor="none", pad=2))
    fig.tight_layout()
    fig.savefig(OUT_DIR / "2_ecart_mae_par_lancement.png", dpi=150)
    plt.close(fig)


# ----------------------------------------------------------------------
def main():
    print("Construction de la base synthétique (une seule fois)...")
    X, propre, sigma, masque = construire_base()
    # plancher théorique : MAE d'un bruit gaussien = sigma * sqrt(2/pi)
    plancher = float(np.mean(sigma[~masque]) * np.sqrt(2 / np.pi))
    print(f"{len(X):,} lignes | test : {int((~masque).sum()):,} | "
          f"plancher théorique MAE ≈ {plancher:.1f} kWh\n")

    runs = []
    for i in range(N_RUNS):
        r = un_run(SEED_DEPART + i, X, propre, sigma, masque)
        runs.append(r)
        print(f"Run {i+1:>2}/{N_RUNS} | "
              + " | ".join(f"{n}: MAE {v[0]:.2f}, {v[2]:.2f}s" for n, v in r.items()))

    # CSV sans pandas
    with open("comparatif_multi_runs.csv", "w", encoding="utf-8") as f:
        f.write("run,seed,algorithme,mae_kwh,rmse_kwh,temps_s\n")
        for i, r in enumerate(runs):
            for nom, (mae, rmse, t) in r.items():
                f.write(f"{i+1},{SEED_DEPART+i},{nom},{mae:.4f},{rmse:.4f},{t:.4f}\n")

    # Synthèse
    print("\n" + "=" * 72)
    print(f"SYNTHÈSE SUR {N_RUNS} LANCEMENTS (moyenne ± écart-type)")
    print("=" * 72)
    for nom in (NOM_RF, NOM_BOOST):
        a = np.array([r[nom] for r in runs])
        print(f"{nom:<30} MAE {a[:,0].mean():.2f} ± {a[:,0].std():.2f} | "
              f"RMSE {a[:,1].mean():.2f} ± {a[:,1].std():.2f} | "
              f"temps {a[:,2].mean():.2f} ± {a[:,2].std():.2f} s")
    mae_rf = np.array([r[NOM_RF][0] for r in runs])
    mae_xg = np.array([r[NOM_BOOST][0] for r in runs])
    t_rf = np.array([r[NOM_RF][2] for r in runs])
    t_xg = np.array([r[NOM_BOOST][2] for r in runs])
    print(f"\nRandom Forest plus précis (MAE) dans {int((mae_rf < mae_xg).sum())}/{N_RUNS} lancements")
    print(f"Écart MAE moyen (XGBoost − RF) : {np.mean(mae_xg - mae_rf):+.2f} kWh "
          f"({np.mean(mae_xg - mae_rf) / mae_rf.mean() * 100:+.1f} %)")
    print(f"XGBoost plus rapide dans {int((t_xg < t_rf).sum())}/{N_RUNS} lancements "
          f"(≈ {t_rf.mean() / t_xg.mean():.1f}× plus rapide en moyenne)")

    graphiques(runs, plancher)
    print(f"\nCSV : comparatif_multi_runs.csv | graphiques : {OUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
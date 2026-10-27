"""Lecture des prévisions en base."""

import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from smart_energy_app.config import settings
from smart_energy_app.db import engine

logger = logging.getLogger(__name__)

# DISTINCT ON garde la première ligne de chaque groupe, d'où l'ORDER BY qui
# décide laquelle : l'origine la plus récente d'abord.
#
# `forecast_origin` et non `created_at` : un rattrapage insère aujourd'hui des
# prévisions calculées hier, qui remonteraient en tête alors qu'elles ont vu
# moins de données. `created_at` ne sert qu'à départager deux lignes que tout
# le reste égalise.
#
# La borne basse est `now()` : une prévision pour un créneau déjà passé
# n'intéresse personne, la mesure réelle existe.
FORECASTS_SQL = text(
    """
    SELECT DISTINCT ON (site_id, period_start)
      site_id,
      period_start,
      period_end,
      predicted_kw,
      horizon,
      forecast_origin,
      model_name,
      model_version
    FROM predictions
    WHERE period_start >= now()
      AND period_start < now() + make_interval(hours => :hours)
    ORDER BY site_id, period_start, forecast_origin DESC, model_version DESC, created_at DESC
    """
)


def _number(value: Decimal | float | None) -> float | None:
    """numeric arrive en Decimal : JSON n'en veut pas, et None reste None."""
    return None if value is None else float(value)


def _moment(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def load_forecasts(hours: int | None = None) -> dict[str, Any]:
    """Les prévisions à venir, groupées par site.

    Rend un parc vide plutôt qu'une erreur quand la table ne contient rien :
    l'absence de prévision est un état normal — le modèle n'a pas encore
    tourné — et non une panne du service.
    """
    window = hours if hours is not None else settings.forecast_hours

    with engine.connect() as connexion:
        rows = connexion.execute(FORECASTS_SQL, {"hours": window}).mappings().all()

    by_site: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_site.setdefault(row["site_id"], []).append(
            {
                "timestamp": _moment(row["period_start"]),
                "period_end": _moment(row["period_end"]),
                "predicted_kw": _number(row["predicted_kw"]),
                "horizon": row["horizon"],
                # Remontés au client pour qu'il puisse dire d'où sort le
                # chiffre : une prévision sans son origine ni son modèle n'est
                # pas vérifiable.
                "forecast_origin": _moment(row["forecast_origin"]),
                "model_name": row["model_name"],
                "model_version": row["model_version"],
            }
        )

    if not by_site:
        logger.info("Aucune prévision sur les %s prochaines heures.", window)

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "horizon_hours": window,
        "sites": by_site,
    }

"""Prévisions de consommation, lues dans la base alimentée par le bloc ML.

Premier domaine servi par PostgreSQL et non par l'API EnerVision : les
prévisions sont produites par le service ML, qui les écrit dans `predictions`.

Pour un créneau donné, plusieurs prévisions coexistent — celle calculée à 10 h
et celle calculée à 16 h. On sert celle dont `forecast_origin` est le plus
récent : elle a vu davantage de mesures. Le départage complet et la raison de
ne pas se fier à `created_at` sont dans repository.py.

    /api/previsions  ->  table predictions
"""

from .repository import load_forecasts

__all__ = ["load_forecasts"]

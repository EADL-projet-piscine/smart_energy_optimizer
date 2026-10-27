
from typing import Any


MODEL_NAME = "smart-energy-rf-global"


def prepare_forecast_records(
    results: list[dict[str, Any]],
    model_version: int,
) -> list[dict[str, Any]]:
    """
    Transforme les résultats de prédiction en enregistrements
    compatibles avec la future table energy_forecasts.

    Aucune connexion à PostgreSQL n'est effectuée.
    """

    if model_version < 1:
        raise ValueError(
            "La version du modèle doit être supérieure à zéro."
        )

    records = []

    for site in results:
        for prediction in site["predictions"]:
            records.append({
                "site_id": site["site_id"],
                "site_type": site["site_type"],
                "forecast_origin": site["forecast_origin"],
                "target_timestamp": prediction["timestamp"],
                "horizon": prediction["horizon"],
                "predicted_consumption_kw": (
                    prediction["predicted_consumption_kw"]
                ),
                "model_name": MODEL_NAME,
                "model_version": model_version,
            })

    return records

import json
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go

PREDICTIONS_PATH = Path("data/predictions/forecast_24h.json")


def main() -> None:
    with PREDICTIONS_PATH.open("r", encoding="utf-8") as file:
        forecasts = json.load(file)

    fig = go.Figure()

    for site in forecasts:
        df = pd.DataFrame(site["predictions"])

        df["timestamp"] = pd.to_datetime(
            df["timestamp"],
            utc=True,
        )

        fig.add_trace(
            go.Scatter(
                x=df["timestamp"],
                y=df["predicted_consumption_kw"],
                mode="lines+markers",
                name=site["site_id"],
                hovertemplate=(
                    "%{x|%d/%m/%Y %H:%M} UTC"
                    "<br>Prévision : %{y:.2f} kW"
                    "<extra>%{fullData.name}</extra>"
                ),
            )
        )

    fig.update_layout(
        title="Smart Energy Optimizer — Prévisions à 24 heures",
        xaxis_title="Date et heure (UTC)",
        yaxis_title="Consommation prévue (kW)",
        hovermode="x unified",
        template="plotly_white",
        height=650,
    )

    fig.show()


if __name__ == "__main__":
    main()

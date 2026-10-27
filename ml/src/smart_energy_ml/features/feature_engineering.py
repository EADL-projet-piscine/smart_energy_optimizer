import pandas as pd

HORIZONS = range(1, 25)

FEATURE_COLUMNS = [
    "horizon",
    "target_hour",
    "target_day_of_week",
    "target_month",
    "target_is_weekend",
    "lag_1h",
    "lag_24h",
    "rolling_mean_24h",
    "target_lag_168h",
    "site_id",
    "site_type",
]


def build_historical_features(df_hourly: pd.DataFrame) -> pd.DataFrame:
    """
    Calcule les caractéristiques historiques pour chaque site.

    Le timestamp correspond à la dernière heure connue
    au moment de la prévision.
    """
    df = df_hourly.sort_values(["site_id", "timestamp"]).reset_index(drop=True).copy()

    grouped = df.groupby("site_id")["consumption_kw"]

    # Dernière consommation connue (heure d'origine).
    df["lag_1h"] = grouped.shift(0)

    # Consommation 24 heures avant l'origine.
    df["lag_24h"] = grouped.shift(24)

    # Consommation 168 heures avant l'origine.
    df["lag_168h"] = grouped.shift(168)

    # Moyenne des 24 dernières heures disponibles.
    df["rolling_mean_24h"] = grouped.transform(
        lambda series: series.rolling(
            window=24,
            min_periods=24,
        ).mean()
    )

    return df


def build_supervised_dataset(
    df_hourly: pd.DataFrame,
) -> pd.DataFrame:
    """
    Construit les exemples supervisés pour H+1 à H+24.

    Les caractéristiques sont connues à l'origine.
    La consommation cible est utilisée uniquement
    pendant l'entraînement et l'évaluation.
    """
    df = build_historical_features(df_hourly)

    grouped = df.groupby("site_id")["consumption_kw"]

    supervised_frames = []

    for horizon in HORIZONS:
        frame = df[
            [
                "site_id",
                "site_type",
                "timestamp",
                "lag_1h",
                "lag_24h",
                "lag_168h",
                "rolling_mean_24h",
            ]
        ].copy()

        frame = frame.rename(columns={"timestamp": "forecast_origin"})

        frame["horizon"] = horizon

        frame["target_timestamp"] = frame["forecast_origin"] + pd.Timedelta(hours=horizon)

        # Consommation réellement observée à H+h.
        frame["target_consumption_kw"] = grouped.shift(-horizon)

        # Référence hebdomadaire de l'heure cible.
        frame["target_lag_168h"] = grouped.shift(168 - horizon)

        # Calendrier de l'heure cible.
        frame["target_hour"] = frame["target_timestamp"].dt.hour

        frame["target_day_of_week"] = frame["target_timestamp"].dt.dayofweek

        frame["target_month"] = frame["target_timestamp"].dt.month

        frame["target_is_weekend"] = (frame["target_day_of_week"] >= 5).astype(int)

        supervised_frames.append(frame)

    result = pd.concat(
        supervised_frames,
        ignore_index=True,
    )

    # Ne conserver que les exemples dont la cible existe.
    result = result.loc[
        result["target_consumption_kw"].notna()
        & (result["target_timestamp"] <= df["timestamp"].max())
    ].reset_index(drop=True)

    return result


def build_inference_features(
    df_hourly: pd.DataFrame,
    forecast_origin: pd.Timestamp | None = None,
) -> pd.DataFrame:
    """
    Construit les caractéristiques nécessaires aux prévisions
    H+1 à H+24 pour chaque site.

    Si forecast_origin est fourni, utilise cette heure comme
    origine de prévision.

    Sinon, utilise la dernière heure exploitable de chaque site.
    """
    df = build_historical_features(df_hourly)

    if forecast_origin is not None:
        forecast_origin = pd.Timestamp(forecast_origin)

        if forecast_origin.tzinfo is None:
            raise ValueError("forecast_origin doit contenir un fuseau horaire")

        forecast_origin = forecast_origin.tz_convert("UTC")

        # Empêche toute utilisation de données futures.
        df = df.loc[df["timestamp"] <= forecast_origin].copy()

    frames = []

    for site_id, site_df in df.groupby("site_id"):
        site_df = site_df.sort_values("timestamp")

        valid_hours = site_df.loc[
            (site_df["valid_readings"] >= 9) & site_df["consumption_kw"].notna()
        ]

        if valid_hours.empty:
            raise ValueError(f"Aucune heure exploitable disponible pour {site_id}")

        if forecast_origin is not None:
            # En mode explicite, on exige que l'heure
            # demandée soit réellement exploitable.
            valid_hours = valid_hours.loc[valid_hours["timestamp"] == forecast_origin]

            if valid_hours.empty:
                raise ValueError(
                    f"Origine {forecast_origin} indisponible ou inexploitable pour {site_id}"
                )

        origin = valid_hours.iloc[-1]
        origin_timestamp = origin["timestamp"]

        history = site_df.set_index("timestamp")["consumption_kw"]

        for horizon in HORIZONS:
            target_timestamp = origin_timestamp + pd.Timedelta(hours=horizon)

            reference_timestamp = target_timestamp - pd.Timedelta(hours=168)

            target_lag_168h = history.get(
                reference_timestamp,
                float("nan"),
            )

            target_day_of_week = target_timestamp.dayofweek

            frames.append(
                {
                    "site_id": site_id,
                    "site_type": origin["site_type"],
                    "forecast_origin": origin_timestamp,
                    "target_timestamp": target_timestamp,
                    "horizon": horizon,
                    "target_hour": target_timestamp.hour,
                    "target_day_of_week": target_day_of_week,
                    "target_month": target_timestamp.month,
                    "target_is_weekend": int(target_day_of_week >= 5),
                    "lag_1h": origin["lag_1h"],
                    "lag_24h": origin["lag_24h"],
                    "rolling_mean_24h": origin["rolling_mean_24h"],
                    "target_lag_168h": target_lag_168h,
                }
            )

    return pd.DataFrame(frames)

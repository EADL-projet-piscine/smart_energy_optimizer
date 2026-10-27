
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from smart_energy_ml.features.feature_engineering import FEATURE_COLUMNS


NUMERIC_COLUMNS = [
    "horizon",
    "target_hour",
    "target_day_of_week",
    "target_month",
    "target_is_weekend",
    
]

IMPUTED_COLUMNS = [
    "lag_1h",
    "lag_24h",
    "rolling_mean_24h",
    "target_lag_168h",
]

CATEGORICAL_COLUMNS = [
    "site_id",
    "site_type",
]


def create_pipeline() -> Pipeline:
    """
    Construit le pipeline Random Forest utilisé
    dans le notebook 09.

    Le prétraitement est ajusté pendant fit(),
    exclusivement sur les données d'entraînement.
    """

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "numeric",
                "passthrough",
                NUMERIC_COLUMNS,
            ),
            (
                "imputed",
                SimpleImputer(strategy="median"),
                IMPUTED_COLUMNS,
            ),
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore"),
                CATEGORICAL_COLUMNS,
            ),
        ]
    )

    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "model",
                RandomForestRegressor(
                    n_estimators=50,
                    max_depth=15,
                    min_samples_leaf=10,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )

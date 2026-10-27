import numpy as np
import pandas as pd
import pytest
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from smart_energy_ml.models.random_forest import (
    CATEGORICAL_COLUMNS,
    IMPUTED_COLUMNS,
    NUMERIC_COLUMNS,
    create_pipeline,
)


@pytest.fixture
def training_data():
    """Petit dataset déterministe pour tester le pipeline."""

    rng = np.random.default_rng(42)
    rows = []

    for index in range(48):
        hour = index % 24

        rows.append(
            {
                "horizon": hour + 1,
                "target_hour": hour,
                "target_day_of_week": index % 7,
                "target_month": 10,
                "target_is_weekend": int(index % 7 >= 5),
                "lag_1h": float(40 + index % 10),
                "lag_24h": float(35 + index % 8),
                "rolling_mean_24h": float(38 + index % 6),
                "target_lag_168h": float(37 + index % 7),
                "site_id": ("SITE001" if index % 2 == 0 else "SITE002"),
                "site_type": ("office" if index % 2 == 0 else "factory"),
            }
        )

    X = pd.DataFrame(rows)

    y = pd.Series(
        50 + X["horizon"] * 0.5 + rng.normal(0, 1, len(X)),
        dtype=float,
    )

    return X, y


def test_create_pipeline_returns_sklearn_pipeline():
    pipeline = create_pipeline()

    assert isinstance(pipeline, Pipeline)
    assert list(pipeline.named_steps) == [
        "preprocessor",
        "model",
    ]

    assert isinstance(
        pipeline.named_steps["preprocessor"],
        ColumnTransformer,
    )

    assert isinstance(
        pipeline.named_steps["model"],
        RandomForestRegressor,
    )


def test_preprocessor_uses_expected_columns():
    preprocessor = create_pipeline().named_steps["preprocessor"]

    transformers = {
        name: (transformer, columns) for name, transformer, columns in preprocessor.transformers
    }

    assert transformers["numeric"][0] == "passthrough"
    assert transformers["numeric"][1] == NUMERIC_COLUMNS

    imputer, imputed_columns = transformers["imputed"]
    assert isinstance(imputer, SimpleImputer)
    assert imputer.strategy == "median"
    assert imputed_columns == IMPUTED_COLUMNS

    encoder, categorical_columns = transformers["categorical"]
    assert isinstance(encoder, OneHotEncoder)
    assert encoder.handle_unknown == "ignore"
    assert categorical_columns == CATEGORICAL_COLUMNS


def test_random_forest_hyperparameters():
    model = create_pipeline().named_steps["model"]

    assert model.n_estimators == 50
    assert model.max_depth == 15
    assert model.min_samples_leaf == 10
    assert model.random_state == 42
    assert model.n_jobs == -1


def test_pipeline_fits_and_predicts(training_data):
    X, y = training_data

    pipeline = create_pipeline()
    pipeline.fit(X, y)

    predictions = pipeline.predict(X.iloc[:5])

    assert predictions.shape == (5,)
    assert np.isfinite(predictions).all()


def test_missing_historical_values_are_imputed(training_data):
    X, y = training_data
    X = X.copy()

    X.loc[0, "lag_1h"] = np.nan
    X.loc[1, "lag_24h"] = np.nan
    X.loc[2, "rolling_mean_24h"] = np.nan
    X.loc[3, "target_lag_168h"] = np.nan

    pipeline = create_pipeline()
    pipeline.fit(X, y)

    predictions = pipeline.predict(X.iloc[:5])

    assert np.isfinite(predictions).all()


def test_unknown_categories_are_accepted(training_data):
    X, y = training_data

    pipeline = create_pipeline()
    pipeline.fit(X, y)

    unknown_site = X.iloc[[0]].copy()
    unknown_site["site_id"] = "SITE999"
    unknown_site["site_type"] = "hospital"

    predictions = pipeline.predict(unknown_site)

    assert len(predictions) == 1
    assert np.isfinite(predictions).all()


def test_training_is_reproducible(training_data):
    X, y = training_data

    first_pipeline = create_pipeline()
    second_pipeline = create_pipeline()

    first_pipeline.fit(X, y)
    second_pipeline.fit(X, y)

    first_predictions = first_pipeline.predict(X)
    second_predictions = second_pipeline.predict(X)

    np.testing.assert_allclose(
        first_predictions,
        second_predictions,
    )


def test_imputation_statistics_use_training_data_only(
    training_data,
):
    X, y = training_data

    pipeline = create_pipeline()
    pipeline.fit(X, y)

    preprocessor = pipeline.named_steps["preprocessor"]
    imputer = preprocessor.named_transformers_["imputed"]

    expected_medians = X[IMPUTED_COLUMNS].median().to_numpy()

    np.testing.assert_allclose(
        imputer.statistics_,
        expected_medians,
    )

    # Une valeur extrême dans les données de prédiction
    # ne doit pas modifier les statistiques apprises.
    new_data = X.iloc[[0]].copy()
    new_data["lag_1h"] = 999999.0

    pipeline.predict(new_data)

    np.testing.assert_allclose(
        imputer.statistics_,
        expected_medians,
    )

# ml/src/smart_energy_ml/data_access/contract.py

import pandas as pd

REQUIRED_COLUMNS = (
    "site_id",
    "site_type",
    "timestamp",
    "consumption_kw",
    "valid_readings",
    "total_readings",
    "coverage_pct",
)

MIN_VALID_READINGS = 9
EXPECTED_READINGS_PER_HOUR = 12


class DataContractError(ValueError):
    """Erreur lorsque les données ne respectent pas le contrat ETL → ML."""


def validate_hourly_readings(df: pd.DataFrame) -> None:
    """Vérifie le contrat des données horaires préparées par l'ETL."""

    missing_columns = set(REQUIRED_COLUMNS) - set(df.columns)

    if missing_columns:
        raise DataContractError(f"Colonnes obligatoires manquantes : {sorted(missing_columns)}")

    if df.empty:
        raise DataContractError("Le dataset horaire est vide.")

    if df[list(REQUIRED_COLUMNS)].isna().any().any():
        # consumption_kw est nullable : on l'exclut de ce contrôle.
        required_non_nullable = [
            column for column in REQUIRED_COLUMNS if column != "consumption_kw"
        ]

        if df[required_non_nullable].isna().any().any():
            raise DataContractError(
                "Certaines colonnes obligatoires contiennent des valeurs nulles."
            )

    if not isinstance(df["timestamp"].dtype, pd.DatetimeTZDtype):
        raise DataContractError(
            "La colonne timestamp doit contenir des datetime avec fuseau horaire."
        )

    if str(df["timestamp"].dt.tz) != "UTC":
        raise DataContractError("Les timestamps doivent être normalisés en UTC.")

    if not df["timestamp"].dt.floor("h").equals(df["timestamp"]):
        raise DataContractError("Les timestamps doivent correspondre au début de chaque heure.")

    if df.duplicated(subset=["site_id", "timestamp"]).any():
        raise DataContractError(
            "Plusieurs observations existent pour un même site et une même heure."
        )

    if (df["total_readings"] != EXPECTED_READINGS_PER_HOUR).any():
        raise DataContractError("Chaque heure doit correspondre à 12 readings attendus.")

    if ((df["valid_readings"] < 0) | (df["valid_readings"] > EXPECTED_READINGS_PER_HOUR)).any():
        raise DataContractError("Le nombre de readings valides est incohérent.")

    expected_coverage = df["valid_readings"] / df["total_readings"] * 100

    if not ((df["coverage_pct"] - expected_coverage).abs() < 0.01).all():
        raise DataContractError("Les taux de couverture sont incohérents.")

    valid_hours = df["valid_readings"] >= MIN_VALID_READINGS

    if df.loc[~valid_hours, "consumption_kw"].notna().any():
        raise DataContractError("Une heure insuffisamment couverte possède une consommation.")

    if df.loc[valid_hours, "consumption_kw"].isna().any():
        raise DataContractError("Une heure suffisamment couverte ne possède pas de consommation.")

    if (df["consumption_kw"].dropna() < 0).any():
        raise DataContractError("La consommation horaire ne peut pas être négative.")

    sorted_df = df.sort_values(["site_id", "timestamp"])

    hourly_differences = sorted_df.groupby("site_id")["timestamp"].diff()

    discontinuities = hourly_differences.notna() & hourly_differences.ne(pd.Timedelta(hours=1))

    if discontinuities.any():
        raise DataContractError("Des heures sont manquantes dans la série temporelle d'un site.")

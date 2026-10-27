from datetime import UTC, datetime

from smart_energy_ml.data_access.parquet import ParquetDataSource

source = ParquetDataSource("data/processed/readings_hourly_2025_2026.parquet")

df = source.load_hourly_readings(
    start_date=datetime(2025, 1, 1, tzinfo=UTC),
    end_date=datetime(2026, 7, 1, tzinfo=UTC),
)

print("Dimensions :", df.shape)
print("\nPremières lignes :")
print(df.head())

print("\nValeurs manquantes :")
print(df.isna().sum())

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient


def main():
    with EnerVisionClient() as client:
        readings = client.get_readings(
            site_id="SITE001",
            limit=100,
        )

    print(f"Nombre de mesures : {len(readings)}")

    if readings:
        print("Première mesure :")
        print(readings[0])


if __name__ == "__main__":
    main()
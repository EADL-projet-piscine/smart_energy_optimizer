import argparse

import mlflow
from mlflow import MlflowClient


MODEL_NAME = "smart-energy-rf-global"
TRACKING_URI = "sqlite:///mlflow.db"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--version",
        type=int,
        required=True,
        help="Version du modèle à promouvoir comme champion",
    )
    args = parser.parse_args()

    mlflow.set_tracking_uri(TRACKING_URI)

    client = MlflowClient()

    # Vérifie que la version existe avant de modifier l'alias.
    model_version = client.get_model_version(
        name=MODEL_NAME,
        version=str(args.version),
    )

    client.set_registered_model_alias(
        name=MODEL_NAME,
        alias="champion",
        version=model_version.version,
    )

    print(
        f"Champion défini : {MODEL_NAME} "
        f"version {model_version.version}"
    )


if __name__ == "__main__":
    main()
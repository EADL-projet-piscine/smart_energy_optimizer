import os
from datetime import datetime
from typing import Any
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")


class EnerVisionClient:
    """Client HTTP pour l'API EnerVision."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (
            base_url
            or os.getenv("ENERVISION_API_URL", "https://api-mock.charlieandre.fr")
        ).rstrip("/")

        username = os.getenv("ENERVISION_API_USERNAME")
        password = os.getenv("ENERVISION_API_PASSWORD")

        auth = (
            httpx.BasicAuth(username, password)
            if username and password
            else None
        )

        self.client = httpx.Client(
            base_url=self.base_url,
            timeout=30.0,
            auth=auth,
        )

    def get_readings(
        self,
        site_id: str | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """Récupère les mesures énergétiques."""

        if not 1 <= limit <= 1000:
            raise ValueError("limit doit être compris entre 1 et 1000")

        params = {"limit": limit}

        if site_id is not None:
            params["site_id"] = site_id

        if start is not None:
            params["start_time"] = start.isoformat()

        if end is not None:
            params["end_time"] = end.isoformat()

        response = self.client.get(
            "/api/v1/readings",
            params=params,
        )

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            print(f"Erreur HTTP : {response.status_code}")
            print(f"Réponse API : {response.text}")
            raise
        data = response.json()

        if not isinstance(data, list):
            raise ValueError("Réponse inattendue : une liste JSON était attendue")

        return data

    def close(self) -> None:
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from smart_energy_app.db import base_disponible

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if base_disponible():
        logger.info("Connexion à la base établie")
    else:
        logger.warning("Démarrage sans base de données : vérifier DATABASE_URL")
    yield


app = FastAPI(
    title="Smart Energy Optimizer - API métier",
    description="API consommée par le dashboard",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": "ok" if base_disponible() else "indisponible"}

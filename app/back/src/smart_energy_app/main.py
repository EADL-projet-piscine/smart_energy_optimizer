import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from smart_energy_app.consommation.planificateur import refresh_loop
from smart_energy_app.consommation.routes import router as consommation_router
from smart_energy_app.db import database_available

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if database_available():
        logger.info("Connexion à la base établie")
    else:
        logger.warning("Démarrage sans base de données : vérifier DATABASE_URL")

    task = asyncio.create_task(refresh_loop())
    yield
    task.cancel()


app = FastAPI(
    title="Smart Energy Optimizer - API métier",
    description="API consommée par le dashboard",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(consommation_router, prefix="/api/consommation", tags=["Consommation"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": "ok" if database_available() else "indisponible"}

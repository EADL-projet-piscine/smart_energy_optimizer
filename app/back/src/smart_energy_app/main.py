import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from smart_energy_app.consommation.planificateur import refresh_loop
from smart_energy_app.consommation.routes import router as consommation_router
from smart_energy_app.db import database_available
from smart_energy_app.previsions.routes import router as previsions_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if database_available():
        logger.info("Connexion à la base établie")
    else:
        logger.warning("Démarrage sans base de données : vérifier DATABASE_URL")

    task = asyncio.create_task(refresh_loop())
    try:
        yield
    finally:
        # Annuler ne suffit pas : sans attendre la tâche, asyncio signale au
        # mieux « Task was destroyed but it is pending » à l'arrêt, au pire
        # interrompt un appel HTTP en cours.
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="Smart Energy Optimizer - API métier",
    description="API consommée par le dashboard",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(consommation_router, prefix="/api/consommations", tags=["Consommations"])
# Les prévisions viennent de la base, pas de l'API source : elles ne passent
# donc pas par le planificateur et n'ont pas d'état en mémoire à rafraîchir.
app.include_router(previsions_router, prefix="/api/previsions", tags=["Prévisions"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": "ok" if database_available() else "indisponible"}

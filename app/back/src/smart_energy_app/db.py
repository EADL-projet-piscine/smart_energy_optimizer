import logging

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from smart_energy_app.config import settings

logger = logging.getLogger(__name__)

# Sans délai de connexion, une base injoignable bloque le démarrage et /health indéfiniment.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 3},
)


def base_disponible() -> bool:
    try:
        with engine.connect() as connexion:
            connexion.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError as erreur:
        logger.error("Base de données injoignable : %s", erreur)
        return False

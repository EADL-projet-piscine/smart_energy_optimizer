import logging

from sqlalchemy import create_engine, text

from smart_energy_app.config import settings

logger = logging.getLogger(__name__)

engine = create_engine(settings.database_url, pool_pre_ping=True)


def base_disponible() -> bool:
    try:
        with engine.connect() as connexion:
            connexion.execute(text("SELECT 1"))
        return True
    except Exception as erreur:
        logger.error("Base de données injoignable : %s", erreur)
        return False

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    enervision_api_url: str = "https://api-mock.charlieandre.fr"
    enervision_timeout_s: float = 10.0
    enervision_user: str = ""
    enervision_password: SecretStr = SecretStr("")
    # Sans identifiants : ils viennent de DATABASE_URL (variable d'environnement ou .env,
    # voir .env.example), jamais du code.
    database_url: str = "postgresql+psycopg://localhost:5433/enervision"
    consumption_refresh_s: float = 60.0
    consumption_staleness_s: float = 120.0
    history_hours: int = 24
    history_site_count: int = 7
    history_margin_s: int = 300
    consumption_min_refresh_s: float = 2.0


settings = Settings()

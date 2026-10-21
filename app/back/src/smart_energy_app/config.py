from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    enervision_api_url: str = "https://api-mock.charlieandre.fr"
    enervision_timeout_s: float = 10.0
    enervision_user: str = ""
    enervision_password: SecretStr = SecretStr("")
    database_url: str = "postgresql+psycopg://enervision:enervision@localhost:5433/enervision"
    consumption_refresh_s: float = 60.0
    consumption_staleness_s: float = 120.0


settings = Settings()

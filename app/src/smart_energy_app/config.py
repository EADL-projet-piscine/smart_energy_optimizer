from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    enervision_api_url: str = "https://api-mock.charlieandre.fr"
    enervision_timeout_s: float = 10.0


settings = Settings()

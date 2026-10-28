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
    forecast_hours: int = 24
    # Seuils des alertes de capacité, en pourcentage de la capacité du site.
    # Celui d'extinction est volontairement plus bas que celui de levée : avec
    # un seuil unique, un site qui oscille autour de 90 % ferait clignoter son
    # alerte à chaque cycle.
    alert_critical_pct: float = 100.0
    alert_medium_pct: float = 90.0
    alert_clear_pct: float = 85.0
    # Authentification de l'API (voir smart_energy_app.auth). Désactivée par défaut tant
    # que le dashboard ne sait pas se connecter : les routes restent alors ouvertes.
    auth_enabled: bool = False
    # Clé de signature des jetons, au moins 32 caractères. Obligatoire quand
    # l'authentification est activée ; elle vient de l'environnement, jamais du code.
    jwt_secret: SecretStr = SecretStr("")
    jwt_ttl_minutes: int = 15
    # Le navigateur n'envoie un cookie `Secure` qu'en HTTPS (et sur localhost).
    # À désactiver seulement pour un serveur de développement en HTTP.
    auth_cookie_secure: bool = True


settings = Settings()

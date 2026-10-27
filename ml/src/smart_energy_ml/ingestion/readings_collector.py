import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient

LOGGER = logging.getLogger(__name__)

SITE_IDS = [f"SITE{i:03d}" for i in range(1, 8)]

READINGS_PER_DAY = 288


def validate_period(
    start: datetime,
    end: datetime,
) -> None:
    """
    Vérifie que la période de collecte correspond
    à des journées calendaires complètes en UTC.
    """

    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("Les dates doivent être timezone-aware.")

    if start.utcoffset() != timedelta(0):
        raise ValueError("La date de début doit être exprimée en UTC.")

    if end.utcoffset() != timedelta(0):
        raise ValueError("La date de fin doit être exprimée en UTC.")

    if start >= end:
        raise ValueError("La date de début doit précéder la date de fin.")

    if start.hour != 0 or start.minute != 0 or start.second != 0 or start.microsecond != 0:
        raise ValueError("La date de début doit correspondre à minuit UTC.")

    if end.hour != 0 or end.minute != 0 or end.second != 0 or end.microsecond != 0:
        raise ValueError("La date de fin doit correspondre à minuit UTC.")


def collect_readings(
    start: datetime,
    end: datetime,
    raw_dir: Path,
    refresh: bool = False,
    refresh_last_day: bool = False,
) -> None:
    """
    Collecte les mesures EnerVision par site et par jour.

    La période [start, end[ est exprimée en UTC.

    Paramètres :
        start :
            Début de la collecte, à minuit UTC.

        end :
            Fin exclusive de la collecte, à minuit UTC.

        raw_dir :
            Répertoire de stockage des fichiers JSON.

        refresh :
            Force la récupération de toutes les journées.

        refresh_last_day :
            Force uniquement la récupération de la dernière
            journée de la période, même si elle est en cache.
    """

    validate_period(start, end)

    # Normalisation explicite en UTC.
    start = start.astimezone(UTC)
    end = end.astimezone(UTC)

    raw_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    LOGGER.info(
        "Début collecte EnerVision : %s → %s",
        start.isoformat(),
        end.isoformat(),
    )

    with EnerVisionClient() as client:
        for site_id in SITE_IDS:
            current = start

            while current < end:
                period_end = min(
                    current + timedelta(days=1),
                    end,
                )

                filename = f"{site_id}_{current.strftime('%Y%m%d')}.json"

                output_path = raw_dir / site_id / filename

                output_path.parent.mkdir(
                    parents=True,
                    exist_ok=True,
                )

                is_last_day = period_end == end

                should_refresh = refresh or (refresh_last_day and is_last_day)

                # Réutilisation du cache pour les journées
                # déjà collectées, sauf actualisation demandée.
                if output_path.exists() and not should_refresh:
                    LOGGER.info(
                        "Cache existant : %s",
                        output_path,
                    )

                    current = period_end
                    continue

                LOGGER.info(
                    "Collecte %s : %s → %s",
                    site_id,
                    current.isoformat(),
                    period_end.isoformat(),
                )

                readings = client.get_readings(
                    site_id=site_id,
                    start=current,
                    end=period_end,
                    limit=READINGS_PER_DAY,
                )

                if not readings:
                    raise ValueError(
                        f"Aucune mesure EnerVision pour {site_id} le {current.date()}."
                    )

                payload = {
                    "site_id": site_id,
                    "period_start": current.isoformat(),
                    "period_end": period_end.isoformat(),
                    "readings": readings,
                }

                # Écriture temporaire pour éviter de laisser
                # un fichier JSON incomplet en cas d'échec.
                temp_path = output_path.with_suffix(".json.tmp")

                temp_path.write_text(
                    json.dumps(
                        payload,
                        indent=2,
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )

                temp_path.replace(output_path)

                LOGGER.info(
                    "%s : %s mesures enregistrées",
                    site_id,
                    len(readings),
                )

                current = period_end

    LOGGER.info("Collecte EnerVision terminée.")

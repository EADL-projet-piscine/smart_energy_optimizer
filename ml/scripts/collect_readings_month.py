import argparse
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from smart_energy_ml.ingestion.enervision_client import EnerVisionClient


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collecte des mesures énergétiques EnerVision sur une période donnée"
    )

    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Nombre de jours à collecter (défaut : 30)",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=288,
        help="Nombre maximal de mesures demandées par site et par jour",
    )

    parser.add_argument(
        "--start",
        type=str,
        help="Date de début incluse (YYYY-MM-DD)",
    )

    parser.add_argument(
        "--end",
        type=str,
        help="Date de fin exclue (YYYY-MM-DD)",
    )

    args = parser.parse_args()

    if args.days < 1:
        parser.error("--days doit être supérieur ou égal à 1")

    if not 1 <= args.limit <= 1000:
        parser.error("--limit doit être compris entre 1 et 1000")

    collected_at = datetime.now(UTC)
    today = collected_at.replace(hour=0, minute=0, second=0, microsecond=0)

    # Détermination de la période de collecte.
    if args.start or args.end:
        if not args.start or not args.end:
            parser.error("--start et --end doivent être renseignés ensemble")

        try:
            period_start = datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=UTC)
            period_end = datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=UTC)
        except ValueError:
            parser.error("Les dates doivent respecter le format YYYY-MM-DD")

        if period_start >= period_end:
            parser.error("--start doit être antérieur à --end")

    else:
        period_end = today
        period_start = period_end - timedelta(days=args.days)

    if period_end > today:
        parser.error("--end ne peut pas dépasser le début du jour UTC courant")

    days = (period_end - period_start).days

    # Répertoire commun à toutes les collectes.
    output_dir = Path("data/raw/readings")
    output_dir.mkdir(parents=True, exist_ok=True)

    total_readings = 0
    successful_requests = 0
    skipped_requests = 0
    incomplete_requests = 0
    failed_requests = 0

    print("\n--- Configuration de la collecte ---")
    print(f"Début : {period_start.isoformat()}")
    print(f"Fin (exclue) : {period_end.isoformat()}")
    print(f"Durée : {days} jours")
    print("Sites : 7")
    print(f"Limite par requête : {args.limit}")
    print(f"Dossier : {output_dir}\n")

    with EnerVisionClient() as client:
        for site_number in range(1, 8):
            site_id = f"SITE{site_number:03d}"

            for day_index in range(days):
                start = period_start + timedelta(days=day_index)
                end = start + timedelta(days=1)

                date_label = start.strftime("%Y%m%d")
                path = output_dir / f"{site_id}_{date_label}.json"

                # Reprise d'une collecte précédente.
                if path.exists():
                    skipped_requests += 1
                    print(f"[SKIP] {path} existe déjà")
                    continue

                try:
                    readings = client.get_readings(
                        site_id=site_id,
                        start=start,
                        end=end,
                        limit=args.limit,
                    )

                    if not isinstance(readings, list):
                        raise TypeError("La réponse API n'est pas une liste de mesures")

                    # Validation des timestamps sans modifier les données.
                    timestamps = [
                        datetime.fromisoformat(reading["timestamp"]) for reading in readings
                    ]

                    if any(
                        timestamp.tzinfo is None or not start <= timestamp.astimezone(UTC) < end
                        for timestamp in timestamps
                    ):
                        raise ValueError(f"Mesures hors période pour {site_id} / {date_label}")

                    if len(set(timestamps)) != len(timestamps):
                        raise ValueError(f"Doublons de timestamps pour {site_id} / {date_label}")

                    # Contrôle indicatif de la complétude.
                    if len(readings) < args.limit:
                        incomplete_requests += 1
                        print(
                            f"[WARN] {site_id} | {date_label} | "
                            f"{len(readings)}/{args.limit} mesures"
                        )

                    output = {
                        "site_id": site_id,
                        "collected_at": collected_at.isoformat(),
                        "period_start": start.isoformat(),
                        "period_end": end.isoformat(),
                        "requested_limit": args.limit,
                        "readings": readings,
                    }

                    # Écriture atomique pour éviter les fichiers incomplets.
                    temporary_path = path.with_suffix(".tmp")

                    temporary_path.write_text(
                        json.dumps(
                            output,
                            indent=2,
                            ensure_ascii=False,
                        ),
                        encoding="utf-8",
                    )

                    temporary_path.replace(path)

                    total_readings += len(readings)
                    successful_requests += 1

                    print(f"[OK] {site_id} | {date_label} | {len(readings)} mesures")

                except Exception as exc:  # noqa: BLE001
                    failed_requests += 1
                    print(f"[ERROR] {site_id} | {date_label} | {exc}")

    print("\n--- Bilan de collecte ---")
    print(f"Mesures récupérées : {total_readings}")
    print(f"Requêtes réussies : {successful_requests}")
    print(f"Fichiers existants ignorés : {skipped_requests}")
    print(f"Journées potentiellement incomplètes : {incomplete_requests}")
    print(f"Requêtes échouées : {failed_requests}")
    print(f"Dossier : {output_dir}")

    if failed_requests:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

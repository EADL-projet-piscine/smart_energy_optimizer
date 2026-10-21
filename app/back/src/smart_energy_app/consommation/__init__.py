"""Consommation énergétique : mesure courante et historique.

La mesure courante vient de l'API EnerVision (client.py). L'historique
viendra de la base alimentée par Azure Data Factory (repository.py, à venir).

Correspondance avec l'API source :
    /api/consommation/resume        ->  /api/v1/stats/summary
    /api/consommation/sites/{id}    ->  /api/v1/sites/{id}/current
"""

from .service import refresh, state

__all__ = ["refresh", "state"]

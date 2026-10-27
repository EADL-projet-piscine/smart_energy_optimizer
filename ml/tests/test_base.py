from datetime import UTC, datetime

import pandas as pd
import pytest

from smart_energy_ml.data_access.base import (
    HourlyReadingsDataSource,
)


def test_abstract_data_source_cannot_be_instantiated():
    """Une interface abstraite ne peut pas être instanciée."""

    with pytest.raises(TypeError):
        HourlyReadingsDataSource()


def test_subclass_without_implementation_cannot_be_instantiated():
    """Une sous-classe doit implémenter load_hourly_readings."""

    class IncompleteDataSource(HourlyReadingsDataSource):
        pass

    with pytest.raises(TypeError):
        IncompleteDataSource()


def test_concrete_data_source_can_be_instantiated():
    """Une implémentation conforme peut être instanciée."""

    class ConcreteDataSource(HourlyReadingsDataSource):
        def load_hourly_readings(
            self,
            start_date: datetime,
            end_date: datetime,
        ) -> pd.DataFrame:
            return pd.DataFrame()

    source = ConcreteDataSource()

    assert isinstance(source, HourlyReadingsDataSource)


def test_concrete_data_source_loads_readings():
    """L'interface permet de charger des données horaires."""

    expected = pd.DataFrame(
        {
            "site_id": ["SITE001"],
            "timestamp": [pd.Timestamp("2026-10-27T00:00:00Z")],
            "consumption_kw": [42.0],
        }
    )

    class ConcreteDataSource(HourlyReadingsDataSource):
        def load_hourly_readings(
            self,
            start_date: datetime,
            end_date: datetime,
        ) -> pd.DataFrame:
            assert start_date == datetime(2026, 10, 27, tzinfo=UTC)
            assert end_date == datetime(2026, 10, 28, tzinfo=UTC)

            return expected

    source = ConcreteDataSource()

    result = source.load_hourly_readings(
        start_date=datetime(2026, 10, 27, tzinfo=UTC),
        end_date=datetime(2026, 10, 28, tzinfo=UTC),
    )

    pd.testing.assert_frame_equal(result, expected)

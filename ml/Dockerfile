FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN groupadd --system appgroup \
    && useradd --system --gid appgroup --create-home appuser

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir .

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

CMD ["uvicorn", "smart_energy_ml.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
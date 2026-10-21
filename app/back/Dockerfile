FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN groupadd --system appgroup \
    && useradd --system --gid appgroup --create-home appuser

COPY pyproject.toml .
COPY src/ src/

RUN pip install --no-cache-dir .

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

CMD ["uvicorn", "smart_energy_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
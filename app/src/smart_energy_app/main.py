from fastapi import FastAPI

app = FastAPI(
    title="Smart Energy Optimizer - API métier",
    description="API consommée par le dashboard",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

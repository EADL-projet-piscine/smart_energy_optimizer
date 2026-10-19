from fastapi import FastAPI

app = FastAPI(
    title="Smart Energy Optimizer - ML API",
    description="API dédiée aux services de Machine Learning",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

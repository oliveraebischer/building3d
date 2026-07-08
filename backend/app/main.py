from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import tiles, buildings, terrain, portfolio, projects, ingest

app = FastAPI(
    title="Building3D API",
    description="Swiss building data ingestion and processing API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(tiles.router)
app.include_router(buildings.router)
app.include_router(terrain.router)
app.include_router(portfolio.router)
app.include_router(projects.router)
app.include_router(ingest.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "building3d-api"}

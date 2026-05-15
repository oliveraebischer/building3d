from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import tiles

app = FastAPI(
    title="Building3D API",
    description="Swiss building data ingestion and processing API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(tiles.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "building3d-api"}

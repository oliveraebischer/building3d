from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.routers import auth, tiles, buildings, terrain, portfolio, projects, ingest

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


app.include_router(auth.router)
app.include_router(tiles.router)
app.include_router(buildings.router)
app.include_router(terrain.router)
app.include_router(portfolio.router)
app.include_router(projects.router)
app.include_router(ingest.router)


@app.on_event("startup")
async def _backfill_tile_bboxes():
    # Tag any tile downloaded before bbox_lv95 existed, so buildings.py's
    # tile-bbox filtering actually narrows queries for tiles already on disk,
    # not just future downloads. Cheap (metadata-only extent reads) and a
    # no-op once every tile is tagged.
    tiles.backfill_missing_bboxes()


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "building3d-api"}


class SPAStaticFiles(StaticFiles):
    """Serve the built frontend, falling back to index.html for any path that
    isn't a real static asset — so client-side routes (/login, /app, ...)
    survive a hard refresh or direct link in production."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


# Serve the built frontend (Dockerfile copies frontend/dist here as ./static)
# from the same process/port as the API. Mounted last so it never shadows the
# /api/* routes above. Absent in local dev, where the frontend runs separately
# via `npm run dev` and its own Vite proxy.
STATIC_DIR = Path(__file__).parents[1] / "static"
if STATIC_DIR.is_dir():
    app.mount("/", SPAStaticFiles(directory=STATIC_DIR, html=True), name="static")

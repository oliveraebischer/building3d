# Building3D

Swiss building data explorer — search parcels, manage a portfolio, and visualise buildings in 3D on an interactive map.

![Stack](https://img.shields.io/badge/React_18-TypeScript-blue) ![MapLibre GL JS](https://img.shields.io/badge/MapLibre_GL_JS-4.x-green) ![FastAPI](https://img.shields.io/badge/FastAPI-0.111-teal) ![GDAL](https://img.shields.io/badge/GDAL-3.9-orange)

## Features

- **Parcel search** — click any point on the map or search by address to pull GWR parcel data
- **Portfolio management** — track buildings with status labels, notes, and snapshot cache
- **3D building viewer** — Three.js viewer with terrain mesh and OrbitControls
- **Sun / shadow analysis** — hourly sun-path charts per parcel
- **SwissBUILDINGS3D 3.0 tile downloader** — browse the ~6 500 national tiles via SwissTopo STAC API, download on demand
- **Multiple base layers** — SwissTopo pixel map, aerial imagery, greyscale
- **File ingestion** — backend accepts CSV, XLSX, GDB, GeoJSON, and Shapefile

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, TypeScript, Vite, MapLibre GL JS, Three.js, Tailwind CSS, Zustand |
| Backend | Python 3.11+, FastAPI, GDAL, GeoPandas, Fiona, httpx |
| Data | SwissTopo WMTS, geo.admin.ch GWR API, SwissTopo STAC API |

## Prerequisites

- Node.js 20+
- Python 3.11+
- GDAL 3.9 (including development headers — required by the `gdal` Python package)

On macOS with Homebrew:
```bash
brew install gdal
```

## Setup

### Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py        # http://localhost:8000
```

API docs are available at `http://localhost:8000/docs`.

## Environment

No API keys are required. All external services (SwissTopo WMTS, geo.admin.ch, STAC API) are publicly accessible.

The backend expects the frontend to run on `http://localhost:5173` (CORS). If you change either port, update `allow_origins` in `backend/app/main.py`.

## Data storage

Downloaded SwissBUILDINGS3D tiles are stored under `backend/data/tiles/`:

```
backend/data/tiles/
├── manifest.json                        # tile_id → {size_bytes, downloaded_at}
└── swissbuildings3d_3_0_2024_1172-31/  # one directory per tile
    └── *.gdb.zip
```

## License

MIT — see [LICENSE](LICENSE).

# Building3D

Swiss building data explorer — ingests CSV, XLSX, GDB, GeoJSON, Shapefile and renders 2D/3D features on a map.

## Project structure

```
building3d/
├── frontend/          # React 18 + TypeScript + Vite + MapLibre GL JS + Tailwind
│   └── src/
│       ├── api/       # geoAdmin.ts (parcel/GWR), tiles.ts (STAC + backend API)
│       ├── components/ # MapView, TopBar, ParcelPanel, DataPanel
│       └── store/     # mapStore.ts (Zustand — all shared state)
├── backend/           # Python + FastAPI + GDAL + GeoPandas
│   ├── app/
│   │   ├── main.py
│   │   └── routers/tiles.py   # /api/tiles — list, download, delete
│   └── data/tiles/            # Downloaded GDB zips + manifest.json
└── .claude/agents/    # Agent team definitions
```

## Running locally

### Frontend (port 5173)
```bash
cd frontend
npm install
npm run dev
```

### Backend (port 8000)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

## Agent team

| Agent | Role | Model |
|-------|------|-------|
| `pm-po` | PM/PO — team lead, scope & priorities | opus |
| `ux` | UI/UX specialist — design & interaction | sonnet |
| `frontend` | Senior frontend — React/MapLibre implementation | sonnet |
| `backend` | Senior backend — FastAPI/GDAL/GeoPandas pipeline | sonnet |

Enable agent teams: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (already set in ~/.claude/settings.json)

## Architecture decisions

- **API contract changes** require agreement between `frontend` and `backend` agents
- **Frontend architecture** (state, components, routing) is owned by `frontend`
- **Backend architecture** (pipeline, data models) is owned by `backend`
- **Scope and priority** decisions are owned by `pm-po`

## SwissTopo WMTS (no API key needed)

```
https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{y}/{x}.jpeg
```

Layers: `ch.swisstopo.pixelkarte-farbe`, `ch.swisstopo.swissimage`, `ch.swisstopo.pixelkarte-grau`

## Coordinate system

All spatial data returned by the backend must be in **WGS84 (EPSG:4326)**.

## SwissBUILDINGS3D 3.0 tile downloader

Data mode (top-right "Data" button) activates a tile grid over Switzerland.

### STAC API
- Collection: `ch.swisstopo.swissbuildings3d_3_0`
- Base: `https://data.geo.admin.ch/api/stac/v1`
- ~6,500 individual tiles (~4 km × 3 km each), paginated at 100/page
- Each tile has three formats: `.gdb.zip` (GDB, smallest), `.dwg.zip` (~7× larger), `.citygml.zip`
- **Filter national-coverage items**: only include tiles whose ID ends with `_NNNN-MM` (e.g. `swissbuildings3d_3_0_2024_1172-31`). Items like `swissbuildings3d_3_0_2025` are whole-Switzerland packages — exclude them or they block all map interaction.

### Backend storage
- Files stored at `backend/data/tiles/{tile_id}/`
- Manifest at `backend/data/tiles/manifest.json` — dict of tile_id → `{size_bytes, downloaded_at}`
- Download endpoint streams via `httpx.AsyncClient`; idempotent (returns existing entry if present)

### Frontend state (mapStore.ts)
- `tileGrid` — all STAC tile features (loaded once on first data mode entry)
- `downloadedTileIds` — Set of confirmed downloaded IDs
- `downloadingTileIds` — Set of in-flight IDs
- `highlightedTileId` — bidirectional panel↔map hover highlight

### MapLibre tile grid layers
- Source: `tile-grid` GeoJSON with `promoteId: 'id'` (enables string feature-state keys)
- Feature states: `downloaded`, `hovered`, `highlighted`
- Layers: `tile-grid-fill` and `tile-grid-outline`, inserted below `parcel-highlight-fill`
- **Map handlers are in the mount-only `useEffect([], [])`** — HMR does not re-run them; hard refresh required after editing those handlers

### MapView cleanup ordering
The mount effect cleanup must run `clearParcel()` **before** `map.remove()`, and reset `mapReadyRef.current = false`. Otherwise stale closures calling `map.getSource()` on a destroyed map crash during HMR.

# Building3D

Swiss building data explorer — ingests CSV, XLSX, GDB, GeoJSON, Shapefile and renders 2D/3D features on a map.

## Project structure

```
building3d/
├── frontend/          # React 18 + TypeScript + Vite + MapLibre GL JS + Tailwind
├── backend/           # Python + FastAPI + GDAL + GeoPandas
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

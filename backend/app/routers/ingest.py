import json
import shutil
import tempfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from shapely.geometry import Point
from shapely.wkt import loads as wkt_loads

router = APIRouter(prefix="/api/ingest", tags=["ingest"])
MAX_FEATURES = 10_000


@router.post("")
async def ingest_file(file: UploadFile = File(...)):
    filename = file.filename or "upload"
    suffix = Path(filename).suffix.lower()
    # Handle double extension (.gdb.zip)
    if filename.lower().endswith(".gdb.zip"):
        suffix = ".gdb.zip"

    tmp_dir = tempfile.mkdtemp()
    try:
        tmp_path = Path(tmp_dir) / filename
        content = await file.read()
        tmp_path.write_bytes(content)

        gdf = _read_file(tmp_path, suffix)

        crs_detected = "unknown"
        if gdf.crs is not None:
            epsg = gdf.crs.to_epsg()
            crs_detected = f"EPSG:{epsg}" if epsg else str(gdf.crs)
            if epsg != 4326:
                gdf = gdf.to_crs("EPSG:4326")

        total = len(gdf)
        truncated = total > MAX_FEATURES
        if truncated:
            gdf = gdf.iloc[:MAX_FEATURES]

        columns = [c for c in gdf.columns if c != "geometry"]

        # Convert any non-serializable types in properties
        for col in columns:
            gdf[col] = gdf[col].astype(str).where(
                ~gdf[col].apply(lambda x: isinstance(x, (int, float, str, bool, type(None)))),
                other=gdf[col],
            )

        fc = json.loads(gdf.to_json())
        fc["feature_count"] = total
        fc["crs_detected"] = crs_detected
        fc["columns"] = columns
        fc["truncated"] = truncated
        return fc

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Could not parse file: {exc}") from exc
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _read_file(path: Path, suffix: str) -> gpd.GeoDataFrame:
    if suffix in (".geojson", ".json"):
        return gpd.read_file(str(path))

    if suffix == ".shp":
        return gpd.read_file(str(path))

    if suffix == ".gdb":
        return gpd.read_file(str(path))

    if suffix == ".gdb.zip":
        return gpd.read_file(f"/vsizip/{path}")

    if suffix == ".zip":
        return gpd.read_file(f"/vsizip/{path}")

    if suffix == ".csv":
        df = pd.read_csv(str(path))
        return _df_to_geodataframe(df)

    if suffix in (".xlsx", ".xls"):
        df = pd.read_excel(str(path))
        return _df_to_geodataframe(df)

    raise HTTPException(400, f"Unsupported file format: '{suffix}'. Accepted: .csv .xlsx .geojson .json .shp .gdb .gdb.zip")


def _df_to_geodataframe(df: pd.DataFrame) -> gpd.GeoDataFrame:
    cols_lower = {c.lower(): c for c in df.columns}

    # WKT geometry column
    for candidate in ("geometry", "geom", "wkt", "shape"):
        if candidate in cols_lower:
            col = cols_lower[candidate]
            try:
                geoms = df[col].apply(wkt_loads)
                return gpd.GeoDataFrame(df.drop(columns=[col]), geometry=geoms, crs="EPSG:4326")
            except Exception:
                pass

    # WGS84 lat/lon
    lat_candidates = [c for c in df.columns if c.lower() in ("lat", "latitude", "y")]
    lon_candidates = [c for c in df.columns if c.lower() in ("lon", "lng", "longitude", "x")]
    if lat_candidates and lon_candidates:
        lat_col, lon_col = lat_candidates[0], lon_candidates[0]
        geoms = [Point(row[lon_col], row[lat_col]) for _, row in df.iterrows()]
        return gpd.GeoDataFrame(df, geometry=geoms, crs="EPSG:4326")

    # Swiss LV95 E/N
    e_candidates = [c for c in df.columns if c.lower() in ("e", "east", "easting", "x_lv95")]
    n_candidates = [c for c in df.columns if c.lower() in ("n", "north", "northing", "y_lv95")]
    if e_candidates and n_candidates:
        e_col, n_col = e_candidates[0], n_candidates[0]
        geoms = [Point(row[e_col], row[n_col]) for _, row in df.iterrows()]
        gdf = gpd.GeoDataFrame(df, geometry=geoms, crs="EPSG:2056")
        return gdf.to_crs("EPSG:4326")

    raise HTTPException(
        400,
        "No geometry found. Expected: geometry/geom/wkt column, lat/lon columns, or E/N (LV95) columns.",
    )

import type maplibregl from 'maplibre-gl'

const IDENTIFY = 'https://api3.geo.admin.ch/rest/services/all/MapServer/identify'
const FIND     = 'https://api3.geo.admin.ch/rest/services/all/MapServer/find'

// ─── GWR code lookup tables ────────────────────────────────────────────────

const GSTAT: Record<number, string> = {
  1001: 'Planned', 1002: 'Authorized', 1003: 'Under Construction',
  1004: 'In Use', 1005: 'Not in Use', 1007: 'Demolished', 1008: 'Not Realized',
}

const GKAT: Record<number, string> = {
  1010: 'Residential (1–2 apts)', 1021: 'Residential (3+ apts)',
  1025: 'Mixed Use', 1030: 'Care / Nursing Home',
  1040: 'Commercial', 1060: 'Industrial', 1080: 'Special Purpose',
}

const GBAUP: Record<number, string> = {
  8011: 'Before 1919', 8012: '1919–1945', 8013: '1946–1960',
  8014: '1961–1970', 8015: '1971–1980', 8016: '1981–1985',
  8017: '1986–1990', 8018: '1991–1995', 8019: '1996–2000',
  8020: '2001–2005', 8021: '2006–2010', 8022: '2011–2015', 8023: 'After 2015',
}

const GENH: Record<number, string> = {
  7500: 'None', 7501: 'Air', 7510: 'Gas', 7511: 'Biogas',
  7520: 'Oil', 7530: 'Wood', 7531: 'Wood Pellets', 7532: 'Wood Chips',
  7533: 'Firewood', 7540: 'Heat Pump', 7541: 'Ground Source',
  7542: 'Water Source', 7543: 'Air Source', 7550: 'Solar',
  7560: 'Electricity', 7570: 'District Heating', 7580: 'Other',
}

const GWAERZ: Record<number, string> = {
  7410: 'No Heating', 7420: 'Individual Stoves',
  7430: 'Central (Unit)', 7431: 'Central (Building)',
  7432: 'Central (Several Buildings)', 7433: 'Central (District)',
  7434: 'Central (Building)', 7440: 'District Heating', 7450: 'Other',
}

function look<T extends number>(table: Record<T, string>, code: T | null | undefined): string {
  if (code == null) return '—'
  return table[code] ?? `Code ${code}`
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type ParcelFeature = {
  egrid: string
  parcelNumber: string
  canton: string
  bfsnr: number
  type: number
  geometry: GeoJSON.Polygon
}

export type GwrFeature = {
  egid: string
  address: string
  municipality: string
  canton: string
  status: string
  category: string
  constructionYear: number | null
  constructionPeriod: string
  floors: number | null
  apartments: number | null
  footprintM2: number | null
  heatingSystem: string
  energySourceHeating: string
  energySourceHotWater: string
  geometry: GeoJSON.Point | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function esriRingsToGeoJSON(rings: [number, number][][]): GeoJSON.Polygon {
  return { type: 'Polygon', coordinates: rings }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attributesToGwrFeature(r: Record<string, any>): GwrFeature {
  const a = r.attributes ?? r
  const g = r.geometry
  return {
    egid: String(a.egid ?? '—'),
    address: a.strname_deinr ?? '—',
    municipality: a.ggdename ?? '—',
    canton: a.gdekt ?? '—',
    status: look(GSTAT, a.gstat),
    category: look(GKAT, a.gkat),
    constructionYear: a.gbauj ?? null,
    constructionPeriod: look(GBAUP, a.gbaup),
    floors: a.gastw ?? null,
    apartments: a.ganzwhg ?? null,
    footprintM2: a.garea ?? null,
    heatingSystem: look(GWAERZ, a.gwaerzh1),
    energySourceHeating: look(GENH, a.genh1),
    energySourceHotWater: look(GENH, a.genw1),
    geometry: g?.x != null && g?.y != null
      ? { type: 'Point', coordinates: [g.x, g.y] }
      : null,
  }
}

function identifyParams(
  layerId: string,
  lng: number,
  lat: number,
  bounds: maplibregl.LngLatBounds,
  canvas: { width: number; height: number },
  returnGeometry: boolean,
): URLSearchParams {
  return new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    layers: `all:${layerId}`,
    mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
    imageDisplay: `${canvas.width},${canvas.height},96`,
    tolerance: '8',
    returnGeometry: String(returnGeometry),
    sr: '4326',
    lang: 'en',
  })
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function identifyParcel(
  lng: number,
  lat: number,
  bounds: maplibregl.LngLatBounds,
  canvas: { width: number; height: number },
): Promise<ParcelFeature | null> {
  const params = identifyParams('ch.swisstopo-vd.amtliche-vermessung', lng, lat, bounds, canvas, true)
  const res = await fetch(`${IDENTIFY}?${params}`)
  if (!res.ok) return null
  const data = await res.json()
  const r = data.results?.[0]
  if (!r) return null
  const a = r.attributes
  return {
    egrid: a.egris_egrid ?? '—',
    parcelNumber: a.number ?? a.name ?? '—',
    canton: a.ak ?? '—',
    bfsnr: a.bfsnr,
    type: a.realestate_type,
    geometry: esriRingsToGeoJSON(r.geometry.rings),
  }
}

/** Returns address and parcel EGRID for a single building by its EGID. */
export async function findBuildingByEGID(
  egid: string,
): Promise<{ address: string | null; egrid: string | null } | null> {
  const params = new URLSearchParams({
    layer: 'ch.bfs.gebaeude_wohnungs_register',
    searchText: egid,
    searchField: 'egid',
    returnGeometry: 'false',
    sr: '4326',
    lang: 'en',
  })
  const res = await fetch(`${FIND}?${params}`)
  if (!res.ok) return null
  const data = await res.json()
  const results = data.results ?? []
  if (!results.length) return null
  const a = results[0].attributes ?? results[0]
  return {
    address: a.strname_deinr && a.strname_deinr !== '—' ? String(a.strname_deinr) : null,
    egrid: a.egrid ? String(a.egrid) : null,
  }
}

/** Returns all GWR buildings whose parcel EGRID matches the given parcel EGRID. */
export async function findBuildingsByEGRID(egrid: string): Promise<GwrFeature[]> {
  if (!egrid || egrid === '—') return []
  const params = new URLSearchParams({
    layer: 'ch.bfs.gebaeude_wohnungs_register',
    searchText: egrid,
    searchField: 'egrid',
    returnGeometry: 'true',
    sr: '4326',
    lang: 'en',
  })
  const res = await fetch(`${FIND}?${params}`)
  if (!res.ok) return []
  const data = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).map((r: any) => attributesToGwrFeature(r))
}

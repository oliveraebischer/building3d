const STAC_BASE = 'https://data.geo.admin.ch/api/stac/v1'
const COLLECTION = 'ch.swisstopo.swissbuildings3d_3_0'
const TILE_CACHE_KEY = 'building3d_tile_index'
const TILE_CACHE_TTL = 24 * 60 * 60 * 1000  // 24 h

export type TileGridFeature = {
  id: string
  geometry: GeoJSON.Polygon
  gdbHref: string
}

export type DownloadedTile = {
  id: string
  size_bytes: number
  downloaded_at: string
}

type StacItem = {
  id: string
  geometry: GeoJSON.Polygon
  assets?: Record<string, { href: string; type?: string } | undefined>
}

type TileCache = { tiles: TileGridFeature[]; savedAt: number }

function loadTileCache(): TileGridFeature[] | null {
  try {
    const raw = localStorage.getItem(TILE_CACHE_KEY)
    if (!raw) return null
    const { tiles, savedAt } = JSON.parse(raw) as TileCache
    return Date.now() - savedAt < TILE_CACHE_TTL ? tiles : null
  } catch { return null }
}

function saveTileCache(tiles: TileGridFeature[]) {
  try {
    localStorage.setItem(TILE_CACHE_KEY, JSON.stringify({ tiles, savedAt: Date.now() }))
  } catch { /* quota exceeded — ignore */ }
}

export async function fetchAllTiles(): Promise<TileGridFeature[]> {
  const cached = loadTileCache()
  if (cached) return cached

  const features: TileGridFeature[] = []
  let url: string | null = `${STAC_BASE}/collections/${COLLECTION}/items?limit=100`
  while (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) break
    const data = await res.json()
    for (const item of (data.features ?? []) as StacItem[]) {
      const gdbEntry = Object.entries(item.assets ?? {}).find(([k]) => k.endsWith('.gdb.zip'))
      const gdbHref = gdbEntry?.[1]?.href
      if (gdbHref && /_\d+-\d+$/.test(item.id)) {
        features.push({ id: item.id, geometry: item.geometry, gdbHref })
      }
    }
    const next = (data.links ?? []).find((l: { rel: string; href: string }) => l.rel === 'next')
    url = next?.href ?? null
  }

  if (features.length > 0) saveTileCache(features)
  return features
}

export async function fetchDownloadedTiles(): Promise<DownloadedTile[]> {
  try {
    const res = await fetch('/api/tiles')
    return res.ok ? res.json() : []
  } catch {
    return []
  }
}

export async function downloadTile(id: string, url: string): Promise<DownloadedTile> {
  const res = await fetch(`/api/tiles/${encodeURIComponent(id)}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  return res.json()
}

export async function deleteTile(id: string): Promise<void> {
  await fetch(`/api/tiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

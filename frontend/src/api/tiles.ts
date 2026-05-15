const STAC_BASE = 'https://data.geo.admin.ch/api/stac/v1'
const COLLECTION = 'ch.swisstopo.swissbuildings3d_3_0'

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

export async function fetchAllTiles(): Promise<TileGridFeature[]> {
  const features: TileGridFeature[] = []
  let url: string | null = `${STAC_BASE}/collections/${COLLECTION}/items?limit=1000`
  while (url) {
    const res = await fetch(url)
    if (!res.ok) break
    const data = await res.json()
    for (const item of (data.features ?? []) as StacItem[]) {
      // Asset keys are full filenames (e.g. "…_2056_5728.gdb.zip") — find by extension
      const gdbEntry = Object.entries(item.assets ?? {}).find(([k]) => k.endsWith('.gdb.zip'))
      const gdbHref = gdbEntry?.[1]?.href
      // Skip national-coverage items (e.g. swissbuildings3d_3_0_2025) — only keep individual tiles (id ends with _NNNN-MM)
      if (gdbHref && /_\d+-\d+$/.test(item.id)) {
        features.push({ id: item.id, geometry: item.geometry, gdbHref })
      }
    }
    const next = (data.links ?? []).find((l: { rel: string; href: string }) => l.rel === 'next')
    url = next?.href ?? null
  }
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

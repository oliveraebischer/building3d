export type TerrainGrid = {
  grid_size: number
  elevations: (number | null)[][]
  bbox_lv95: [number, number, number, number]  // [minE, minN, maxE, maxN]
  min_elevation: number
}

export async function fetchTerrain(
  bbox: [number, number, number, number],
  grid = 16,
): Promise<TerrainGrid> {
  const params = new URLSearchParams({ bbox: bbox.join(','), grid: String(grid) })
  const res = await fetch(`/api/terrain?${params}`, { signal: AbortSignal.timeout(25_000) })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

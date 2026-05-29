export type BuildingFeature = {
  type: 'Feature'
  properties: {
    egid: number
    objektart: string | null
    dach_max: number | null
    gesamthoehe: number | null
  }
  geometry: {
    type: 'MultiPolygon'
    coordinates: [number, number, number][][][]
  }
}

export type BuildingFeatureCollection = {
  type: 'FeatureCollection'
  features: BuildingFeature[]
}

export async function fetchBuildings(
  egids: string[],
  bbox: [number, number, number, number],
): Promise<BuildingFeatureCollection> {
  const params = new URLSearchParams({
    egids: egids.join(','),
    bbox: bbox.join(','),
  })
  const res = await fetch(`/api/buildings?${params}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export async function fetchNeighborBuildings(
  bbox: [number, number, number, number],
): Promise<BuildingFeatureCollection> {
  const params = new URLSearchParams({ bbox: bbox.join(',') })
  const res = await fetch(`/api/buildings?${params}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

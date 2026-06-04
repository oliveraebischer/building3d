export type BuildingFeature = {
  type: 'Feature'
  properties: {
    egid: number | null
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

export type BuildingMeasurementsResponse = {
  egid: number
  footprintM2: number
  facadeM2: number
  roofM2: number
  volumeM3: number
  circumferenceM: number
  heightM: number
  dach_max: number
}

export async function fetchBuildingMeasurements(
  egid: number,
): Promise<BuildingMeasurementsResponse | null> {
  const res = await fetch(`/api/buildings/${egid}/measurements`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

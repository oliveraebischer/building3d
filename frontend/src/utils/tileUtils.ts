import type { TileGridFeature } from '../api/tiles'

export function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export function findTileForCoordinate(
  lng: number,
  lat: number,
  tiles: TileGridFeature[],
): TileGridFeature | null {
  for (const tile of tiles) {
    const ring = tile.geometry.coordinates[0] as [number, number][]
    if (pointInRing(lng, lat, ring)) return tile
  }
  return null
}

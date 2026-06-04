import { useEffect } from 'react'
import { useMapStore } from '../store/mapStore'
import { fetchBuildings } from '../api/buildings'
import { fetchTerrain } from '../api/terrain'
import { computeMapUrls, loadImage, setPreloadedMapImages } from '../utils/mapTexture'
import type { BuildingFeatureCollection } from '../api/buildings'
import type { AutoTileStatus } from './useAutoTileDownload'

export function usePreloadBuildings(autoTileStatus: AutoTileStatus) {
  const {
    selectedParcel, selectedGWR,
    prefetchedGeometry, setPrefetchedGeometry,
  } = useMapStore()

  useEffect(() => {
    if (autoTileStatus !== 'ready' || !selectedParcel) return
    if (prefetchedGeometry?.egrid === selectedParcel.egrid) return

    const coords = (selectedParcel.geometry.coordinates as [number, number][][]).flat()
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const bbox: [number, number, number, number] = [minLng, minLat, maxLng, maxLat]
    const pad = 1.5
    const terrainBbox: [number, number, number, number] = [
      minLng - (maxLng - minLng) * pad, minLat - (maxLat - minLat) * pad,
      maxLng + (maxLng - minLng) * pad, maxLat + (maxLat - minLat) * pad,
    ]

    const egrid = selectedParcel.egrid
    const { swissUrl, cadUrl } = computeMapUrls(selectedParcel)

    // Terrain and layer preload is unconditional — independent of EGID availability
    const egids = selectedGWR.map(b => b.egid).filter(e => e !== '—')
    const buildingsFetch: Promise<BuildingFeatureCollection> = egids.length > 0
      ? fetchBuildings(egids, bbox)
      : Promise.resolve({ type: 'FeatureCollection', features: [] })

    let cancelled = false

    Promise.all([
      buildingsFetch,
      fetchTerrain(terrainBbox, 32).catch(() => null),
      loadImage(swissUrl).catch(() => null),
      loadImage(cadUrl).catch(() => null),
    ]).then(([data, terrain, swissImg, cadImg]) => {
      if (cancelled) return
      if (swissImg && cadImg) setPreloadedMapImages(egrid, swissImg, cadImg)
      setPrefetchedGeometry({ egrid, data, terrain })
    }).catch(() => {})

    return () => { cancelled = true }
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    autoTileStatus,
    selectedParcel?.egrid,
    selectedGWR.length,
  ])
}

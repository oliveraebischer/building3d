import { useEffect, useState } from 'react'
import { useMapStore } from '../store/mapStore'
import { fetchTilesForBbox } from '../api/tiles'
import { findTileForCoordinate } from '../utils/tileUtils'

export type AutoTileStatus =
  | 'idle'
  | 'fetching-index'
  | 'downloading'
  | 'tile-not-found'
  | 'ready'

export function useAutoTileDownload(): AutoTileStatus {
  const {
    selectedParcel,
    downloadedTileIds, downloadingTileIds,
    triggerTileDownload,
  } = useMapStore()

  const [status, setStatus] = useState<AutoTileStatus>('idle')

  useEffect(() => {
    if (!selectedParcel) {
      setStatus('idle')
      return
    }

    const coords = (selectedParcel.geometry.coordinates as [number, number][][]).flat()
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const lng = (minLng + maxLng) / 2
    const lat = (minLat + maxLat) / 2

    let cancelled = false

    const run = async () => {
      setStatus('fetching-index')

      let tiles
      try {
        tiles = await fetchTilesForBbox([minLng, minLat, maxLng, maxLat])
      } catch {
        if (!cancelled) setStatus('tile-not-found')
        return
      }

      if (cancelled) return

      const tile = findTileForCoordinate(lng, lat, tiles)
      if (!tile) {
        setStatus('tile-not-found')
        return
      }

      if (downloadedTileIds.has(tile.id)) {
        setStatus('ready')
        return
      }
      if (downloadingTileIds.has(tile.id)) {
        setStatus('downloading')
        return
      }

      setStatus('downloading')
      triggerTileDownload(tile.id, tile.gdbHref)
    }

    run()
    return () => { cancelled = true }
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    selectedParcel?.egrid,
    downloadedTileIds.size,
    downloadingTileIds.size,
  ])

  return status
}

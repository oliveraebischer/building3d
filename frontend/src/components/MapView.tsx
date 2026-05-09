import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMapStore, BASE_LAYERS } from '../store/mapStore'

// Switzerland center
const SWITZERLAND_CENTER: [number, number] = [8.2275, 46.8182]
const INITIAL_ZOOM = 8

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const activeBaseLayerId = useMapStore((s) => s.activeBaseLayerId)

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const activeLayer = BASE_LAYERS.find((l) => l.id === 'pixelkarte')!

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'swisstopo-base': {
            type: 'raster',
            tiles: [activeLayer.url],
            tileSize: 256,
            attribution: activeLayer.attribution,
          },
        },
        layers: [
          {
            id: 'swisstopo-base',
            type: 'raster',
            source: 'swisstopo-base',
          },
        ],
      },
      center: SWITZERLAND_CENTER,
      zoom: INITIAL_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Swap base layer when selection changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const layer = BASE_LAYERS.find((l) => l.id === activeBaseLayerId)
    if (!layer) return

    const source = map.getSource('swisstopo-base') as maplibregl.RasterTileSource | undefined
    if (source) {
      // MapLibre doesn't support setTiles directly on an existing source in all versions,
      // so we update the style tiles by re-setting the source
      map.removeLayer('swisstopo-base')
      map.removeSource('swisstopo-base')
      map.addSource('swisstopo-base', {
        type: 'raster',
        tiles: [layer.url],
        tileSize: 256,
        attribution: layer.attribution,
      })
      map.addLayer({
        id: 'swisstopo-base',
        type: 'raster',
        source: 'swisstopo-base',
      })
    }
  }, [activeBaseLayerId])

  return <div ref={mapContainer} className="absolute inset-0" />
}

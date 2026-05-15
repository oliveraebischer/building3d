import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMapStore, BASE_LAYERS } from '../store/mapStore'
import { identifyParcel, findBuildingsByEGRID } from '../api/geoAdmin'

const SWITZERLAND_CENTER: [number, number] = [8.2275, 46.8182]
const INITIAL_ZOOM = 8
const CADASTRAL_MIN_ZOOM = 14

const CADASTRAL_WMS = [
  'https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap',
  '&LAYERS=ch.kantone.cadastralwebmap-farbe',
  '&FORMAT=image/png&TRANSPARENT=true',
  '&CRS=EPSG:3857&WIDTH=256&HEIGHT=256',
  '&BBOX={bbox-epsg-3857}&STYLES=',
].join('')

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapReadyRef = useRef(false)
  const { activeBaseLayerId, dataMode, setMapInstance, setLookupParcel,
          setParcelLoading, setParcelResult, clearParcel } = useMapStore()

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const initialLayer = BASE_LAYERS.find((l) => l.id === 'pixelkarte')!

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'swisstopo-base': {
            type: 'raster',
            tiles: [initialLayer.url],
            tileSize: 256,
            attribution: initialLayer.attribution,
          },
        },
        layers: [{ id: 'swisstopo-base', type: 'raster', source: 'swisstopo-base' }],
      },
      center: SWITZERLAND_CENTER,
      zoom: INITIAL_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      mapReadyRef.current = true
      // Cadastral overlay — always on, 50% opacity, zoom ≥ 14
      map.addSource('cadastral', {
        type: 'raster',
        tiles: [CADASTRAL_WMS],
        tileSize: 256,
        attribution: '© swisstopo / cantons',
      })
      map.addLayer({
        id: 'cadastral',
        type: 'raster',
        source: 'cadastral',
        minzoom: CADASTRAL_MIN_ZOOM,
        paint: { 'raster-opacity': 0.5 },
      })

      // Parcel highlight source
      map.addSource('parcel-highlight', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'parcel-highlight-fill',
        type: 'fill',
        source: 'parcel-highlight',
        paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.2 },
      })
      map.addLayer({
        id: 'parcel-highlight-outline',
        type: 'line',
        source: 'parcel-highlight',
        paint: { 'line-color': '#00E5FF', 'line-width': 2 },
      })

      // Building hover highlight source
      map.addSource('building-highlight', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'building-highlight-circle',
        type: 'circle',
        source: 'building-highlight',
        paint: {
          'circle-radius': 12,
          'circle-color': '#00E5FF',
          'circle-opacity': 0.4,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#00E5FF',
          'circle-stroke-opacity': 0.9,
        },
      })
    })

    const highlightSource = () =>
      map.getSource('parcel-highlight') as maplibregl.GeoJSONSource | undefined

    const buildingHighlightSource = () =>
      map.getSource('building-highlight') as maplibregl.GeoJSONSource | undefined

    // Shared lookup — called by map clicks and search selection
    const doLookup = async (lng: number, lat: number, showLoading = false) => {
      const bounds = map.getBounds()
      const canvas = map.getCanvas()
      const size = { width: canvas.width, height: canvas.height }

      if (showLoading) setParcelLoading(true)

      try {
        const parcel = await identifyParcel(lng, lat, bounds, size)

        if (!parcel) {
          if (!showLoading) {
            clearParcel()
            highlightSource()?.setData({ type: 'FeatureCollection', features: [] })
          } else {
            setParcelResult(null, [])
            highlightSource()?.setData({ type: 'FeatureCollection', features: [] })
          }
          return
        }

        // Query all buildings on the parcel by EGRID (not by click point)
        const buildings = await findBuildingsByEGRID(parcel.egrid)

        setParcelResult(parcel, buildings)
        highlightSource()?.setData({ type: 'Feature', geometry: parcel.geometry, properties: {} })
      } catch {
        if (showLoading) setParcelResult(null, [], true)
      }
    }

    setLookupParcel(doLookup)

    map.on('click', (e) => {
      if (map.getZoom() < CADASTRAL_MIN_ZOOM) return
      doLookup(e.lngLat.lng, e.lngLat.lat, false)
    })

    map.on('mouseenter', 'parcel-highlight-fill', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'parcel-highlight-fill', () => { map.getCanvas().style.cursor = '' })

    // Expose highlight-clear so the panel close button can clear it
    useMapStore.getState().setClearHighlight(() => {
      highlightSource()?.setData({ type: 'FeatureCollection', features: [] })
      buildingHighlightSource()?.setData({ type: 'FeatureCollection', features: [] })
    })

    // Register building hover highlight callback
    useMapStore.getState().setHighlightBuildingFn((geom) => {
      buildingHighlightSource()?.setData(
        geom
          ? { type: 'Feature', geometry: geom, properties: {} }
          : { type: 'FeatureCollection', features: [] }
      )
    })

    // Register parcel highlight restore callback (used when exiting data mode)
    useMapStore.getState().setParcelHighlightFn((geom) => {
      highlightSource()?.setData({ type: 'Feature', geometry: geom, properties: {} })
    })

    mapRef.current = map
    setMapInstance(map)

    return () => {
      map.remove()
      mapRef.current = null
      setMapInstance(null)
      setLookupParcel(null)
      clearParcel()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Swap base layer
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = BASE_LAYERS.find((l) => l.id === activeBaseLayerId)
    if (!layer) return

    const swap = () => {
      if (map.getLayer('swisstopo-base')) map.removeLayer('swisstopo-base')
      if (map.getSource('swisstopo-base')) map.removeSource('swisstopo-base')
      map.addSource('swisstopo-base', {
        type: 'raster',
        tiles: [layer.url],
        tileSize: 256,
        attribution: layer.attribution,
      })
      map.addLayer(
        { id: 'swisstopo-base', type: 'raster', source: 'swisstopo-base' },
        map.getLayer('cadastral') ? 'cadastral' : undefined,
      )
    }

    if (mapReadyRef.current) swap()
    else map.once('load', swap)
  }, [activeBaseLayerId])

  // Enforce cadastral visibility whenever dataMode or base layer changes.
  // The TopBar also calls setLayoutProperty directly on click (immediate),
  // but this effect is the safety net for remounts and layer-swap timing.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      if (map.getLayer('cadastral')) {
        map.setLayoutProperty('cadastral', 'visibility', dataMode ? 'none' : 'visible')
      }
    }
    if (mapReadyRef.current) apply()
    else map.once('load', apply)
  }, [dataMode, activeBaseLayerId])

  return <div ref={mapContainer} className="absolute inset-0" />
}

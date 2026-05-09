import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMapStore, BASE_LAYERS } from '../store/mapStore'
import { identifyParcel, identifyGWR } from '../api/geoAdmin'
import type { ParcelFeature, GwrFeature } from '../api/geoAdmin'

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

// ─── Popup HTML builders ───────────────────────────────────────────────────

function row(label: string, value: string | number | null) {
  if (value == null || value === '—') return ''
  return `<tr><td class="popup-label">${label}</td><td class="popup-value">${value}</td></tr>`
}

function buildPopupHTML(parcel: ParcelFeature | null, gwr: GwrFeature | null): string {
  if (!parcel) return '<div class="popup-body"><p class="popup-empty">No parcel found at this location.</p></div>'

  const gwrSection = gwr
    ? `<div class="popup-section">
        <div class="popup-section-title">Building (GWR)</div>
        <table class="popup-table">
          ${row('Address', gwr.address)}
          ${row('Municipality', `${gwr.municipality} (${gwr.canton})`)}
          ${row('Status', gwr.status)}
          ${row('Category', gwr.category)}
          ${row('Built', gwr.constructionYear ?? gwr.constructionPeriod)}
          ${row('Floors', gwr.floors)}
          ${row('Apartments', gwr.apartments)}
          ${row('Footprint', gwr.footprintM2 != null ? `${gwr.footprintM2} m²` : null)}
          ${row('Heating', gwr.heatingSystem)}
          ${row('Heat Energy', gwr.energySourceHeating)}
          ${row('Hot Water', gwr.energySourceHotWater)}
        </table>
      </div>`
    : '<div class="popup-section"><p class="popup-empty">No building data (GWR) at this point.</p></div>'

  return `
    <div class="popup-body">
      <div class="popup-section">
        <div class="popup-section-title">Parcel</div>
        <table class="popup-table">
          ${row('Parcel No.', parcel.parcelNumber)}
          ${row('Canton', parcel.canton)}
          ${row('EGRID', `<span class="popup-mono">${parcel.egrid}</span>`)}
        </table>
      </div>
      ${gwrSection}
    </div>`
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const { activeBaseLayerId, setMapInstance } = useMapStore()
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)

  // Initialize map
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

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      // ── Cadastral overlay (always on, 50% opacity, zoom ≥ 14)
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

      // ── Parcel highlight (GeoJSON, rendered above cadastral)
      map.addSource('parcel-highlight', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'parcel-highlight-fill',
        type: 'fill',
        source: 'parcel-highlight',
        paint: { 'fill-color': '#e94560', 'fill-opacity': 0.25 },
      })
      map.addLayer({
        id: 'parcel-highlight-outline',
        type: 'line',
        source: 'parcel-highlight',
        paint: { 'line-color': '#e94560', 'line-width': 2 },
      })
    })

    // ── Click handler
    map.on('click', async (e) => {
      if (map.getZoom() < CADASTRAL_MIN_ZOOM) return

      const { lng, lat } = e.lngLat
      const bounds = map.getBounds()
      const canvas = map.getCanvas()
      const size = { width: canvas.width, height: canvas.height }

      // Show loading popup immediately
      popupRef.current?.remove()
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '320px', className: 'b3d-popup' })
        .setLngLat([lng, lat])
        .setHTML('<div class="popup-body popup-loading"><span class="popup-spinner"></span> Loading parcel data…</div>')
        .addTo(map)

      try {
        const [parcel, gwr] = await Promise.all([
          identifyParcel(lng, lat, bounds, size),
          identifyGWR(lng, lat, bounds, size),
        ])

        // Update highlight
        const highlightSource = map.getSource('parcel-highlight') as maplibregl.GeoJSONSource | undefined
        if (highlightSource) {
          highlightSource.setData(
            parcel
              ? { type: 'Feature', geometry: parcel.geometry, properties: {} }
              : { type: 'FeatureCollection', features: [] },
          )
        }

        popupRef.current?.setHTML(buildPopupHTML(parcel, gwr))
      } catch {
        popupRef.current?.setHTML('<div class="popup-body"><p class="popup-empty">Error loading data.</p></div>')
      }
    })

    // Pointer cursor when over parcel highlight
    map.on('mouseenter', 'parcel-highlight-fill', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'parcel-highlight-fill', () => { map.getCanvas().style.cursor = '' })

    // Clear highlight when popup is closed
    map.on('closeAllPopups', () => {
      const src = map.getSource('parcel-highlight') as maplibregl.GeoJSONSource | undefined
      src?.setData({ type: 'FeatureCollection', features: [] })
    })

    mapRef.current = map
    setMapInstance(map)

    return () => {
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
      setMapInstance(null)
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
      // Insert below cadastral
      map.addLayer(
        { id: 'swisstopo-base', type: 'raster', source: 'swisstopo-base' },
        map.getLayer('cadastral') ? 'cadastral' : undefined,
      )
    }

    if (map.isStyleLoaded()) swap()
    else map.once('load', swap)
  }, [activeBaseLayerId])

  return <div ref={mapContainer} className="absolute inset-0" />
}

import { useRef } from 'react'
import SearchBar from './SearchBar'
import { useMapStore } from '../store/mapStore'
import { SEPARATOR_W } from '../App'
import type { ParcelFeature, GwrFeature } from '../api/geoAdmin'
import type maplibregl from 'maplibre-gl'

// zoom where ~300m = 2cm at 96 DPI in Switzerland (lat ~47°)
const DATA_MODE_ZOOM = 14.7
const CADASTRAL_LAYER = 'cadastral'

const PAD_NONE = { top: 0, bottom: 0, left: 0, right: 0 }

function setCadastral(map: maplibregl.Map, visible: boolean) {
  if (map.getLayer(CADASTRAL_LAYER)) {
    map.setLayoutProperty(CADASTRAL_LAYER, 'visibility', visible ? 'visible' : 'none')
  }
}

export default function TopBar() {
  const {
    dataMode, setDataMode,
    activeBaseLayerId, setActiveBaseLayer,
    mapInstance, dataPanelWidth,
    selectedParcel, selectedGWR,
    clearHighlight, clearParcel,
    setParcelResult, parcelHighlightFn,
  } = useMapStore()

  const prevLayerRef = useRef(activeBaseLayerId)
  const prevZoomRef = useRef<number | null>(null)
  const prevParcelRef = useRef<ParcelFeature | null>(null)
  const prevGWRRef = useRef<GwrFeature[]>([])

  const handleDataClick = () => {
    if (!dataMode) {
      // ── Save current state ──
      prevLayerRef.current = activeBaseLayerId
      prevParcelRef.current = selectedParcel
      prevGWRRef.current = selectedGWR

      // Combine padding + optional zoom-out into one camera op so center never drifts
      const currentZoom = mapInstance?.getZoom() ?? DATA_MODE_ZOOM
      const panPad = { ...PAD_NONE, left: dataPanelWidth + SEPARATOR_W }
      if (currentZoom > DATA_MODE_ZOOM) {
        prevZoomRef.current = currentZoom
        mapInstance?.easeTo({ padding: panPad, zoom: DATA_MODE_ZOOM, duration: 800 })
      } else {
        prevZoomRef.current = null
        mapInstance?.easeTo({ padding: panPad, duration: 300 })
      }

      // ── Direct map ops ──
      if (mapInstance) setCadastral(mapInstance, false)

      // ── Store updates ──
      setActiveBaseLayer('grau')
      clearHighlight?.()
      clearParcel()
      setDataMode(true)
    } else {
      // ── Capture restore targets ──
      const zoomToRestore = prevZoomRef.current
      prevZoomRef.current = null

      // ── Direct map ops ──
      if (mapInstance) setCadastral(mapInstance, true)

      // ── Store updates ──
      setActiveBaseLayer(prevLayerRef.current)

      if (prevParcelRef.current) {
        setParcelResult(prevParcelRef.current, prevGWRRef.current)
        parcelHighlightFn?.(prevParcelRef.current.geometry)
      }

      setDataMode(false)

      // Combine padding removal + optional zoom restore into one camera op
      mapInstance?.easeTo({
        padding: PAD_NONE,
        ...(zoomToRestore !== null ? { zoom: zoomToRestore } : {}),
        duration: 500,
      })
    }
  }

  return (
    <header className="absolute top-0 left-0 right-0 z-20 flex items-center gap-4 px-4 py-2.5
                       bg-[#0d0d0d]/95 backdrop-blur-md border-b border-white/[0.07]">
      {/* Logo + name */}
      <div className="flex items-center gap-2.5 shrink-0">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
          <rect width="26" height="26" rx="5" fill="white" />
          <path d="M6 19 L13 7 L20 19 M9.5 15 H16.5"
            stroke="#0D0D0D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-white font-semibold tracking-widest text-xs uppercase">Building3D</span>
      </div>

      {/* Search — centred */}
      <div className="flex-1 flex justify-center">
        <SearchBar />
      </div>

      {/* Data button */}
      <button
        onClick={handleDataClick}
        className={[
          'shrink-0 px-3 py-1 rounded-md text-xs font-semibold tracking-wide transition-colors',
          dataMode
            ? 'bg-white text-[#0d0d0d]'
            : 'border border-white/20 text-white/60 hover:border-white/40 hover:text-white/90',
        ].join(' ')}
      >
        Data
      </button>
    </header>
  )
}


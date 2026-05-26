import { useRef, useState, useCallback, useEffect } from 'react'
import SearchBar, { type SearchBarHandle, type SearchSelectEntry } from './SearchBar'
import DataPanel from './DataPanel'
import SettingsPanel from './SettingsPanel'
import { useMapStore } from '../store/mapStore'
import type { ParcelFeature, GwrFeature } from '../api/geoAdmin'
import type maplibregl from 'maplibre-gl'
import { COLLAPSED_W, EXPANDED_W, DATA_W, SEPARATOR_W } from '../constants'

const PAD_NONE = { top: 0, bottom: 0, left: 0, right: 0 }
const RECENT_KEY = 'building3d_recent_searches'
const MAX_RECENT = 10
const ADDRESS_ZOOM = 18

function loadRecent(): SearchSelectEntry[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}
function saveRecent(entries: SearchSelectEntry[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
}
const DATA_MODE_ZOOM = 14.7
const CADASTRAL_LAYER = 'cadastral'

function setCadastral(map: maplibregl.Map, visible: boolean) {
  if (map.getLayer(CADASTRAL_LAYER))
    map.setLayoutProperty(CADASTRAL_LAYER, 'visibility', visible ? 'visible' : 'none')
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect width="26" height="26" rx="5" fill="white" />
      <path d="M6 19 L13 7 L20 19 M9.5 15 H16.5"
        stroke="#0D0D0D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Sidebar() {
  const {
    sidebarCollapsed, setSidebarCollapsed,
    sidebarWidth, setSidebarWidth,
    dataMode, setDataMode,
    activeBaseLayerId, setActiveBaseLayer,
    mapInstance,
    lookupParcel,
    selectedParcel, selectedGWR,
    clearHighlight, clearParcel,
    setParcelResult, parcelHighlightFn,
  } = useMapStore()

  const searchBarRef = useRef<SearchBarHandle>(null)
  const isDragging = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const [settingsMode, setSettingsMode] = useState(false)
  const [recentSearches, setRecentSearches] = useState<SearchSelectEntry[]>(() => loadRecent())

  const handleSearchSelect = useCallback((entry: SearchSelectEntry) => {
    setRecentSearches(prev => {
      const filtered = prev.filter(r => r.label !== entry.label)
      const next = [entry, ...filtered].slice(0, MAX_RECENT)
      saveRecent(next)
      return next
    })
  }, [])

  const handleRecentClick = useCallback((entry: SearchSelectEntry) => {
    if (!mapInstance) return
    const isAddress = entry.origin === 'address'
    const targetZoom = isAddress ? ADDRESS_ZOOM : entry.zoomlevel
    mapInstance.flyTo({ center: [entry.lon, entry.lat], zoom: targetZoom, duration: 1200 })
    if (isAddress) {
      mapInstance.once('moveend', () => lookupParcel?.(entry.lon, entry.lat, true))
    }
  }, [mapInstance, lookupParcel])

  // Data mode save/restore refs
  const prevLayerRef = useRef(activeBaseLayerId)
  const prevZoomRef = useRef<number | null>(null)
  const prevCenterRef = useRef<maplibregl.LngLat | null>(null)
  const prevParcelRef = useRef<ParcelFeature | null>(null)
  const prevGWRRef = useRef<GwrFeature[]>([])
  const prevSidebarWidthRef = useRef<number>(sidebarWidth)

  // Set initial map padding when map first becomes available
  useEffect(() => {
    if (!mapInstance) return
    const w = sidebarCollapsed ? COLLAPSED_W : sidebarWidth
    mapInstance.easeTo({ padding: { ...PAD_NONE, left: w + SEPARATOR_W }, duration: 0 })
  }, [mapInstance]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data mode toggle ──────────────────────────────────────────────────────
  const handleDataClick = () => {
    if (!dataMode) {
      prevLayerRef.current = activeBaseLayerId
      prevCenterRef.current = mapInstance?.getCenter() ?? null
      prevParcelRef.current = selectedParcel
      prevGWRRef.current = selectedGWR
      // Don't overwrite the saved width when switching from settings — it already holds the pre-panel value
      if (!settingsMode) prevSidebarWidthRef.current = sidebarWidth
      setSettingsMode(false)

      setSidebarCollapsed(false)
      setSidebarWidth(DATA_W)

      const currentZoom = mapInstance?.getZoom() ?? DATA_MODE_ZOOM
      const panPad = { ...PAD_NONE, left: DATA_W + SEPARATOR_W }
      if (currentZoom > DATA_MODE_ZOOM) {
        prevZoomRef.current = currentZoom
        mapInstance?.easeTo({ padding: panPad, zoom: DATA_MODE_ZOOM, duration: 800 })
      } else {
        prevZoomRef.current = null
        mapInstance?.easeTo({ padding: panPad, duration: 300 })
      }

      if (mapInstance) setCadastral(mapInstance, false)
      setActiveBaseLayer('grau')
      clearHighlight?.()
      clearParcel()
      setDataMode(true)
    } else {
      const zoomToRestore = prevZoomRef.current
      const widthToRestore = prevSidebarWidthRef.current
      prevZoomRef.current = null

      if (mapInstance) setCadastral(mapInstance, true)
      setActiveBaseLayer(prevLayerRef.current)

      if (prevParcelRef.current) {
        setParcelResult(prevParcelRef.current, prevGWRRef.current)
        parcelHighlightFn?.(prevParcelRef.current.geometry)
      }

      setSidebarWidth(widthToRestore)
      setDataMode(false)

      mapInstance?.easeTo({
        padding: { ...PAD_NONE, left: widthToRestore + SEPARATOR_W },
        ...(prevCenterRef.current ? { center: prevCenterRef.current } : {}),
        ...(zoomToRestore !== null ? { zoom: zoomToRestore } : {}),
        duration: 500,
      })
    }
  }

  // ── Settings mode toggle ──────────────────────────────────────────────────
  const handleSettingsClick = () => {
    if (settingsMode) {
      const widthToRestore = prevSidebarWidthRef.current
      setSidebarWidth(widthToRestore)
      setSettingsMode(false)
      mapInstance?.easeTo({ padding: { ...PAD_NONE, left: widthToRestore + SEPARATOR_W }, duration: 500 })
    } else {
      // Exit data mode first if active (restores map state; prevSidebarWidthRef already holds pre-data width)
      if (dataMode) handleDataClick()
      // Only save width when coming from normal mode; from data mode the ref is already correct
      if (!dataMode) prevSidebarWidthRef.current = sidebarWidth
      setSidebarCollapsed(false)
      setSidebarWidth(DATA_W)
      setSettingsMode(true)
      mapInstance?.easeTo({ padding: { ...PAD_NONE, left: DATA_W + SEPARATOR_W }, duration: 300 })
    }
  }

  // ── Collapse / expand ─────────────────────────────────────────────────────
  const handleToggleCollapse = () => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false)
      mapInstance?.easeTo({ padding: { ...PAD_NONE, left: sidebarWidth + SEPARATOR_W }, duration: 300 })
    } else {
      setSidebarCollapsed(true)
      mapInstance?.easeTo({ padding: { ...PAD_NONE, left: COLLAPSED_W + SEPARATOR_W }, duration: 300 })
    }
  }

  const handleSearchIconClick = () => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false)
      mapInstance?.easeTo({ padding: { ...PAD_NONE, left: sidebarWidth + SEPARATOR_W }, duration: 300 })
      setTimeout(() => searchBarRef.current?.focus(), 310)
    } else {
      searchBarRef.current?.focus()
    }
  }

  // ── Separator drag ────────────────────────────────────────────────────────
  const onSeparatorMouseDown = useCallback(() => {
    isDragging.current = true
    setIsResizing(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [])

  useEffect(() => {
    const minW = EXPANDED_W - 60
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const w = Math.max(minW, Math.min(e.clientX, window.innerWidth - 360))
      setSidebarWidth(w)
      mapInstance?.easeTo({ padding: { ...PAD_NONE, left: w + SEPARATOR_W }, duration: 0 })
    }
    const onMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [mapInstance, setSidebarWidth])

  const currentWidth = sidebarCollapsed ? COLLAPSED_W : sidebarWidth

  return (
    <>
      {/* Sidebar panel */}
      <div
        className="absolute top-0 bottom-0 left-0 z-20 bg-[#0d0d0d]/95 border-r border-white/[0.07] overflow-hidden"
        style={{
          width: currentWidth,
          transition: isResizing ? 'none' : 'width 280ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {sidebarCollapsed ? (
          // ── Collapsed: icon strip ─────────────────────────────────────────
          <div className="flex flex-col items-center pt-2 gap-0.5">
            <button
              onClick={handleToggleCollapse}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-white/35 hover:text-white hover:bg-white/[0.06] transition-colors"
              aria-label="Expand sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>

            <div className="w-6 border-t border-white/[0.07] my-1.5" />

            <button
              onClick={handleSearchIconClick}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-white/35 hover:text-white hover:bg-white/[0.06] transition-colors"
              aria-label="Search"
            >
              <SearchIcon />
            </button>

            <button
              onClick={handleDataClick}
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                dataMode
                  ? 'bg-white text-[#0d0d0d]'
                  : 'text-white/35 hover:text-white hover:bg-white/[0.06]'
              }`}
              aria-label="Data"
            >
              <GridIcon />
            </button>

            <button
              onClick={handleSettingsClick}
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                settingsMode
                  ? 'bg-white text-[#0d0d0d]'
                  : 'text-white/35 hover:text-white hover:bg-white/[0.06]'
              }`}
              aria-label="Settings"
            >
              <GearIcon />
            </button>
          </div>
        ) : (
          // ── Expanded ──────────────────────────────────────────────────────
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header: logo + collapse button */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.07] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Logo />
                <span className="text-white font-semibold tracking-widest text-xs uppercase truncate">
                  Building3D
                </span>
              </div>
              <button
                onClick={handleToggleCollapse}
                className="ml-2 w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-white/30 hover:text-white hover:bg-white/[0.06] transition-colors"
                aria-label="Collapse sidebar"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="px-3 pt-3 pb-2 shrink-0">
              <SearchBar ref={searchBarRef} onSelect={handleSearchSelect} />
            </div>

            {/* Recent searches */}
            {recentSearches.length > 0 && (
              <div className="px-3 pb-2 shrink-0">
                <div className="text-[10px] text-white/25 uppercase tracking-widest px-1 mb-0.5">Recent</div>
                <ul>
                  {recentSearches.map((entry, i) => (
                    <li key={i}>
                      <button
                        onClick={() => handleRecentClick(entry)}
                        className="w-full text-left px-2 py-1 rounded-md text-xs text-white/45 hover:text-white/80 hover:bg-white/[0.05] transition-colors truncate"
                      >
                        {entry.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Spacer — pushes accordion to bottom */}
            <div className="flex-1" />

            {/* Data button */}
            <div className="shrink-0 border-t border-white/[0.07] px-3 pt-2 pb-1.5">
              <button
                onClick={handleDataClick}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold tracking-wide transition-colors ${
                  dataMode
                    ? 'bg-white text-[#0d0d0d]'
                    : 'border border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80'
                }`}
              >
                <GridIcon />
                Data
              </button>
            </div>

            {/* Data panel — inline between Data and Settings buttons */}
            {dataMode && <DataPanel />}

            {/* Settings button */}
            <div className="shrink-0 border-t border-white/[0.07] px-3 pt-1.5 pb-3">
              <button
                onClick={handleSettingsClick}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold tracking-wide transition-colors ${
                  settingsMode
                    ? 'bg-white text-[#0d0d0d]'
                    : 'border border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80'
                }`}
              >
                <GearIcon />
                Settings
              </button>
            </div>

            {/* Settings panel — below Settings button */}
            {settingsMode && <SettingsPanel />}
          </div>
        )}
      </div>

      {/* Separator — hidden when collapsed to avoid floating handle */}
      {!sidebarCollapsed && (
        <div
          className="absolute top-0 bottom-0 z-20 w-1 cursor-col-resize bg-white/[0.07] hover:bg-white/20 transition-colors"
          style={{ left: sidebarWidth }}
          onMouseDown={onSeparatorMouseDown}
        />
      )}
    </>
  )
}

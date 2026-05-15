import { useRef, useEffect, useCallback } from 'react'
import MapView from './components/MapView'
import TopBar from './components/TopBar'
import LayerSwitcher from './components/LayerSwitcher'
import ParcelPanel from './components/ParcelPanel'
import DataPanel from './components/DataPanel'
import { useMapStore } from './store/mapStore'

export const SEPARATOR_W = 4

export default function App() {
  const { dataMode, mapInstance, dataPanelWidth, setDataPanelWidth } = useMapStore()
  const isDragging = useRef(false)

  const onSeparatorMouseDown = useCallback(() => {
    isDragging.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const w = Math.max(240, Math.min(e.clientX, window.innerWidth - 360))
      setDataPanelWidth(w)
      // Update map padding immediately (no animation) so it tracks the drag handle
      mapInstance?.easeTo({
        padding: { top: 0, bottom: 0, left: w + SEPARATOR_W, right: 0 },
        duration: 0,
      })
    }
    const onMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [mapInstance, setDataPanelWidth])

  return (
    <div className="relative w-full h-full">
      {/* Map — always full-width; MapLibre padding shifts the visible area */}
      <div className="absolute inset-0">
        <MapView />
      </div>

      <TopBar />
      <LayerSwitcher />
      <ParcelPanel />

      {dataMode && (
        <>
          {/* Left panel — overlaps map; map padding compensates */}
          <div
            className="absolute top-0 bottom-0 left-0 z-10 bg-[#0d0d0d]/95 border-r border-white/[0.07]"
            style={{ width: dataPanelWidth }}
          >
            <DataPanel />
          </div>

          {/* Draggable separator */}
          <div
            className="absolute top-0 bottom-0 z-10 w-1 cursor-col-resize bg-white/[0.07] hover:bg-white/20 transition-colors"
            style={{ left: dataPanelWidth }}
            onMouseDown={onSeparatorMouseDown}
          />
        </>
      )}
    </div>
  )
}

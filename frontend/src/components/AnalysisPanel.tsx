import { useState, useRef, useEffect, useCallback } from 'react'
import { useMapStore } from '../store/mapStore'
import { COLLAPSED_W, SEPARATOR_W } from '../constants'
import BuildingViewer3D from './BuildingViewer3D'
import AnalysisModules from './AnalysisModules'
import type { AutoTileStatus } from '../hooks/useAutoTileDownload'

export default function AnalysisPanel({ autoTileStatus }: { autoTileStatus: AutoTileStatus }) {
  const { sidebarCollapsed, sidebarWidth, sidebarResizing,
          setAnalysisMode } = useMapStore()

  const [leftPct, setLeftPct] = useState(33.33)
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const leftPx = sidebarCollapsed
    ? COLLAPSED_W + SEPARATOR_W
    : sidebarWidth + SEPARATOR_W

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.max(30, Math.min(80, pct)))
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
  }, [])

  return (
    <div
      ref={containerRef}
      className="absolute top-0 bottom-0 right-0 z-20 flex"
      style={{
        left: leftPx,
        transition: sidebarResizing ? 'none' : 'left 280ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {/* Left panel — analysis modules */}
      <div
        className="h-full shrink-0 overflow-hidden"
        style={{ width: `${leftPct}%` }}
      >
        <AnalysisModules />
      </div>

      {/* Draggable vertical divider */}
      <div
        className="w-1 h-full cursor-col-resize bg-white/[0.07] hover:bg-white/20 shrink-0 transition-colors"
        onMouseDown={onDividerMouseDown}
      />

      {/* Right panel — 3D viewer */}
      <div className="flex-1 h-full bg-[#080808] flex flex-col overflow-hidden">
        <div className="flex items-center justify-end px-4 py-3 border-b border-white/[0.06] shrink-0">
          <button
            onClick={() => setAnalysisMode(false)}
            className="flex items-center gap-1.5 text-[11px] text-white/35 hover:text-white transition-colors"
            aria-label="Close analysis"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor"
              strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Close Analysis
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <BuildingViewer3D autoTileStatus={autoTileStatus} />
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { useMapStore } from '../store/mapStore'
import type { GwrFeature } from '../api/geoAdmin'

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '—' || value === '') return null
  return (
    <tr>
      <td className="text-[11px] text-white/30 pr-3 pb-1 align-top whitespace-nowrap">{label}</td>
      <td className="text-[12px] text-white pb-1 align-top break-words">{value}</td>
    </tr>
  )
}

function BuildingRows({ b }: { b: GwrFeature }) {
  return (
    <table className="w-full border-collapse">
      <tbody>
        <Row label="Address"      value={b.address} />
        <Row label="Municipality" value={`${b.municipality} (${b.canton})`} />
        <Row label="Status"       value={b.status} />
        <Row label="Category"     value={b.category} />
        <Row label="Built"        value={b.constructionYear ?? b.constructionPeriod} />
        <Row label="Floors"       value={b.floors} />
        <Row label="Apartments"   value={b.apartments} />
        <Row label="Footprint"    value={b.footprintM2 != null ? `${b.footprintM2} m²` : null} />
        <Row label="Heating"      value={b.heatingSystem} />
        <Row label="Heat energy"  value={b.energySourceHeating} />
        <Row label="Hot water"    value={b.energySourceHotWater} />
      </tbody>
    </table>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-white/40 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
      strokeLinejoin="round" viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export default function ParcelPanel() {
  const { parcelLoading, selectedParcel, selectedGWR, parcelError,
          clearParcel, clearHighlight, setHighlightBuilding } = useMapStore()
  const [expandedEgids, setExpandedEgids] = useState<Set<string>>(new Set())

  // Drag state
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: 12,
    y: typeof window !== 'undefined' ? window.innerHeight - 400 : 100,
  }))
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    e.preventDefault()
  }, [pos])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const x = Math.max(0, Math.min(e.clientX - dragOffset.current.x, window.innerWidth - 280))
      const y = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - 60))
      setPos({ x, y })
    }
    const onUp = () => { dragging.current = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Reset accordion when a new parcel is selected — first building open by default
  useEffect(() => {
    if (selectedGWR.length > 0) {
      const firstKey = selectedGWR[0].egid !== '—' ? selectedGWR[0].egid : '0'
      setExpandedEgids(new Set([firstKey]))
    } else {
      setExpandedEgids(new Set())
    }
  }, [selectedGWR])

  const toggleBuilding = (key: string) => {
    setExpandedEgids(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visible = parcelLoading || selectedParcel !== null || parcelError

  if (!visible) return null

  return (
    <div
      className="z-20 w-[280px] bg-[#161616] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
    >

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] cursor-grab select-none"
        onMouseDown={onHeaderMouseDown}
      >
        <span className="text-[10px] font-bold tracking-widest uppercase text-white/40">
          Parcel Info
        </span>
        <button
          onClick={() => { clearParcel(); clearHighlight?.() }}
          className="text-white/25 hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Loading */}
      {parcelLoading && (
        <div className="flex items-center gap-2.5 px-4 py-4 text-white/30 text-[12px]">
          <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-white/10
                           border-t-accent animate-spin" />
          Loading parcel data…
        </div>
      )}

      {/* Error */}
      {!parcelLoading && parcelError && (
        <p className="px-4 py-4 text-[12px] text-white/30 italic">Error loading data.</p>
      )}

      {/* No parcel */}
      {!parcelLoading && !parcelError && selectedParcel === null && (
        <p className="px-4 py-4 text-[12px] text-white/30 italic">No parcel found at this location.</p>
      )}

      {/* Data */}
      {!parcelLoading && !parcelError && selectedParcel && (
        <div
          className="overflow-y-auto"
          style={{ maxHeight: `calc(100vh - ${pos.y + 60}px)` }}
        >

          {/* Parcel section */}
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <p className="text-[9px] font-bold tracking-[0.1em] uppercase text-accent mb-2">Parcel</p>
            <table className="w-full border-collapse">
              <tbody>
                <Row label="Parcel No." value={selectedParcel.parcelNumber} />
                <Row label="Canton"     value={selectedParcel.canton} />
                <Row label="EGRID"      value={selectedParcel.egrid} />
                <Row label="Buildings"  value={selectedGWR.length > 0 ? selectedGWR.length : null} />
              </tbody>
            </table>
          </div>

          {/* Buildings section */}
          <div>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
              <p className="text-[9px] font-bold tracking-[0.1em] uppercase text-accent">
                Buildings (GWR)
              </p>
              {selectedGWR.length > 1 && (
                <span className="text-[9px] text-white/30">{selectedGWR.length} found</span>
              )}
            </div>

            {selectedGWR.length === 0 ? (
              <p className="px-4 py-3 text-[11px] text-white/25 italic">
                No building data (GWR) for this parcel.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {selectedGWR.map((b, i) => {
                  const key = b.egid !== '—' ? b.egid : String(i)
                  const isOpen = expandedEgids.has(key)
                  const label = b.address !== '—' ? b.address : `Building ${i + 1}`
                  return (
                    <div key={key}>
                      <button
                        onClick={() => toggleBuilding(key)}
                        onMouseEnter={() => setHighlightBuilding?.(b.geometry ?? null)}
                        onMouseLeave={() => setHighlightBuilding?.(null)}
                        className="w-full flex items-center justify-between px-4 py-2.5
                                   text-left hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="min-w-0">
                          <span className="text-[11px] text-white/80 block truncate">{label}</span>
                          <span className="text-[9px] text-white/30">EGID {b.egid}</span>
                        </div>
                        <ChevronIcon open={isOpen} />
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-3">
                          <BuildingRows b={b} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

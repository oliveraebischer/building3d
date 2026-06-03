import { useState, useEffect, useRef, useCallback } from 'react'
import { useMapStore } from '../store/mapStore'
import type { PortfolioEntry, PortfolioStatus } from '../store/mapStore'
import type { GwrFeature } from '../api/geoAdmin'
import { fetchBuildings, fetchNeighborBuildings } from '../api/buildings'
import type { BuildingFeatureCollection } from '../api/buildings'

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
          clearParcel, clearHighlight, setHighlightBuilding, mapInstance,
          portfolio, addToPortfolio, removeFromPortfolio, savePortfolioSnapshot,
          setAnalysisMode } = useMapStore()
  const [expandedEgids, setExpandedEgids] = useState<Set<string>>(new Set())

  // Portfolio add state: 'idle' | 'selecting' | 'labeling' | 'done'
  const [portfolioState, setPortfolioState] = useState<'idle' | 'selecting' | 'labeling' | 'done'>('idle')
  const [checkedEgids, setCheckedEgids] = useState<Set<string>>(new Set())
  const [pendingBuildings, setPendingBuildings] = useState<GwrFeature[]>([])
  const [entryLabel, setEntryLabel] = useState('')
  const [entryStatus, setEntryStatus] = useState<PortfolioStatus>('watch')

  // Reset portfolio UI when parcel changes
  useEffect(() => {
    setPortfolioState('idle')
    setCheckedEgids(new Set())
    setPendingBuildings([])
  }, [selectedParcel?.egrid])

  // Reflect existing portfolio membership
  useEffect(() => {
    if (!selectedParcel) return
    const inPortfolio = portfolio.some(e => e.parcel.egrid === selectedParcel.egrid)
    setPortfolioState(inPortfolio ? 'done' : 'idle')
  }, [selectedParcel?.egrid, portfolio])

  const goToLabeling = (buildings: GwrFeature[]) => {
    const firstAddr = buildings[0]?.address
    setEntryLabel(firstAddr && firstAddr !== '—' ? firstAddr : '')
    setEntryStatus('watch')
    setPendingBuildings(buildings)
    setPortfolioState('labeling')
  }

  const confirmAdd = () => {
    if (!selectedParcel) return
    const egrid = selectedParcel.egrid
    const entry: PortfolioEntry = {
      parcel: selectedParcel,
      buildings: pendingBuildings,
      addedAt: new Date().toISOString(),
      label: entryLabel.trim() || undefined,
      status: entryStatus,
    }
    addToPortfolio(entry)
    setPortfolioState('done')
    setCheckedEgids(new Set())
    setPendingBuildings([])

    // Async snapshot capture — runs in background after entry is created
    const egids = pendingBuildings.map(b => b.egid).filter(e => e !== '—')
    const coords = (selectedParcel.geometry.coordinates as [number, number][][]).flat()
    const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1])
    const bbox: [number, number, number, number] = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
    const pad = 1.0
    const nBbox: [number, number, number, number] = [
      bbox[0] - (bbox[2] - bbox[0]) * pad, bbox[1] - (bbox[3] - bbox[1]) * pad,
      bbox[2] + (bbox[2] - bbox[0]) * pad, bbox[3] + (bbox[3] - bbox[1]) * pad,
    ]
    const empty: BuildingFeatureCollection = { type: 'FeatureCollection', features: [] }
    Promise.all([
      egids.length > 0 ? fetchBuildings(egids, bbox) : Promise.resolve(empty),
      fetchNeighborBuildings(nBbox).catch(() => empty),
    ]).then(([buildingGeometries, neighborGeometries]) => {
      savePortfolioSnapshot(egrid, { buildingGeometries, neighborGeometries, snapshotAt: new Date().toISOString() })
    }).catch(() => { /* silent fail — snapshot unavailable */ })
  }

  const handleAddClick = () => {
    if (selectedGWR.length <= 1) {
      goToLabeling(selectedGWR)
    } else {
      setCheckedEgids(new Set(selectedGWR.map((b, i) => b.egid !== '—' ? b.egid : String(i))))
      setPendingBuildings([])
      setPortfolioState('selecting')
    }
  }

  const toggleCheck = (key: string) => {
    setCheckedEgids(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Drag state — initial value is offscreen; snapped to SE corner on parcel load
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth * 0.65 : 800,
    y: typeof window !== 'undefined' ? window.innerHeight * 0.65 : 500,
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

  // Snap panel to SE corner of parcel bounding box on each new parcel selection
  useEffect(() => {
    if (!selectedParcel || !mapInstance) return
    const coords = (selectedParcel.geometry.coordinates as [number, number][][]).flat()
    const maxLng = Math.max(...coords.map(c => c[0]))
    const minLat = Math.min(...coords.map(c => c[1]))
    const pt = mapInstance.project([maxLng, minLat])
    const PANEL_W = 280
    const GAP = 10
    const x = Math.min(pt.x + GAP, window.innerWidth - PANEL_W - GAP)
    const y = Math.min(pt.y + GAP, window.innerHeight - 60)
    setPos({ x: Math.max(GAP, x), y: Math.max(GAP, y) })
  }, [selectedParcel, mapInstance])

  // Reset accordion when a new parcel is selected — all collapsed by default
  useEffect(() => {
    setExpandedEgids(new Set())
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

          {/* Portfolio action */}
          <div className="px-4 py-2.5 border-b border-white/[0.06]">
            {portfolioState === 'done' ? (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-accent/80">✓ In Portfolio</span>
                <button
                  onClick={() => { removeFromPortfolio(selectedParcel.egrid); setPortfolioState('idle') }}
                  className="text-[10px] text-white/30 hover:text-white/70 transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : portfolioState === 'selecting' ? (
              <div>
                <p className="text-[9px] font-bold tracking-widest uppercase text-white/30 mb-2">
                  Select buildings
                </p>
                <div className="space-y-1 mb-2">
                  {selectedGWR.map((b, i) => {
                    const key = b.egid !== '—' ? b.egid : String(i)
                    const label = b.address !== '—' ? b.address : `Building ${i + 1}`
                    return (
                      <label key={key} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={checkedEgids.has(key)}
                          onChange={() => toggleCheck(key)}
                          className="accent-[#00E5FF] w-3 h-3"
                        />
                        <span className="text-[11px] text-white/60 group-hover:text-white/80 truncate transition-colors">
                          {label}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => goToLabeling(selectedGWR)}
                    className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                  >
                    Add all
                  </button>
                  <button
                    onClick={() => {
                      const selected = selectedGWR.filter((b, i) =>
                        checkedEgids.has(b.egid !== '—' ? b.egid : String(i))
                      )
                      if (selected.length > 0) goToLabeling(selected)
                    }}
                    disabled={checkedEgids.size === 0}
                    className="flex-1 px-2 py-1 rounded-md bg-accent/10 text-accent text-[10px] font-semibold
                               hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setPortfolioState('idle')}
                    className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : portfolioState === 'labeling' ? (
              <div className="space-y-2">
                <p className="text-[9px] font-bold tracking-widest uppercase text-white/30">
                  Add to Portfolio
                </p>
                <input
                  type="text"
                  value={entryLabel}
                  onChange={e => setEntryLabel(e.target.value)}
                  placeholder="Label (optional)"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-md px-2.5 py-1.5
                             text-[11px] text-white/80 placeholder-white/20 outline-none
                             focus:border-accent/40 transition-colors"
                />
                <div className="flex flex-wrap gap-1">
                  {(['watch', 'due-diligence', 'active', 'on-hold'] as PortfolioStatus[]).map(s => {
                    const labels: Record<PortfolioStatus, string> = {
                      watch: 'Watch', 'due-diligence': 'Due Dil.', active: 'Active', 'on-hold': 'On Hold', divested: 'Divested',
                    }
                    return (
                      <button
                        key={s}
                        onClick={() => setEntryStatus(s)}
                        className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                          entryStatus === s
                            ? 'bg-accent/20 text-accent'
                            : 'bg-white/[0.05] text-white/30 hover:bg-white/10 hover:text-white/50'
                        }`}
                      >
                        {labels[s]}
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2 pt-0.5">
                  <button
                    onClick={() => setPortfolioState('idle')}
                    className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmAdd}
                    className="flex-1 px-2 py-1 rounded-md bg-accent/10 text-accent text-[10px] font-semibold
                               hover:bg-accent/20 transition-colors"
                  >
                    Save to Portfolio
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleAddClick}
                className="w-full text-left text-[11px] text-white/40 hover:text-accent/80
                           transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add to Portfolio
              </button>
            )}
          </div>

          {/* Analysis entry */}
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <button
              onClick={() => setAnalysisMode(true)}
              className="w-full py-2 rounded-lg bg-accent text-[#0d0d0d] text-[12px] font-bold
                         tracking-wide hover:bg-accent/90 active:scale-[0.98] transition-all"
            >
              Analyse
            </button>
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

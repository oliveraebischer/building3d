import { useState, useRef, useEffect } from 'react'
import { useMapStore } from '../store/mapStore'
import type { PortfolioEntry, PortfolioStatus } from '../store/mapStore'
import ConfirmDialog from './ui/ConfirmDialog'

type StatusFilter = 'all' | PortfolioStatus

const STATUS_CONFIG: Record<PortfolioStatus, {
  label: string
  shortLabel: string
  dot: string
  text: string
  activePill: string
}> = {
  watch:           { label: 'Watch',          shortLabel: 'Watch', dot: 'bg-white/30',         text: 'text-white/40',       activePill: 'bg-white/10 text-white/60' },
  'due-diligence': { label: 'Due Diligence',  shortLabel: 'DD',    dot: 'bg-amber-400/60',     text: 'text-amber-400/70',   activePill: 'bg-amber-400/10 text-amber-400/80' },
  active:          { label: 'Active',         shortLabel: 'Active',dot: 'bg-emerald-400/60',   text: 'text-emerald-400/70', activePill: 'bg-emerald-400/10 text-emerald-400/80' },
  'on-hold':       { label: 'On Hold',        shortLabel: 'Hold',  dot: 'bg-orange-400/60',    text: 'text-orange-400/70',  activePill: 'bg-orange-400/10 text-orange-400/80' },
  divested:        { label: 'Divested',       shortLabel: 'Sold',  dot: 'bg-white/15',         text: 'text-white/25',       activePill: 'bg-white/5 text-white/35' },
}

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as PortfolioStatus[]

function centroid(poly: GeoJSON.Polygon): [number, number] {
  const pts = poly.coordinates.flat() as [number, number][]
  return [
    pts.reduce((s, c) => s + c[0], 0) / pts.length,
    pts.reduce((s, c) => s + c[1], 0) / pts.length,
  ]
}

function StatusDot({ status }: { status: PortfolioStatus }) {
  const cfg = STATUS_CONFIG[status]
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
}

function EntryCard({ entry, onRemove }: { entry: PortfolioEntry; onRemove: () => void }) {
  const {
    mapInstance, portfolioHighlightFn,
    setParcelResult, setPortfolioSnapshotGeometries,
    analysisMode, setAnalysisMode,
    projectMode, setProjectMode,
    selectedParcel,
    updatePortfolioEntry,
    portfolioPinClickedEgrid, setPortfolioPinClickedEgrid,
    portfolioHoveredBuildingEgid, setPortfolioHoveredBuildingEgid,
    projects, setPromoteToProjectEgrids,
  } = useMapStore()

  const [confirmingExit, setConfirmingExit] = useState(false)

  const inProject = projects.some(p => p.members.some(m => m.sourcePortfolioEgrid === entry.parcel.egrid))

  const status = entry.status ?? 'watch'
  const cfg = STATUS_CONFIG[status]

  const defaultLabel = entry.label
    ?? (entry.buildings[0]?.address !== '—' ? entry.buildings[0]?.address : null)
    ?? `Parcel ${entry.parcel.parcelNumber}`

  const [open, setOpen] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(defaultLabel)
  const [notesDraft, setNotesDraft] = useState(entry.notes ?? '')
  const labelInputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Sync label draft when entry changes (e.g. after external update)
  useEffect(() => {
    if (!editingLabel) setLabelDraft(defaultLabel)
  }, [defaultLabel, editingLabel])

  useEffect(() => {
    if (!open) setNotesDraft(entry.notes ?? '')
  }, [entry.notes, open])

  useEffect(() => {
    if (editingLabel) labelInputRef.current?.focus()
  }, [editingLabel])

  // Scroll into view + expand when this entry was clicked via a map pin
  useEffect(() => {
    if (portfolioPinClickedEgrid !== entry.parcel.egrid) return
    setOpen(true)
    // Delay scroll until the portfolio panel has finished opening (300ms transition)
    const t = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      setPortfolioPinClickedEgrid(null)
    }, 320)
    return () => clearTimeout(t)
  }, [portfolioPinClickedEgrid]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveLabel = () => {
    const trimmed = labelDraft.trim()
    updatePortfolioEntry(entry.parcel.egrid, { label: trimmed || undefined })
    setEditingLabel(false)
  }

  const saveNotes = () => {
    updatePortfolioEntry(entry.parcel.egrid, { notes: notesDraft.trim() || undefined })
  }

  const flyTo = () => {
    if (!mapInstance) return
    const [lng, lat] = centroid(entry.parcel.geometry)
    mapInstance.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 })
    portfolioHighlightFn?.([entry.parcel.geometry])
  }

  // Analysis/Project are full-screen overlays that hide the map — flying to a
  // different parcel underneath would be invisible, so confirm exiting first.
  const needsExitConfirm = projectMode || (analysisMode && selectedParcel?.egrid !== entry.parcel.egrid)

  const exitAndZoom = () => {
    setAnalysisMode(false)
    setProjectMode(false)
    setOpen(true)
    flyTo()
  }

  const handleCardClick = () => {
    if (needsExitConfirm) { setConfirmingExit(true); return }
    setOpen(o => !o)
    flyTo()
  }

  const handleFlyToClick = () => {
    if (needsExitConfirm) { setConfirmingExit(true); return }
    flyTo()
  }

  const handleAnalyse = () => {
    if (entry.snapshot) {
      setPortfolioSnapshotGeometries({
        own: entry.snapshot.buildingGeometries,
        neighbors: entry.snapshot.neighborGeometries,
      })
    }
    setParcelResult(entry.parcel, entry.buildings)
    portfolioHighlightFn?.([entry.parcel.geometry])
    const [lng, lat] = centroid(entry.parcel.geometry)
    mapInstance?.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 })
    setAnalysisMode(true)
  }

  return (
    <div ref={cardRef} className="border-b border-white/[0.05] last:border-0">
      {/* Card header */}
      <div className="flex items-center group">
        <button
          onClick={handleCardClick}
          className="flex-1 min-w-0 flex items-start gap-2 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
        >
          <StatusDot status={status} />
          <div className="min-w-0 flex-1">
            {editingLabel ? (
              <input
                ref={labelInputRef}
                value={labelDraft}
                onChange={e => setLabelDraft(e.target.value)}
                onBlur={saveLabel}
                onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditingLabel(false) }}
                onClick={e => e.stopPropagation()}
                className="w-full bg-white/[0.07] border border-accent/30 rounded px-1.5 py-0.5
                           text-[11px] text-white/90 outline-none"
              />
            ) : (
              <span
                className="text-[11px] text-white/80 block truncate cursor-text"
                onDoubleClick={e => { e.stopPropagation(); setEditingLabel(true) }}
                title="Double-click to edit"
              >
                {defaultLabel}
              </span>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-white/25">
                {entry.parcel.parcelNumber} · {entry.parcel.canton}
                {entry.buildings.length > 0 && ` · ${entry.buildings.length} bldg`}
              </span>
              {entry.snapshot && (
                <span
                  className="w-1 h-1 rounded-full bg-emerald-400/50 shrink-0"
                  title="Snapshot cached"
                />
              )}
              {inProject && (
                <span
                  className="text-[8px] px-1 py-px rounded bg-white/[0.06] text-white/30 shrink-0 uppercase tracking-wider"
                  title="Part of a project"
                >
                  Project
                </span>
              )}
            </div>
          </div>
          <svg
            className={`w-3 h-3 text-white/25 shrink-0 mt-0.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={handleAnalyse}
            className="px-1.5 py-1 text-[9px] font-semibold text-accent/60 hover:text-accent transition-colors rounded hover:bg-accent/10"
            title="Open analysis"
          >
            Analyse
          </button>
          <button
            onClick={e => { e.stopPropagation(); setPromoteToProjectEgrids([entry.parcel.egrid]) }}
            className="px-1.5 py-1 text-[9px] font-semibold text-white/30 hover:text-white/70 transition-colors rounded hover:bg-white/10 whitespace-nowrap"
            title="Promote to a new project"
          >
            → Project
          </button>
          <button
            onClick={e => { e.stopPropagation(); handleFlyToClick() }}
            className="p-1 text-white/20 hover:text-white/60 transition-colors rounded"
            title="Fly to"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </button>
          <button
            onClick={onRemove}
            className="p-1 text-white/20 hover:text-white/60 transition-colors rounded"
            title="Remove"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          {/* Status selector */}
          <div>
            <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">Status</p>
            <div className="flex flex-wrap gap-1">
              {ALL_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => updatePortfolioEntry(entry.parcel.egrid, { status: s })}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                    status === s ? cfg.activePill : 'bg-white/5 text-white/25 hover:bg-white/10 hover:text-white/45'
                  }`}
                >
                  <span className={`w-1 h-1 rounded-full ${STATUS_CONFIG[s].dot}`} />
                  {STATUS_CONFIG[s].shortLabel}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">Notes</p>
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              onBlur={saveNotes}
              placeholder="Add notes…"
              rows={2}
              className="w-full bg-white/[0.04] border border-white/[0.07] rounded-md px-2 py-1.5
                         text-[11px] text-white/60 placeholder-white/15 outline-none resize-none
                         focus:border-white/20 transition-colors"
            />
          </div>

          {/* Buildings */}
          {entry.buildings.length > 0 && (
            <div>
              <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">Buildings</p>
              <div className="space-y-0.5">
                {entry.buildings.map((b, i) => {
                  const egid = b.egid !== '—' ? b.egid : null
                  const isHovered = egid !== null && portfolioHoveredBuildingEgid === egid
                  return (
                    <div
                      key={egid ?? i}
                      className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-default transition-colors ${
                        isHovered ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                      }`}
                      onMouseEnter={() => egid && setPortfolioHoveredBuildingEgid(egid)}
                      onMouseLeave={() => setPortfolioHoveredBuildingEgid(null)}
                    >
                      <span className={`text-[11px] truncate transition-colors ${isHovered ? 'text-white/85' : 'text-white/50'}`}>
                        {b.address !== '—' ? b.address : `Building ${i + 1}`}
                      </span>
                      <span className={`text-[10px] shrink-0 transition-colors ${isHovered ? 'text-white/40' : 'text-white/20'}`}>
                        {egid}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmingExit}
        title={projectMode ? 'Exit project?' : 'Exit analysis?'}
        message={`Close the ${projectMode ? 'project' : 'building analysis'} window and zoom into this object in the portfolio?`}
        onConfirm={() => { setConfirmingExit(false); exitAndZoom() }}
        onCancel={() => setConfirmingExit(false)}
      />
    </div>
  )
}

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'watch', label: 'Watch' },
  { key: 'due-diligence', label: 'DD' },
  { key: 'active', label: 'Active' },
  { key: 'on-hold', label: 'Hold' },
  { key: 'divested', label: 'Sold' },
]

export default function PortfolioPanel() {
  const { portfolio, removeFromPortfolio, portfolioPinClickedEgrid } = useMapStore()
  const [filter, setFilter] = useState<StatusFilter>('all')

  // When a map pin is clicked, reset filter so the entry is visible
  useEffect(() => {
    if (portfolioPinClickedEgrid) setFilter('all')
  }, [portfolioPinClickedEgrid])

  const filtered = filter === 'all'
    ? portfolio
    : portfolio.filter(e => (e.status ?? 'watch') === filter)

  const totalBuildings = portfolio.reduce((sum, e) => sum + e.buildings.length, 0)

  return (
    <div className="overflow-y-auto max-h-[50vh] flex flex-col">
      {/* Summary + filter */}
      <div className="px-3 py-2 border-t border-white/[0.05] shrink-0">
        {/* Summary line */}
        <p className="text-[10px] text-white/25 mb-2">
          {portfolio.length} {portfolio.length === 1 ? 'entry' : 'entries'}
          {totalBuildings > 0 && ` · ${totalBuildings} building${totalBuildings !== 1 ? 's' : ''}`}
        </p>
        {/* Status filter tabs */}
        <div className="flex flex-wrap gap-1">
          {FILTER_TABS.map(tab => {
            const count = tab.key === 'all'
              ? portfolio.length
              : portfolio.filter(e => (e.status ?? 'watch') === tab.key).length
            if (tab.key !== 'all' && count === 0) return null
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                  filter === tab.key
                    ? 'bg-white/10 text-white/70'
                    : 'text-white/25 hover:text-white/45 hover:bg-white/5'
                }`}
              >
                {tab.label}
                {count > 0 && <span className="ml-1 text-white/20">{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Entry list */}
      <div className="mx-3 mb-3 rounded-xl border border-white/[0.08] bg-[#161616] overflow-hidden shrink-0">
        {filtered.length === 0 ? (
          <p className="px-4 py-4 text-[11px] text-white/25 italic">
            {portfolio.length === 0
              ? 'No parcels saved yet. Search an address and click "Add to Portfolio".'
              : 'No entries match this filter.'}
          </p>
        ) : (
          filtered.map(entry => (
            <EntryCard
              key={entry.parcel.egrid}
              entry={entry}
              onRemove={() => removeFromPortfolio(entry.parcel.egrid)}
            />
          ))
        )}
      </div>
    </div>
  )
}

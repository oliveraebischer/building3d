import { useState, useEffect, useMemo, useRef } from 'react'
import { useMapStore } from '../store/mapStore'
import type {
  Project, ProjectMember, ProjectStatus, Milestone, Scenario, ScenarioCosts, BkpCode,
} from '../types/project'
import { memberIncludedBuildings, emptyCosts, emptyEnergyPlan } from '../types/project'
import type { BuildingMeasurements } from '../utils/buildingMeasurements'
import { fetchBuildingMeasurements } from '../api/buildings'
import { computeScenarioDeltas } from '../utils/scenarioCalc'
import type { ScenarioDeltas } from '../utils/scenarioCalc'
import {
  calculateGEAK, getDefaultInputs, defaultCOP,
  GEAK_CLASS_COLORS, HEATING_SYSTEMS, USAGES,
} from '../utils/geakCalculation'
import type { GEAKHeatingSystem, GEAKUsage } from '../utils/geakCalculation'
import {
  BKP_MAIN_CODES, BKP2_SUB_CODES, BKP_LABELS,
  estimateBkp, effectiveLines, bkp2Total, totalCost, formatCHF, RATE_CHF_M3,
} from '../utils/bkp'
import {
  SIA_PHASE_LABELS, SIA_BAR_PHASES, estimateDurations, defaultTimeline, phaseSpans, totalWeeks,
} from '../utils/siaPhases'
import {
  suggestedHeatPowerKW, heatSystemCost, suggestedPvKwp, pvCost, PV_DEFAULT_SPECIFIC_YIELD,
} from '../utils/energyCosts'
import { STATUS_ORDER, STATUS_CONFIG, TYPE_LABELS, ALL_TYPES, centroid, memberFromPortfolioEntry } from './projectConfig'
import { ChevronIcon, NumInput, SelInput } from './ui/FormInputs'

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconWrap({ children }: { children: React.ReactNode }) {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      {children}
    </svg>
  )
}
const OverviewIcon = () => <IconWrap><path d="M3 21h18M3 21V7l9-4 9 4v14M9 21v-6h6v6" /></IconWrap>
const ScenarioIcon = () => <IconWrap><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" /></IconWrap>
const CostIcon = () => <IconWrap><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></IconWrap>
const TimelineIcon = () => <IconWrap><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></IconWrap>
const EnergyIcon = () => <IconWrap><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></IconWrap>
const MilestoneIcon = () => <IconWrap><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></IconWrap>

function GeakChip({ cls }: { cls: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold text-[#0d0d0d]"
      style={{ backgroundColor: GEAK_CLASS_COLORS[cls] ?? '#888' }}
    >
      {cls}
    </span>
  )
}

// ─── Module shell (same pattern as AnalysisModules) ───────────────────────────

function Module({ icon, title, summary, defaultOpen = false, children }: {
  icon: React.ReactNode
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-white/[0.06]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="text-accent shrink-0">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[12px] text-white/75 font-medium">{title}</span>
          {summary && <span className="block text-[10px] text-white/30 truncate">{summary}</span>}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// ─── Status stepper ────────────────────────────────────────────────────────────

function StatusStepper({ status, onChange }: { status: ProjectStatus; onChange: (s: ProjectStatus) => void }) {
  const currentIdx = STATUS_ORDER.indexOf(status)
  return (
    <div className="flex items-center">
      {STATUS_ORDER.map((s, i) => {
        const cfg = STATUS_CONFIG[s]
        const reached = i <= currentIdx
        return (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => onChange(s)}
              className="flex flex-col items-center gap-1 group"
              title={cfg.label}
            >
              <span
                className="w-2.5 h-2.5 rounded-full border transition-colors"
                style={reached
                  ? { backgroundColor: cfg.hex, borderColor: cfg.hex }
                  : { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.15)' }}
              />
              <span className={`text-[8px] uppercase tracking-wider transition-colors ${
                i === currentIdx ? 'text-white/70 font-semibold' : reached ? 'text-white/40' : 'text-white/20 group-hover:text-white/40'
              }`}>
                {cfg.label}
              </span>
            </button>
            {i < STATUS_ORDER.length - 1 && (
              <div className={`flex-1 h-px mx-1 mb-3.5 ${i < currentIdx ? 'bg-white/30' : 'bg-white/[0.08]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Members ───────────────────────────────────────────────────────────────────

function MemberCard({ project, member }: { project: Project; member: ProjectMember }) {
  const {
    updateProject, mapInstance, portfolioHighlightFn, portfolio,
    setParcelResult, setPortfolioSnapshotGeometries, setAnalysisMode,
  } = useMapStore()

  const flyTo = () => {
    if (!mapInstance) return
    const [lng, lat] = centroid(member.parcel.geometry)
    mapInstance.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 })
    portfolioHighlightFn?.([member.parcel.geometry])
  }

  const analyse = () => {
    const source = portfolio.find(e => e.parcel.egrid === member.sourcePortfolioEgrid)
    if (source?.snapshot) {
      setPortfolioSnapshotGeometries({
        own: source.snapshot.buildingGeometries,
        neighbors: source.snapshot.neighborGeometries,
      })
    }
    setParcelResult(member.parcel, member.buildings)
    portfolioHighlightFn?.([member.parcel.geometry])
    const [lng, lat] = centroid(member.parcel.geometry)
    mapInstance?.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 })
    setAnalysisMode(true) // closes project mode (mutually exclusive)
  }

  const toggleBuilding = (egid: string) => {
    const allEgids = member.buildings.map(b => b.egid)
    const current = member.includedEgids ?? allEgids
    const next = current.includes(egid) ? current.filter(id => id !== egid) : [...current, egid]
    const nextMembers = project.members.map(m =>
      m.parcel.egrid === member.parcel.egrid
        ? { ...m, includedEgids: next.length === allEgids.length ? null : next }
        : m,
    )
    updateProject(project.id, { members: nextMembers })
  }

  const removeMember = () => {
    updateProject(project.id, { members: project.members.filter(m => m.parcel.egrid !== member.parcel.egrid) })
  }

  const included = member.includedEgids
  return (
    <div className="rounded-md border border-white/[0.06] px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-1.5 group">
        <span className="text-[10px] text-white/50 truncate flex-1">
          {member.parcel.parcelNumber} · {member.parcel.canton}
        </span>
        <button
          onClick={analyse}
          className="px-1.5 py-0.5 text-[9px] font-semibold text-accent/60 hover:text-accent rounded hover:bg-accent/10 transition-colors shrink-0"
          title="Open analysis for this parcel"
        >
          Analyse
        </button>
        <button
          onClick={flyTo}
          className="p-0.5 text-white/20 hover:text-white/60 transition-colors shrink-0"
          title="Fly to"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </button>
        <button
          onClick={removeMember}
          className="p-0.5 text-white/20 hover:text-white/60 transition-colors shrink-0"
          title="Remove from project"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {member.buildings.length > 0 && (
        <div className="space-y-0.5">
          {member.buildings.map((b, i) => {
            const isIncluded = included === null || included.includes(b.egid)
            return (
              <button
                key={b.egid !== '—' ? b.egid : i}
                onClick={() => toggleBuilding(b.egid)}
                className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-white/[0.04] transition-colors"
                title={isIncluded ? 'Exclude from project' : 'Include in project'}
              >
                <span className={`w-2.5 h-2.5 rounded-sm border shrink-0 flex items-center justify-center transition-colors ${
                  isIncluded ? 'bg-white/60 border-white/60' : 'border-white/20'
                }`}>
                  {isIncluded && (
                    <svg className="w-1.5 h-1.5 text-[#0d0d0d]" fill="none" stroke="currentColor" strokeWidth={4}
                      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </span>
                <span className={`text-[10px] truncate flex-1 text-left ${isIncluded ? 'text-white/55' : 'text-white/25'}`}>
                  {b.address !== '—' ? b.address : `Building ${i + 1}`}
                </span>
                <span className="text-[9px] text-white/20 shrink-0">{b.egid !== '—' ? b.egid : ''}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Overview module ───────────────────────────────────────────────────────────

function OverviewModule({ project }: { project: Project }) {
  const { updateProject, removeProject, setProjectMode, setActiveProjectId, portfolio } = useMapStore()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(project.name)
  const [notesDraft, setNotesDraft] = useState(project.notes ?? '')
  const [addingMember, setAddingMember] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editingName) nameInputRef.current?.focus() }, [editingName])
  useEffect(() => { setNotesDraft(project.notes ?? '') }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed) updateProject(project.id, { name: trimmed })
    setEditingName(false)
  }

  const availableEntries = portfolio.filter(
    e => !project.members.some(m => m.parcel.egrid === e.parcel.egrid),
  )

  return (
    <div className="space-y-3">
      {/* Name + delete */}
      <div className="flex items-center gap-1.5">
        {editingName ? (
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
            className="flex-1 min-w-0 bg-white/[0.07] border border-accent/30 rounded px-1.5 py-0.5
                       text-[11px] text-white/90 outline-none"
          />
        ) : (
          <span
            className="text-[12px] text-white/85 font-medium truncate flex-1 cursor-text"
            onDoubleClick={() => { setNameDraft(project.name); setEditingName(true) }}
            title="Double-click to rename"
          >
            {project.name}
          </span>
        )}
        <button
          onClick={() => { removeProject(project.id); setActiveProjectId(null); setProjectMode(false) }}
          className="p-1 text-white/20 hover:text-red-400/70 transition-colors shrink-0"
          title="Delete project"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
      </div>

      {/* Type */}
      <div className="flex gap-1">
        {ALL_TYPES.map(t => (
          <button
            key={t}
            onClick={() => updateProject(project.id, { projectType: t })}
            className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
              project.projectType === t ? 'bg-white/10 text-white/70' : 'bg-white/5 text-white/25 hover:text-white/45'
            }`}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Status (independent of SIA phase) */}
      <div>
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1.5">Status</p>
        <StatusStepper status={project.status} onChange={s => updateProject(project.id, { status: s })} />
      </div>

      {/* Notes */}
      <div>
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">Notes</p>
        <textarea
          value={notesDraft}
          onChange={e => setNotesDraft(e.target.value)}
          onBlur={() => updateProject(project.id, { notes: notesDraft.trim() || undefined })}
          placeholder="Add notes…"
          rows={2}
          className="w-full bg-white/[0.04] border border-white/[0.07] rounded-md px-2 py-1.5
                     text-[11px] text-white/60 placeholder-white/15 outline-none resize-none
                     focus:border-white/20 transition-colors"
        />
      </div>

      {/* Members */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] text-white/25 uppercase tracking-widest">
            Parcels ({project.members.length})
          </p>
          {availableEntries.length > 0 && (
            <button
              onClick={() => setAddingMember(v => !v)}
              className="text-[9px] text-white/30 hover:text-white/60 transition-colors"
            >
              {addingMember ? 'Close' : '+ Add'}
            </button>
          )}
        </div>
        <div className="space-y-1">
          {project.members.map(m => (
            <MemberCard key={m.parcel.egrid} project={project} member={m} />
          ))}
        </div>
        {addingMember && (
          <div className="mt-1 space-y-0.5">
            {availableEntries.map(e => {
              const label = e.label
                ?? (e.buildings[0]?.address !== '—' ? e.buildings[0]?.address : null)
                ?? `Parcel ${e.parcel.parcelNumber}`
              return (
                <button
                  key={e.parcel.egrid}
                  onClick={() => {
                    updateProject(project.id, {
                      members: [...project.members, memberFromPortfolioEntry(e)],
                    })
                    setAddingMember(false)
                  }}
                  className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md text-left hover:bg-white/[0.05] transition-colors"
                >
                  <span className="text-[10px] text-white/50 truncate flex-1">{label}</span>
                  <span className="text-[9px] text-white/20 shrink-0">{e.buildings.length} bldg</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Scenarios module ──────────────────────────────────────────────────────────

function ScenarioEditor({ project, scenario, deltas }: {
  project: Project
  scenario: Scenario
  deltas: ScenarioDeltas | null
}) {
  const { updateProject, projectScenarioPreviewId, setProjectScenarioPreviewId } = useMapStore()

  const saveParams = (patch: Partial<Scenario['params']>) => {
    updateProject(project.id, {
      scenarios: project.scenarios.map(s =>
        s.id === scenario.id ? { ...s, params: { ...s.params, ...patch } } : s,
      ),
    })
  }

  const remove = () => {
    const remaining = project.scenarios.filter(s => s.id !== scenario.id)
    if (projectScenarioPreviewId === scenario.id) setProjectScenarioPreviewId(null)
    updateProject(project.id, {
      scenarios: remaining,
      activeScenarioId: project.activeScenarioId === scenario.id
        ? (remaining[0]?.id ?? null)
        : project.activeScenarioId,
    })
  }

  const allBuildings = project.members.flatMap(memberIncludedBuildings)
  const p = scenario.params
  const isPreviewing = projectScenarioPreviewId === scenario.id
  const isActive = project.activeScenarioId === scenario.id

  return (
    <div className={`rounded-md border px-2 py-1.5 space-y-1.5 transition-colors ${
      isPreviewing ? 'border-accent/30 bg-accent/[0.03]' : 'border-white/[0.06]'
    }`}>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => updateProject(project.id, { activeScenarioId: scenario.id })}
          className={`w-3 h-3 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
            isActive ? 'border-accent' : 'border-white/20 hover:border-white/40'
          }`}
          title={isActive ? 'Aktives Szenario (Kostenbasis des Projekts)' : 'Als aktives Szenario setzen'}
        >
          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
        </button>
        <button
          onClick={() => setProjectScenarioPreviewId(scenario.id)}
          className="text-[10px] text-white/60 font-medium truncate flex-1 text-left hover:text-white/85 transition-colors"
          title="Im 3D-Viewer anzeigen"
        >
          {scenario.name}
        </button>
        {isActive && (
          <span className="text-[8px] px-1 py-px rounded bg-accent/10 text-accent/70 uppercase tracking-wider shrink-0">
            Aktiv
          </span>
        )}
        <button
          onClick={remove}
          className="p-0.5 text-white/20 hover:text-white/60 transition-colors shrink-0"
          title="Delete scenario"
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Extra floors stepper */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/30 w-16 shrink-0">Extra floors</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => saveParams({ extraFloors: Math.max(0, p.extraFloors - 1) })}
            className="w-4 h-4 rounded bg-white/[0.07] text-white/50 hover:bg-white/10 text-[10px] leading-none"
          >−</button>
          <span className="text-[10px] text-white/70 w-3 text-center">{p.extraFloors}</span>
          <button
            onClick={() => saveParams({ extraFloors: Math.min(3, p.extraFloors + 1) })}
            className="w-4 h-4 rounded bg-white/[0.07] text-white/50 hover:bg-white/10 text-[10px] leading-none"
          >+</button>
        </div>
      </div>

      {/* Roof type */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/30 w-16 shrink-0">Roof</span>
        <div className="flex gap-1">
          {(['unchanged', 'flat', 'gable'] as const).map(r => (
            <button
              key={r}
              onClick={() => saveParams({ roofType: r })}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                p.roofType === r ? 'bg-white/10 text-white/70' : 'bg-white/5 text-white/25 hover:text-white/45'
              }`}
            >
              {r === 'unchanged' ? 'Same' : r === 'flat' ? 'Flat' : 'Gable'}
            </button>
          ))}
        </div>
        {p.roofType === 'gable' && (
          <span className="text-[8px] text-white/20 italic">vereinfachte Dachform</span>
        )}
      </div>

      {/* Use change */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/30 w-16 shrink-0">Use</span>
        <select
          value={p.useChange ?? ''}
          onChange={e => saveParams({ useChange: (e.target.value || null) as GEAKUsage | null })}
          className="bg-white/[0.04] border border-white/[0.07] rounded px-1 py-0.5 text-[9px] text-white/60
                     outline-none focus:border-white/20 [color-scheme:dark]"
        >
          <option value="">Unchanged</option>
          {USAGES.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      {/* Target buildings (only when >1 building) */}
      {allBuildings.length > 1 && (
        <div className="flex items-start gap-2">
          <span className="text-[9px] text-white/30 w-16 shrink-0 pt-0.5">Buildings</span>
          <div className="flex flex-wrap gap-1">
            {allBuildings.map(b => {
              const active = p.targetEgids === null || p.targetEgids.includes(b.egid)
              return (
                <button
                  key={b.egid}
                  onClick={() => {
                    const all = allBuildings.map(x => x.egid)
                    const current = p.targetEgids ?? all
                    const next = current.includes(b.egid)
                      ? current.filter(id => id !== b.egid)
                      : [...current, b.egid]
                    saveParams({ targetEgids: next.length === all.length ? null : next })
                  }}
                  className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                    active ? 'bg-white/10 text-white/60' : 'bg-white/5 text-white/20 hover:text-white/40'
                  }`}
                  title={b.address !== '—' ? b.address : b.egid}
                >
                  {b.egid}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Deltas */}
      {deltas && (
        <div className="pt-1 border-t border-white/[0.05]">
          <div className="flex items-center gap-2 flex-wrap text-[10px] text-white/55">
            <span>+{Math.round(deltas.volumeM3).toLocaleString()} m³</span>
            <span className="text-white/20">·</span>
            <span>+{Math.round(deltas.aE).toLocaleString()} m² A_E</span>
            <span className="text-white/20">·</span>
            <span className="flex items-center gap-1">
              GEAK <GeakChip cls={deltas.geakBefore.classGesamt} />
              <svg className="w-2.5 h-2.5 text-white/30" fill="none" stroke="currentColor" strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <GeakChip cls={deltas.geakAfter.classGesamt} />
            </span>
            {scenario.costs && totalCost(scenario.costs) > 0 && (
              <>
                <span className="text-white/20">·</span>
                <span className="text-white/70">{formatCHF(totalCost(scenario.costs))}</span>
              </>
            )}
          </div>
          {deltas.approximate && (
            <p className="text-[9px] text-amber-400/50 mt-0.5">≈ GWR estimate — 3D measurements unavailable</p>
          )}
        </div>
      )}
    </div>
  )
}

function ScenariosModule({ project, deltasByScenario }: {
  project: Project
  deltasByScenario: Record<string, ScenarioDeltas | null>
}) {
  const { updateProject } = useMapStore()
  const [addingScenario, setAddingScenario] = useState(false)
  const [scenarioName, setScenarioName] = useState('')

  const addScenario = () => {
    const name = scenarioName.trim() || `Scenario ${project.scenarios.length + 1}`
    const id = crypto.randomUUID()
    updateProject(project.id, {
      scenarios: [...project.scenarios, {
        id,
        name,
        params: { extraFloors: 1, roofType: 'unchanged', useChange: null, targetEgids: null },
        createdAt: new Date().toISOString(),
        costs: emptyCosts(),
      }],
      activeScenarioId: project.activeScenarioId ?? id,
    })
    setScenarioName('')
    setAddingScenario(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[9px] text-white/25 uppercase tracking-widest">
          Szenarien ({project.scenarios.length})
        </p>
        <button
          onClick={() => setAddingScenario(v => !v)}
          className="text-[9px] text-white/30 hover:text-white/60 transition-colors"
        >
          {addingScenario ? 'Close' : '+ Add'}
        </button>
      </div>
      {addingScenario && (
        <div className="flex gap-1 mb-1.5">
          <input
            value={scenarioName}
            onChange={e => setScenarioName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addScenario() }}
            placeholder={`Scenario ${project.scenarios.length + 1}`}
            autoFocus
            className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.07] rounded-md px-2 py-1
                       text-[10px] text-white/60 placeholder-white/15 outline-none focus:border-white/20 transition-colors"
          />
          <button
            onClick={addScenario}
            className="px-2 rounded-md text-[10px] font-semibold bg-white/[0.07] text-white/50
                       hover:bg-white/10 hover:text-white/80 transition-colors"
          >
            +
          </button>
        </div>
      )}
      <div className="space-y-1">
        {project.scenarios.map(s => (
          <ScenarioEditor key={s.id} project={project} scenario={s} deltas={deltasByScenario[s.id] ?? null} />
        ))}
        {project.scenarios.length === 0 && !addingScenario && (
          <p className="text-[10px] text-white/20 italic px-0.5">
            No scenarios yet. Add one to model extra floors, roof or use changes.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Costs (BKP) module ────────────────────────────────────────────────────────

function CostCell({ code, value, overridden, onCommit, onReset }: {
  code: BkpCode
  value: number
  overridden: boolean
  onCommit: (v: number) => void
  onReset: () => void
}) {
  return (
    <div className="flex items-center gap-1 justify-end">
      {overridden && (
        <button
          onClick={onReset}
          className="text-[8px] text-accent/50 hover:text-accent transition-colors"
          title="Auf Schätzung zurücksetzen"
        >
          ↺
        </button>
      )}
      <input
        key={`${code}-${value}`}
        type="number"
        min={0}
        step={1000}
        defaultValue={Math.round(value)}
        onBlur={e => {
          const v = Math.max(0, Math.round(Number(e.target.value)))
          if (!Number.isNaN(v) && v !== Math.round(value)) onCommit(v)
        }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`w-24 text-right text-[10px] font-mono bg-white/[0.04] border rounded px-1.5 py-0.5 outline-none
                    focus:border-accent/40 ${overridden ? 'text-accent/90 border-accent/20' : 'text-white/70 border-white/[0.06]'}`}
      />
    </div>
  )
}

function CostsModule({ project, scenario, deltas }: {
  project: Project
  scenario: Scenario
  deltas: ScenarioDeltas | null
}) {
  const { updateProject } = useMapStore()
  const [bkp2Open, setBkp2Open] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  const costs = scenario.costs ?? emptyCosts()
  const isActive = project.activeScenarioId === scenario.id

  const saveCosts = (next: ScenarioCosts) => {
    updateProject(project.id, {
      scenarios: project.scenarios.map(s => s.id === scenario.id ? { ...s, costs: next } : s),
    })
  }

  const usage = scenario.params.useChange
    ?? costs.estimate?.usage
    ?? 'MFH'

  const regenerate = (note: string) => {
    if (!deltas) return
    saveCosts({
      ...costs,
      estimate: estimateBkp(deltas, usage),
      changeLog: [...costs.changeLog, {
        ts: new Date().toISOString(), code: '2', old: bkp2Total(costs),
        new: Math.round(deltas.volumeM3 * RATE_CHF_M3[usage] * 1.15), note,
      }],
    })
  }

  // Lazily generate the initial estimate once deltas are available
  useEffect(() => {
    if (costs.estimate === null && deltas && deltas.volumeM3 > 0) {
      saveCosts({ ...costs, estimate: estimateBkp(deltas, usage) })
    }
  }, [costs.estimate === null, deltas === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const lines = effectiveLines(costs)

  const commit = (code: BkpCode, v: number) => {
    const old = lines[code] ?? 0
    saveCosts({
      ...costs,
      overrides: { ...costs.overrides, [code]: v },
      changeLog: [...costs.changeLog, { ts: new Date().toISOString(), code, old, new: v }],
    })
  }

  const reset = (code: BkpCode) => {
    const old = lines[code] ?? 0
    const { [code]: _, ...rest } = costs.overrides
    const estimated = costs.estimate?.lines[code] ?? 0
    saveCosts({
      ...costs,
      overrides: rest,
      changeLog: [...costs.changeLog, {
        ts: new Date().toISOString(), code, old, new: estimated, note: 'zurückgesetzt auf Schätzung',
      }],
    })
  }

  if (costs.estimate === null) {
    return (
      <p className="text-[10px] text-white/25 italic">
        Noch keine Schätzung — Gebäudedaten werden geladen…
      </p>
    )
  }

  const row = (code: BkpCode, indent = false) => {
    const overridden = code in costs.overrides
    return (
      <div key={code} className={`flex items-center gap-2 py-1 border-b border-white/[0.03] last:border-0 ${indent ? 'pl-4' : ''}`}>
        <span className="text-[9px] font-mono text-white/30 w-5 shrink-0">{code}</span>
        <span className="text-[10px] text-white/50 truncate flex-1">{BKP_LABELS[code]}</span>
        <CostCell
          code={code}
          value={lines[code] ?? 0}
          overridden={overridden}
          onCommit={v => commit(code, v)}
          onReset={() => reset(code)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/25 uppercase tracking-widest flex-1">
          BKP · {scenario.name}
        </span>
        {isActive && (
          <span className="text-[8px] px-1 py-px rounded bg-accent/10 text-accent/70 uppercase tracking-wider">
            Aktives Szenario
          </span>
        )}
      </div>

      <p className="text-[9px] text-white/25">
        Basis: {costs.estimate.deltaVolumeM3.toLocaleString()} m³ · {costs.estimate.usage}
        {costs.estimate.approximate && <span className="text-amber-400/50"> · ≈ GWR-Schätzung</span>}
      </p>

      <div>
        {BKP_MAIN_CODES.map(code => {
          if (code === '2') {
            return (
              <div key="2">
                <div className="flex items-center gap-2 py-1 border-b border-white/[0.03]">
                  <span className="text-[9px] font-mono text-white/30 w-5 shrink-0">2</span>
                  <button
                    onClick={() => setBkp2Open(o => !o)}
                    className="flex items-center gap-1 text-[10px] text-white/60 font-medium flex-1 text-left hover:text-white/85 transition-colors"
                  >
                    {BKP_LABELS['2']}
                    <ChevronIcon open={bkp2Open} />
                  </button>
                  <span className="text-[10px] font-mono text-white/70 w-24 text-right pr-1.5">
                    {Math.round(bkp2Total(costs)).toLocaleString('de-CH')}
                  </span>
                </div>
                {bkp2Open && BKP2_SUB_CODES.map(sub => row(sub, true))}
              </div>
            )
          }
          return row(code)
        })}
        <div className="flex items-center gap-2 py-1.5">
          <span className="text-[10px] text-white/70 font-semibold flex-1">Total</span>
          <span className="text-[11px] font-mono text-white/90 font-semibold">
            {formatCHF(totalCost(costs))}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => regenerate('Schätzung neu berechnet')}
          disabled={!deltas}
          className="px-2 py-1 rounded text-[9px] font-medium bg-white/[0.06] text-white/45
                     hover:bg-white/10 hover:text-white/70 disabled:opacity-30 transition-colors"
        >
          Schätzung neu berechnen
        </button>
        <button
          onClick={() => setLogOpen(o => !o)}
          className="px-2 py-1 rounded text-[9px] font-medium text-white/30 hover:text-white/60 transition-colors"
        >
          Änderungsprotokoll ({costs.changeLog.length})
        </button>
      </div>

      {logOpen && (
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {costs.changeLog.length === 0 && (
            <p className="text-[9px] text-white/20 italic">Keine Änderungen.</p>
          )}
          {[...costs.changeLog].reverse().map((c, i) => (
            <div key={i} className="text-[9px] text-white/35 font-mono flex items-baseline gap-1.5">
              <span className="text-white/20 shrink-0">{c.ts.slice(0, 16).replace('T', ' ')}</span>
              <span className="shrink-0">BKP {c.code}</span>
              <span className="truncate">
                {Math.round(c.old).toLocaleString('de-CH')} → {Math.round(c.new).toLocaleString('de-CH')}
                {c.note && <span className="text-white/20"> · {c.note}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SIA timeline module ───────────────────────────────────────────────────────

const PHASE_BAR_COLORS: Record<string, string> = {
  '1': '#2A6E78', '2': '#22808E', '3': '#1897AC', '4': '#0BB4CC', '5': '#00E5FF',
}

function GanttChart({ project }: { project: Project }) {
  const timeline = project.siaTimeline!
  const spans = phaseSpans(timeline)
  if (spans.length === 0) return null

  const t0 = spans[0].start.getTime()
  const t1 = spans[spans.length - 1].end.getTime()
  const range = Math.max(t1 - t0, 1)
  const W = 560
  const ROW_H = 16
  const TOP = 14
  const H = TOP + spans.length * ROW_H + 18
  const x = (t: number) => ((t - t0) / range) * (W - 70) + 66

  // Month ticks
  const ticks: { t: number; label: string }[] = []
  const d = new Date(spans[0].start)
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  const monthMs = 30.4 * 86_400_000
  const stepMonths = Math.max(1, Math.round(range / monthMs / 8))
  let i = 0
  while (d.getTime() < t1) {
    if (i % stepMonths === 0) {
      ticks.push({ t: d.getTime(), label: d.toLocaleDateString('de-CH', { month: 'short', year: '2-digit' }) })
    }
    d.setMonth(d.getMonth() + 1)
    i++
  }

  const now = Date.now()

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {ticks.map(tk => (
        <g key={tk.t}>
          <line x1={x(tk.t)} y1={TOP - 4} x2={x(tk.t)} y2={H - 14} stroke="rgba(255,255,255,0.05)" />
          <text x={x(tk.t)} y={8} fill="rgba(255,255,255,0.25)" fontSize={7}
            textAnchor="middle" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {tk.label}
          </text>
        </g>
      ))}
      {spans.map((s, idx) => (
        <g key={s.code}>
          <text x={0} y={TOP + idx * ROW_H + 10} fill="rgba(255,255,255,0.4)" fontSize={8}>
            {s.code} {SIA_PHASE_LABELS[s.code].slice(0, 12)}
          </text>
          <rect
            x={x(s.start.getTime())}
            y={TOP + idx * ROW_H + 2}
            width={Math.max(2, x(s.end.getTime()) - x(s.start.getTime()))}
            height={ROW_H - 6}
            rx={2}
            fill={PHASE_BAR_COLORS[s.code]}
            opacity={0.75}
          />
        </g>
      ))}
      {/* Phase 6 marker after phase 5 */}
      <text x={Math.min(W - 4, x(t1) + 4)} y={TOP + (spans.length - 1) * ROW_H + 10}
        fill="rgba(255,255,255,0.3)" fontSize={8}>➤ 6</text>
      {now >= t0 && now <= t1 && (
        <line x1={x(now)} y1={TOP - 4} x2={x(now)} y2={H - 14}
          stroke="#FF7A00" strokeWidth={1} strokeDasharray="2 2" />
      )}
    </svg>
  )
}

function TimelineModule({ project, costBasis }: { project: Project; costBasis: number }) {
  const { updateProject } = useMapStore()
  const timeline = project.siaTimeline

  const save = (t: Project['siaTimeline']) => updateProject(project.id, { siaTimeline: t })

  // While auto-estimated, follow the cost basis
  useEffect(() => {
    if (!timeline?.autoEstimated || costBasis <= 0) return
    const est = estimateDurations(costBasis)
    if (JSON.stringify(est) !== JSON.stringify(timeline.phases)) {
      save({ ...timeline, phases: est })
    }
  }, [costBasis, timeline?.autoEstimated]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!timeline) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-white/25 italic">
          Noch keine Termine. Automatische Annahme aus dem geschätzten Projektvolumen
          ({costBasis > 0 ? formatCHF(costBasis) : 'noch keine Kostenbasis'}).
        </p>
        <button
          onClick={() => save(defaultTimeline(costBasis))}
          className="px-2 py-1 rounded text-[9px] font-medium bg-white/[0.06] text-white/45
                     hover:bg-white/10 hover:text-white/70 transition-colors"
        >
          Auto-schätzen (SIA-Phasen)
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-white/25">Start (Phase 1)</span>
          <input
            type="date"
            value={timeline.startDate}
            onChange={e => save({ ...timeline, startDate: e.target.value })}
            className="bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5 text-[10px]
                       text-white/70 outline-none focus:border-accent/40 [color-scheme:dark]"
          />
        </div>
        <button
          onClick={() => save({ ...timeline, phases: estimateDurations(costBasis), autoEstimated: true })}
          className={`px-2 py-1 rounded text-[9px] font-medium transition-colors ${
            timeline.autoEstimated
              ? 'bg-accent/10 text-accent/70'
              : 'bg-white/[0.06] text-white/45 hover:bg-white/10 hover:text-white/70'
          }`}
          title="Dauern automatisch aus der Kostenbasis schätzen"
        >
          Auto-schätzen{timeline.autoEstimated ? ' ✓' : ''}
        </button>
        <span className="text-[9px] text-white/25">
          Total {totalWeeks(timeline)} Wochen
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {SIA_BAR_PHASES.map(code => {
          const phase = timeline.phases.find(p => p.code === code)
          if (!phase) return null
          return (
            <NumInput
              key={code}
              label={`${code} ${SIA_PHASE_LABELS[code].slice(0, 10)}`}
              value={phase.durationWeeks}
              step={1}
              min={1}
              unit="Wo"
              onChange={v => save({
                ...timeline,
                autoEstimated: false,
                phases: timeline.phases.map(p => p.code === code
                  ? { ...p, durationWeeks: Math.max(1, Math.round(v)) }
                  : p),
              })}
            />
          )
        })}
      </div>

      <GanttChart project={project} />
    </div>
  )
}

// ─── Energy (future state) module ──────────────────────────────────────────────

function EnergyModule({ project, deltas, buildings, measurements }: {
  project: Project
  deltas: ScenarioDeltas | null
  buildings: ReturnType<typeof memberIncludedBuildings>
  measurements: Record<number, BuildingMeasurements> | null
}) {
  const { updateProject } = useMapStore()
  const plan = project.energyPlan ?? emptyEnergyPlan()

  const save = (next: Project['energyPlan']) => updateProject(project.id, { energyPlan: next })

  const activeScenario = project.scenarios.find(s => s.id === project.activeScenarioId) ?? null

  const agg = useMemo(() => {
    if (!measurements) return null
    let any = false
    const a: BuildingMeasurements = { volumeM3: 0, facadeM2: 0, roofM2: 0, circumferenceM: 0, footprintM2: 0 }
    for (const b of buildings) {
      const m = measurements[Number(b.egid)]
      if (!m) continue
      any = true
      a.volumeM3 += m.volumeM3; a.facadeM2 += m.facadeM2; a.roofM2 += m.roofM2
      a.circumferenceM += m.circumferenceM; a.footprintM2 += m.footprintM2
    }
    return any ? a : null
  }, [buildings, measurements])

  const defaults = useMemo(() => {
    if (buildings.length === 0) return null
    return getDefaultInputs(buildings[0], agg, buildings)
  }, [buildings, agg])

  if (!defaults) {
    return <p className="text-[10px] text-white/25 italic">Keine Gebäude im Projekt.</p>
  }

  const futureUsage = activeScenario?.params.useChange ?? defaults.usage
  const futureInputs = {
    ...defaults,
    ...plan.geakOverrides,
    usage: futureUsage,
    heatingSystem: plan.heatGeneration?.system ?? plan.geakOverrides.heatingSystem ?? defaults.heatingSystem,
    pvKwp: plan.pv?.kWp ?? defaults.pvKwp,
  }
  const before = calculateGEAK(defaults)
  const after = calculateGEAK(futureInputs)

  const setOverride = (patch: Partial<typeof defaults>) => {
    save({ ...plan, geakOverrides: { ...plan.geakOverrides, ...patch } })
  }

  // Heat generation
  const heatSuggestKW = suggestedHeatPowerKW(after.qHEff, futureInputs.aE)
  const setHeat = (system: GEAKHeatingSystem) => {
    const powerKW = plan.heatGeneration?.powerKW ?? heatSuggestKW
    save({
      ...plan,
      heatGeneration: { system, powerKW, costCHF: heatSystemCost(system, powerKW) },
      geakOverrides: { ...plan.geakOverrides, heatingSystem: system, cop: defaultCOP(system) },
      pushedToBkp: false,
    })
  }

  // PV
  const roofM2 = agg?.roofM2 ?? defaults.roofM2 ?? defaults.footprintM2 ?? 0
  const pvSuggest = suggestedPvKwp(roofM2)

  const pushToBkp = () => {
    if (!activeScenario) return
    const costs = activeScenario.costs ?? emptyCosts()
    const lines = effectiveLines(costs)
    const additions: { code: BkpCode; amount: number; note: string }[] = []
    if (plan.pv?.costCHF) additions.push({ code: '23', amount: plan.pv.costCHF, note: 'aus Energieplanung (PV)' })
    if (plan.heatGeneration?.costCHF) additions.push({ code: '24', amount: plan.heatGeneration.costCHF, note: 'aus Energieplanung (Wärme)' })
    if (additions.length === 0) return
    const overrides = { ...costs.overrides }
    const changeLog = [...costs.changeLog]
    for (const a of additions) {
      const old = lines[a.code] ?? 0
      overrides[a.code] = old + a.amount
      changeLog.push({ ts: new Date().toISOString(), code: a.code, old, new: old + a.amount, note: a.note })
    }
    updateProject(project.id, {
      scenarios: project.scenarios.map(s =>
        s.id === activeScenario.id ? { ...s, costs: { ...costs, overrides, changeLog } } : s),
      energyPlan: { ...plan, pushedToBkp: true },
    })
  }

  const energyCostTotal = (plan.heatGeneration?.costCHF ?? 0) + (plan.pv?.costCHF ?? 0)

  return (
    <div className="space-y-4">
      {/* Future GEAK */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-white/25 uppercase tracking-widest flex-1">Zukunft GEAK</span>
          <span className="flex items-center gap-1 text-[10px] text-white/55">
            <GeakChip cls={before.classGesamt} />
            <svg className="w-2.5 h-2.5 text-white/30" fill="none" stroke="currentColor" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <GeakChip cls={after.classGesamt} />
          </span>
        </div>
        <p className="text-[9px] text-white/25">
          Nutzung: {futureUsage}
          {activeScenario?.params.useChange && ' (aus aktivem Szenario)'}
          {deltas && ` · +${Math.round(deltas.aE).toLocaleString()} m² A_E`}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <NumInput label="U Wand" value={futureInputs.uWall} unit="W/m²K"
            onChange={v => setOverride({ uWall: v })} />
          <NumInput label="U Dach" value={futureInputs.uRoof} unit="W/m²K"
            onChange={v => setOverride({ uRoof: v })} />
          <NumInput label="U Fenster" value={futureInputs.uWindow} unit="W/m²K"
            onChange={v => setOverride({ uWindow: v })} />
        </div>
      </div>

      {/* Heat generation */}
      <div className="space-y-2">
        <span className="text-[9px] text-white/25 uppercase tracking-widest">Wärmeerzeugung (Zukunft)</span>
        <div className="grid grid-cols-3 gap-2">
          <SelInput
            label="System"
            value={(plan.heatGeneration?.system ?? futureInputs.heatingSystem) as GEAKHeatingSystem}
            options={HEATING_SYSTEMS}
            onChange={setHeat}
          />
          <NumInput
            label={`Leistung (Vorschlag ${heatSuggestKW})`}
            value={plan.heatGeneration?.powerKW ?? heatSuggestKW}
            step={1} unit="kW"
            onChange={v => {
              const system = plan.heatGeneration?.system ?? futureInputs.heatingSystem
              save({
                ...plan,
                heatGeneration: { system, powerKW: v, costCHF: heatSystemCost(system, v) },
                pushedToBkp: false,
              })
            }}
          />
          <NumInput
            label="Kosten"
            value={plan.heatGeneration?.costCHF ?? 0}
            step={1000} unit="CHF"
            onChange={v => {
              const system = plan.heatGeneration?.system ?? futureInputs.heatingSystem
              save({
                ...plan,
                heatGeneration: { system, powerKW: plan.heatGeneration?.powerKW ?? heatSuggestKW, costCHF: v },
                pushedToBkp: false,
              })
            }}
          />
        </div>
      </div>

      {/* PV */}
      <div className="space-y-2">
        <span className="text-[9px] text-white/25 uppercase tracking-widest">Photovoltaik (Zukunft)</span>
        <div className="grid grid-cols-3 gap-2">
          <NumInput
            label={`Leistung (Vorschlag ${pvSuggest})`}
            value={plan.pv?.kWp ?? 0}
            step={1} unit="kWp"
            onChange={v => save({
              ...plan,
              pv: {
                kWp: v,
                specificYield: plan.pv?.specificYield ?? PV_DEFAULT_SPECIFIC_YIELD,
                costCHF: pvCost(v),
              },
              pushedToBkp: false,
            })}
          />
          <NumInput
            label="Spez. Ertrag"
            value={plan.pv?.specificYield ?? PV_DEFAULT_SPECIFIC_YIELD}
            step={10} unit="kWh/kWp"
            onChange={v => plan.pv && save({ ...plan, pv: { ...plan.pv, specificYield: v } })}
          />
          <NumInput
            label="Kosten"
            value={plan.pv?.costCHF ?? 0}
            step={1000} unit="CHF"
            onChange={v => plan.pv && save({ ...plan, pv: { ...plan.pv, costCHF: v }, pushedToBkp: false })}
          />
        </div>
        {plan.pv && plan.pv.kWp > 0 && (
          <p className="text-[9px] text-white/30">
            Jahresertrag ≈ {Math.round(plan.pv.kWp * plan.pv.specificYield).toLocaleString()} kWh/a
          </p>
        )}
      </div>

      {/* Push to BKP */}
      <div className="flex items-center gap-2">
        <button
          onClick={pushToBkp}
          disabled={plan.pushedToBkp || energyCostTotal === 0 || !activeScenario}
          className="px-2 py-1 rounded text-[9px] font-medium bg-white/[0.06] text-white/45
                     hover:bg-white/10 hover:text-white/70 disabled:opacity-30 transition-colors"
          title={activeScenario
            ? 'Wärme → BKP 24, PV → BKP 23 des aktiven Szenarios'
            : 'Kein aktives Szenario'}
        >
          In BKP übernehmen ({formatCHF(energyCostTotal)})
        </button>
        {plan.pushedToBkp && <span className="text-[9px] text-emerald-400/60">✓ übernommen</span>}
      </div>
    </div>
  )
}

// ─── Milestones module ─────────────────────────────────────────────────────────

function MilestonesModule({ project }: { project: Project }) {
  const { updateProject } = useMapStore()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')

  const save = (milestones: Milestone[]) => updateProject(project.id, { milestones })

  const add = () => {
    const t = title.trim()
    if (!t) return
    save([...project.milestones, { id: crypto.randomUUID(), title: t, due: due || undefined, done: false }])
    setTitle('')
    setDue('')
  }

  return (
    <div>
      <div className="space-y-0.5">
        {project.milestones.map(m => (
          <div key={m.id} className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-white/[0.04] group">
            <button
              onClick={() => save(project.milestones.map(x => x.id === m.id ? { ...x, done: !x.done } : x))}
              className={`w-3 h-3 rounded border shrink-0 flex items-center justify-center transition-colors ${
                m.done ? 'bg-emerald-400/70 border-emerald-400/70' : 'border-white/20 hover:border-white/40'
              }`}
            >
              {m.done && (
                <svg className="w-2 h-2 text-[#0d0d0d]" fill="none" stroke="currentColor" strokeWidth={3.5}
                  strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
            <span className={`text-[11px] truncate flex-1 ${m.done ? 'text-white/25 line-through' : 'text-white/60'}`}>
              {m.title}
            </span>
            {m.due && <span className="text-[9px] text-white/25 shrink-0">{m.due}</span>}
            <button
              onClick={() => save(project.milestones.filter(x => x.id !== m.id))}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-white/20 hover:text-white/60 transition-all shrink-0"
              title="Delete milestone"
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Add milestone…"
          className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.07] rounded-md px-2 py-1
                     text-[10px] text-white/60 placeholder-white/15 outline-none focus:border-white/20 transition-colors"
        />
        <input
          type="date"
          value={due}
          onChange={e => setDue(e.target.value)}
          className="w-[7.5rem] bg-white/[0.04] border border-white/[0.07] rounded-md px-1.5 py-1
                     text-[10px] text-white/40 outline-none focus:border-white/20 transition-colors
                     [color-scheme:dark]"
        />
        <button
          onClick={add}
          disabled={!title.trim()}
          className="px-2 rounded-md text-[10px] font-semibold bg-white/[0.07] text-white/50
                     hover:bg-white/10 hover:text-white/80 disabled:opacity-30 transition-colors"
        >
          +
        </button>
      </div>
    </div>
  )
}

// ─── Root ──────────────────────────────────────────────────────────────────────

export default function ProjectModules({ project }: { project: Project }) {
  const { buildingMeasurements, projectScenarioPreviewId } = useMapStore()

  const allBuildings = useMemo(
    () => project.members.flatMap(memberIncludedBuildings),
    [project.members],
  )

  // Union bbox of every member's parcel — narrows the backend's tile search.
  const projectBbox = useMemo((): [number, number, number, number] | undefined => {
    const coords = project.members.flatMap(m =>
      (m.parcel.geometry.coordinates as [number, number][][]).flat(),
    )
    if (coords.length === 0) return undefined
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
  }, [project.members])

  // Measurements: viewer-computed (store) take precedence, API-fetched as fallback
  const [fetched, setFetched] = useState<Record<number, BuildingMeasurements> | null>(null)
  useEffect(() => {
    let cancelled = false
    const egids = allBuildings.map(b => Number(b.egid)).filter(id => id > 0)
    if (egids.length === 0) { setFetched(null); return }
    Promise.all(egids.map(egid =>
      fetchBuildingMeasurements(egid, projectBbox).then(m => [egid, m] as const).catch(() => [egid, null] as const),
    )).then(results => {
      if (cancelled) return
      const rec: Record<number, BuildingMeasurements> = {}
      for (const [egid, m] of results) if (m) rec[egid] = m
      setFetched(Object.keys(rec).length > 0 ? rec : null)
    })
    return () => { cancelled = true }
  }, [allBuildings, projectBbox])

  const measurements = useMemo(() => {
    if (!fetched && !buildingMeasurements) return null
    return { ...(fetched ?? {}), ...(buildingMeasurements ?? {}) }
  }, [fetched, buildingMeasurements])

  const deltasByScenario = useMemo(() => {
    const rec: Record<string, ScenarioDeltas | null> = {}
    for (const s of project.scenarios) {
      rec[s.id] = computeScenarioDeltas(s.params, allBuildings, measurements)
    }
    return rec
  }, [project.scenarios, allBuildings, measurements])

  const previewScenario = project.scenarios.find(s => s.id === projectScenarioPreviewId)
    ?? project.scenarios.find(s => s.id === project.activeScenarioId)
    ?? null

  const activeScenario = project.scenarios.find(s => s.id === project.activeScenarioId) ?? null
  const activeCost = activeScenario?.costs ? totalCost(activeScenario.costs) : 0
  const activeDeltas = activeScenario ? deltasByScenario[activeScenario.id] : null
  // Cost basis for the SIA timeline: active scenario BKP total, fallback volume × rate
  const costBasis = activeCost > 0
    ? activeCost
    : (activeDeltas ? activeDeltas.volumeM3 * RATE_CHF_M3[activeScenario?.params.useChange ?? 'MFH'] : 1_000_000)

  const buildingCount = allBuildings.length
  const parcelCount = project.members.length

  return (
    <div className="h-full overflow-y-auto bg-[#0d0d0d]">
      <Module
        icon={<OverviewIcon />}
        title="Overview"
        summary={`${parcelCount} parcel${parcelCount !== 1 ? 's' : ''} · ${buildingCount} building${buildingCount !== 1 ? 's' : ''}`}
        defaultOpen
      >
        <OverviewModule project={project} />
      </Module>

      <Module
        icon={<ScenarioIcon />}
        title="Szenarien"
        summary={project.scenarios.length > 0
          ? `${project.scenarios.length} · aktiv: ${activeScenario?.name ?? '—'}`
          : 'Aufstockung, Dach, Umnutzung'}
        defaultOpen
      >
        <ScenariosModule project={project} deltasByScenario={deltasByScenario} />
      </Module>

      <Module
        icon={<CostIcon />}
        title="Kosten (BKP)"
        summary={previewScenario?.costs && totalCost(previewScenario.costs) > 0
          ? formatCHF(totalCost(previewScenario.costs))
          : 'Schätzung nach Volumen & Nutzung'}
      >
        {previewScenario ? (
          <CostsModule
            project={project}
            scenario={previewScenario}
            deltas={deltasByScenario[previewScenario.id] ?? null}
          />
        ) : (
          <p className="text-[10px] text-white/25 italic">
            Kein Szenario — lege zuerst ein Szenario an; jedes Szenario hat eine eigene BKP-Schätzung.
          </p>
        )}
      </Module>

      <Module
        icon={<TimelineIcon />}
        title="Termine (SIA-Phasen)"
        summary={project.siaTimeline
          ? `${totalWeeks(project.siaTimeline)} Wochen ab ${project.siaTimeline.startDate}`
          : 'Automatische Annahme aus Projektvolumen'}
      >
        <TimelineModule project={project} costBasis={costBasis} />
      </Module>

      <Module
        icon={<EnergyIcon />}
        title="Energie (Zukunft)"
        summary="GEAK-Ziel, Wärmeerzeugung, Photovoltaik"
      >
        <EnergyModule
          project={project}
          deltas={activeDeltas}
          buildings={allBuildings}
          measurements={measurements}
        />
      </Module>

      <Module
        icon={<MilestoneIcon />}
        title="Meilensteine"
        summary={project.milestones.length > 0
          ? `${project.milestones.filter(m => m.done).length}/${project.milestones.length} erledigt`
          : undefined}
      >
        <MilestonesModule project={project} />
      </Module>
    </div>
  )
}

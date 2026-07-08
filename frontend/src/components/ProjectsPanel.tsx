import { useState, useEffect, useMemo, useRef } from 'react'
import { useMapStore } from '../store/mapStore'
import type { PortfolioEntry } from '../store/mapStore'
import type {
  Project, ProjectMember, ProjectPhase, ProjectType, Milestone, Scenario,
} from '../types/project'
import { memberIncludedBuildings } from '../types/project'
import type { BuildingMeasurements } from '../utils/buildingMeasurements'
import { fetchBuildingMeasurements } from '../api/buildings'
import { computeScenarioDeltas } from '../utils/scenarioCalc'
import { USAGES, GEAK_CLASS_COLORS, type GEAKUsage } from '../utils/geakCalculation'

// ─── Phase / type config (hex values shared with MapView layer colours) ───────

export const PHASE_ORDER: ProjectPhase[] = ['idea', 'study', 'planning', 'execution', 'done']

export const PHASE_CONFIG: Record<ProjectPhase, {
  label: string
  dot: string
  activePill: string
  hex: string
}> = {
  idea:      { label: 'Idea',      dot: 'bg-white/30',       activePill: 'bg-white/10 text-white/60',           hex: '#C0C0C0' },
  study:     { label: 'Study',     dot: 'bg-amber-400/60',   activePill: 'bg-amber-400/10 text-amber-400/80',   hex: '#FBD34D' },
  planning:  { label: 'Planning',  dot: 'bg-blue-400/60',    activePill: 'bg-blue-400/10 text-blue-400/80',     hex: '#60A5FA' },
  execution: { label: 'Execution', dot: 'bg-emerald-400/60', activePill: 'bg-emerald-400/10 text-emerald-400/80', hex: '#34D399' },
  done:      { label: 'Done',      dot: 'bg-white/15',       activePill: 'bg-white/5 text-white/35',            hex: '#8A8A8A' },
}

export const TYPE_LABELS: Record<ProjectType, string> = {
  renovation: 'Renovation',
  development: 'Development',
  refurbishment: 'Refurb',
}
const ALL_TYPES = Object.keys(TYPE_LABELS) as ProjectType[]

// ─── Geometry helpers ──────────────────────────────────────────────────────────

function centroid(poly: GeoJSON.Polygon): [number, number] {
  const pts = poly.coordinates.flat() as [number, number][]
  return [
    pts.reduce((s, c) => s + c[0], 0) / pts.length,
    pts.reduce((s, c) => s + c[1], 0) / pts.length,
  ]
}

function boundsOfPolygons(polys: GeoJSON.Polygon[]): [number, number, number, number] {
  const coords = polys.flatMap(p => p.coordinates.flat() as [number, number][])
  return [
    Math.min(...coords.map(c => c[0])),
    Math.min(...coords.map(c => c[1])),
    Math.max(...coords.map(c => c[0])),
    Math.max(...coords.map(c => c[1])),
  ]
}

function memberFromPortfolioEntry(entry: PortfolioEntry): ProjectMember {
  return {
    parcel: entry.parcel,
    buildings: entry.buildings,
    includedEgids: null,
    sourcePortfolioEgrid: entry.parcel.egrid,
  }
}

// ─── Creation form ─────────────────────────────────────────────────────────────

function CreateProjectForm({ preselectedEgrids, onDone, onCancel }: {
  preselectedEgrids: string[]
  onDone: (id: string) => void
  onCancel: () => void
}) {
  const { portfolio, addProject } = useMapStore()
  const [name, setName] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('renovation')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselectedEgrids))
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  const toggle = (egrid: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(egrid)) next.delete(egrid)
    else next.add(egrid)
    return next
  })

  const canCreate = name.trim().length > 0 && selected.size > 0

  const create = () => {
    if (!canCreate) return
    const now = new Date().toISOString()
    const members = portfolio.filter(e => selected.has(e.parcel.egrid)).map(memberFromPortfolioEntry)
    const project: Project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      projectType,
      phase: 'idea',
      milestones: [],
      members,
      scenarios: [],
      createdAt: now,
      updatedAt: now,
    }
    addProject(project)
    onDone(project.id)
  }

  return (
    <div className="px-3 pb-3 space-y-2.5">
      <input
        ref={nameRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') onCancel() }}
        placeholder="Project name…"
        className="w-full bg-white/[0.04] border border-white/[0.07] rounded-md px-2 py-1.5
                   text-[11px] text-white/80 placeholder-white/20 outline-none
                   focus:border-white/20 transition-colors"
      />
      <div>
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">Type</p>
        <div className="flex gap-1">
          {ALL_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setProjectType(t)}
              className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                projectType === t ? 'bg-white/10 text-white/70' : 'bg-white/5 text-white/25 hover:text-white/45'
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">
          Parcels from portfolio
        </p>
        {portfolio.length === 0 ? (
          <p className="text-[10px] text-white/25 italic">Portfolio is empty — add parcels first.</p>
        ) : (
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {portfolio.map(e => {
              const checked = selected.has(e.parcel.egrid)
              const label = e.label
                ?? (e.buildings[0]?.address !== '—' ? e.buildings[0]?.address : null)
                ?? `Parcel ${e.parcel.parcelNumber}`
              return (
                <button
                  key={e.parcel.egrid}
                  onClick={() => toggle(e.parcel.egrid)}
                  className={`w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left transition-colors ${
                    checked ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <span className={`w-3 h-3 rounded border shrink-0 flex items-center justify-center ${
                    checked ? 'bg-accent/80 border-accent/80' : 'border-white/20'
                  }`}>
                    {checked && (
                      <svg className="w-2 h-2 text-[#0d0d0d]" fill="none" stroke="currentColor" strokeWidth={3.5}
                        strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <span className="text-[11px] text-white/60 truncate flex-1">{label}</span>
                  <span className="text-[10px] text-white/20 shrink-0">{e.buildings.length} bldg</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={create}
          disabled={!canCreate}
          className="flex-1 px-2 py-1.5 rounded-md text-[10px] font-semibold transition-colors
                     bg-white text-[#0d0d0d] disabled:bg-white/10 disabled:text-white/25"
        >
          Create project
        </button>
        <button
          onClick={onCancel}
          className="px-2.5 py-1.5 rounded-md text-[10px] text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Phase stepper ─────────────────────────────────────────────────────────────

function PhaseStepper({ phase, onChange }: { phase: ProjectPhase; onChange: (p: ProjectPhase) => void }) {
  const currentIdx = PHASE_ORDER.indexOf(phase)
  return (
    <div className="flex items-center">
      {PHASE_ORDER.map((p, i) => {
        const cfg = PHASE_CONFIG[p]
        const reached = i <= currentIdx
        return (
          <div key={p} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => onChange(p)}
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
            {i < PHASE_ORDER.length - 1 && (
              <div className={`flex-1 h-px mx-1 mb-3.5 ${i < currentIdx ? 'bg-white/30' : 'bg-white/[0.08]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Milestones ────────────────────────────────────────────────────────────────

function MilestonesSection({ project }: { project: Project }) {
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
      <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">Milestones</p>
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
    setAnalysisMode(true)
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

// ─── Scenarios ─────────────────────────────────────────────────────────────────

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

function ScenarioCard({ project, scenario, measurements }: {
  project: Project
  scenario: Scenario
  measurements: Record<number, BuildingMeasurements> | null
}) {
  const { updateProject, setScenarioPreview, scenarioPreview, portfolio,
    setParcelResult, setPortfolioSnapshotGeometries, setAnalysisMode,
    mapInstance, portfolioHighlightFn } = useMapStore()

  const allBuildings = useMemo(
    () => project.members.flatMap(memberIncludedBuildings),
    [project.members],
  )

  const deltas = useMemo(
    () => computeScenarioDeltas(scenario.params, allBuildings, measurements),
    [scenario.params, allBuildings, measurements],
  )

  const saveScenario = (patch: Partial<Scenario['params']>) => {
    updateProject(project.id, {
      scenarios: project.scenarios.map(s =>
        s.id === scenario.id ? { ...s, params: { ...s.params, ...patch } } : s,
      ),
    })
  }

  const remove = () => {
    if (scenarioPreview?.scenarioId === scenario.id) setScenarioPreview(null)
    updateProject(project.id, { scenarios: project.scenarios.filter(s => s.id !== scenario.id) })
  }

  const previewIn3D = () => {
    // Open analysis on the member parcel containing the first target building
    const targetEgid = scenario.params.targetEgids?.[0] ?? allBuildings[0]?.egid
    const member = project.members.find(m => m.buildings.some(b => b.egid === targetEgid)) ?? project.members[0]
    if (!member) return
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
    setScenarioPreview({ projectId: project.id, scenarioId: scenario.id })
    setAnalysisMode(true)
  }

  const p = scenario.params
  const isPreviewing = scenarioPreview?.scenarioId === scenario.id

  return (
    <div className="rounded-md border border-white/[0.06] px-2 py-1.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-white/60 font-medium truncate flex-1">{scenario.name}</span>
        <button
          onClick={previewIn3D}
          className={`px-1.5 py-0.5 text-[9px] font-semibold rounded transition-colors shrink-0 ${
            isPreviewing ? 'bg-accent/20 text-accent' : 'text-accent/60 hover:text-accent hover:bg-accent/10'
          }`}
          title="Show scenario extrusion in the 3D viewer (per-parcel preview)"
        >
          Preview in 3D
        </button>
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
            onClick={() => saveScenario({ extraFloors: Math.max(0, p.extraFloors - 1) })}
            className="w-4 h-4 rounded bg-white/[0.07] text-white/50 hover:bg-white/10 text-[10px] leading-none"
          >−</button>
          <span className="text-[10px] text-white/70 w-3 text-center">{p.extraFloors}</span>
          <button
            onClick={() => saveScenario({ extraFloors: Math.min(3, p.extraFloors + 1) })}
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
              onClick={() => saveScenario({ roofType: r })}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                p.roofType === r ? 'bg-white/10 text-white/70' : 'bg-white/5 text-white/25 hover:text-white/45'
              }`}
            >
              {r === 'unchanged' ? 'Same' : r === 'flat' ? 'Flat' : 'Gable'}
            </button>
          ))}
        </div>
      </div>

      {/* Use change */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/30 w-16 shrink-0">Use</span>
        <select
          value={p.useChange ?? ''}
          onChange={e => saveScenario({ useChange: (e.target.value || null) as GEAKUsage | null })}
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
                    saveScenario({ targetEgids: next.length === all.length ? null : next })
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
          </div>
          {deltas.approximate && (
            <p className="text-[9px] text-amber-400/50 mt-0.5">≈ GWR estimate — 3D measurements unavailable</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Project detail ────────────────────────────────────────────────────────────

function ProjectDetail({ project }: { project: Project }) {
  const { updateProject, removeProject, setActiveProjectId, portfolio } = useMapStore()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(project.name)
  const [notesDraft, setNotesDraft] = useState(project.notes ?? '')
  const [addingMember, setAddingMember] = useState(false)
  const [addingScenario, setAddingScenario] = useState(false)
  const [scenarioName, setScenarioName] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editingName) nameInputRef.current?.focus() }, [editingName])
  useEffect(() => { setNotesDraft(project.notes ?? '') }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch 3D measurements for all included buildings (works without opening the viewer)
  const includedBuildings = useMemo(
    () => project.members.flatMap(memberIncludedBuildings),
    [project.members],
  )
  const [measurements, setMeasurements] = useState<Record<number, BuildingMeasurements> | null>(null)
  useEffect(() => {
    let cancelled = false
    const egids = includedBuildings.map(b => Number(b.egid)).filter(id => id > 0)
    if (egids.length === 0) { setMeasurements(null); return }
    Promise.all(egids.map(egid =>
      fetchBuildingMeasurements(egid).then(m => [egid, m] as const).catch(() => [egid, null] as const),
    )).then(results => {
      if (cancelled) return
      const rec: Record<number, BuildingMeasurements> = {}
      for (const [egid, m] of results) if (m) rec[egid] = m
      setMeasurements(Object.keys(rec).length > 0 ? rec : null)
    })
    return () => { cancelled = true }
  }, [includedBuildings])

  const saveName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed) updateProject(project.id, { name: trimmed })
    setEditingName(false)
  }

  const availableEntries = portfolio.filter(
    e => !project.members.some(m => m.parcel.egrid === e.parcel.egrid),
  )

  const addScenario = () => {
    const name = scenarioName.trim() || `Scenario ${project.scenarios.length + 1}`
    updateProject(project.id, {
      scenarios: [...project.scenarios, {
        id: crypto.randomUUID(),
        name,
        params: { extraFloors: 1, roofType: 'unchanged', useChange: null, targetEgids: null },
        createdAt: new Date().toISOString(),
      }],
    })
    setScenarioName('')
    setAddingScenario(false)
  }

  const cfg = PHASE_CONFIG[project.phase]

  return (
    <div className="px-3 pb-3 space-y-3">
      {/* Header: back + name */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setActiveProjectId(null)}
          className="p-1 -ml-1 text-white/30 hover:text-white/70 transition-colors shrink-0"
          aria-label="Back to project list"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
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
          onClick={() => { removeProject(project.id); setActiveProjectId(null) }}
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

      {/* Phase */}
      <div>
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1.5">Phase</p>
        <PhaseStepper phase={project.phase} onChange={p => updateProject(project.id, { phase: p })} />
      </div>

      <MilestonesSection project={project} />

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

      {/* Scenarios */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] text-white/25 uppercase tracking-widest">
            Scenarios ({project.scenarios.length})
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
            <ScenarioCard key={s.id} project={project} scenario={s} measurements={measurements} />
          ))}
          {project.scenarios.length === 0 && !addingScenario && (
            <p className="text-[10px] text-white/20 italic px-0.5">
              No scenarios yet. Add one to model extra floors, roof or use changes.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Panel root ────────────────────────────────────────────────────────────────

type PhaseFilter = 'all' | ProjectPhase

export default function ProjectsPanel() {
  const {
    projects, activeProjectId, setActiveProjectId,
    promoteToProjectEgrids, setPromoteToProjectEgrids,
    mapInstance, portfolioHighlightFn,
  } = useMapStore()
  const [filter, setFilter] = useState<PhaseFilter>('all')
  const [creating, setCreating] = useState(false)
  const [preselected, setPreselected] = useState<string[]>([])

  // Promotion signal from PortfolioPanel → open creation form pre-checked
  useEffect(() => {
    if (!promoteToProjectEgrids) return
    setPreselected(promoteToProjectEgrids)
    setCreating(true)
    setActiveProjectId(null)
    setPromoteToProjectEgrids(null)
  }, [promoteToProjectEgrids]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  const showProjectOnMap = (project: Project) => {
    const geoms = project.members.map(m => m.parcel.geometry)
    if (geoms.length === 0) return
    portfolioHighlightFn?.(geoms)
    mapInstance?.fitBounds(boundsOfPolygons(geoms), { padding: 80, duration: 1000 })
  }

  const filtered = filter === 'all' ? projects : projects.filter(p => p.phase === filter)
  const totalParcels = projects.reduce((s, p) => s + p.members.length, 0)

  return (
    <div className="overflow-y-auto max-h-[60vh] flex flex-col">
      {activeProject ? (
        <div className="pt-2">
          <ProjectDetail project={activeProject} />
        </div>
      ) : creating ? (
        <div className="pt-2">
          <p className="px-3 pb-2 text-[10px] text-white/40 font-semibold uppercase tracking-widest">New project</p>
          <CreateProjectForm
            preselectedEgrids={preselected}
            onDone={(id) => { setCreating(false); setPreselected([]); setActiveProjectId(id) }}
            onCancel={() => { setCreating(false); setPreselected([]) }}
          />
        </div>
      ) : (
        <>
          {/* Summary + filter + new button */}
          <div className="px-3 py-2 border-t border-white/[0.05] shrink-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-white/25">
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                {totalParcels > 0 && ` · ${totalParcels} parcel${totalParcels !== 1 ? 's' : ''}`}
              </p>
              <button
                onClick={() => setCreating(true)}
                className="px-2 py-0.5 rounded text-[9px] font-semibold bg-white/[0.07] text-white/50
                           hover:bg-white/10 hover:text-white/80 transition-colors"
              >
                + New
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(['all', ...PHASE_ORDER] as PhaseFilter[]).map(key => {
                const count = key === 'all' ? projects.length : projects.filter(p => p.phase === key).length
                if (key !== 'all' && count === 0) return null
                return (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                      filter === key
                        ? 'bg-white/10 text-white/70'
                        : 'text-white/25 hover:text-white/45 hover:bg-white/5'
                    }`}
                  >
                    {key === 'all' ? 'All' : PHASE_CONFIG[key].label}
                    {count > 0 && <span className="ml-1 text-white/20">{count}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Project list */}
          <div className="mx-3 mb-3 rounded-xl border border-white/[0.08] bg-[#161616] overflow-hidden shrink-0">
            {filtered.length === 0 ? (
              <p className="px-4 py-4 text-[11px] text-white/25 italic">
                {projects.length === 0
                  ? 'No projects yet. Promote portfolio entries or create one with "+ New".'
                  : 'No projects match this filter.'}
              </p>
            ) : (
              filtered.map(project => {
                const cfg = PHASE_CONFIG[project.phase]
                return (
                  <button
                    key={project.id}
                    onClick={() => { setActiveProjectId(project.id); showProjectOnMap(project) }}
                    className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-white/[0.03]
                               transition-colors border-b border-white/[0.05] last:border-0"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${cfg.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-white/80 truncate">{project.name}</span>
                        <span className="text-[8px] px-1 py-px rounded bg-white/[0.06] text-white/35 shrink-0 uppercase tracking-wider">
                          {TYPE_LABELS[project.projectType]}
                        </span>
                      </div>
                      <p className="text-[10px] text-white/25 mt-0.5">
                        {cfg.label} · {project.members.length} parcel{project.members.length !== 1 ? 's' : ''}
                        {project.scenarios.length > 0 && ` · ${project.scenarios.length} scenario${project.scenarios.length !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                    <svg
                      className="w-3 h-3 text-white/25 shrink-0 mt-0.5"
                      fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

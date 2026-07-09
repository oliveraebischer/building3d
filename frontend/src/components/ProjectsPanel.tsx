import { useState, useEffect, useRef } from 'react'
import { useMapStore } from '../store/mapStore'
import type { Project, ProjectStatus, ProjectType } from '../types/project'
import {
  STATUS_ORDER, STATUS_CONFIG, TYPE_LABELS, ALL_TYPES,
  boundsOfPolygons, memberFromPortfolioEntry,
} from './projectConfig'

// Re-export for backwards-compatible imports (MapView etc.)
export { STATUS_ORDER, STATUS_CONFIG, TYPE_LABELS } from './projectConfig'

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
      status: 'idea',
      milestones: [],
      members,
      scenarios: [],
      activeScenarioId: null,
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

// ─── Panel root: list only — editing happens in the full-screen project view ──

type StatusFilter = 'all' | ProjectStatus

export default function ProjectsPanel() {
  const {
    projects, setActiveProjectId, setProjectMode,
    promoteToProjectEgrids, setPromoteToProjectEgrids,
    mapInstance, portfolioHighlightFn,
  } = useMapStore()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [creating, setCreating] = useState(false)
  const [preselected, setPreselected] = useState<string[]>([])

  // Promotion signal from PortfolioPanel → open creation form pre-checked
  useEffect(() => {
    if (!promoteToProjectEgrids) return
    setPreselected(promoteToProjectEgrids)
    setCreating(true)
    setPromoteToProjectEgrids(null)
  }, [promoteToProjectEgrids]) // eslint-disable-line react-hooks/exhaustive-deps

  const showProjectOnMap = (project: Project) => {
    const geoms = project.members.map(m => m.parcel.geometry)
    if (geoms.length === 0) return
    portfolioHighlightFn?.(geoms)
    mapInstance?.fitBounds(boundsOfPolygons(geoms), { padding: 80, duration: 1000 })
  }

  const openProject = (project: Project) => {
    setActiveProjectId(project.id)
    showProjectOnMap(project)
    setProjectMode(true)
  }

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)
  const totalParcels = projects.reduce((s, p) => s + p.members.length, 0)

  return (
    <div className="overflow-y-auto max-h-[60vh] flex flex-col">
      {creating ? (
        <div className="pt-2">
          <p className="px-3 pb-2 text-[10px] text-white/40 font-semibold uppercase tracking-widest">New project</p>
          <CreateProjectForm
            preselectedEgrids={preselected}
            onDone={(id) => {
              setCreating(false)
              setPreselected([])
              const project = useMapStore.getState().projects.find(p => p.id === id)
              if (project) openProject(project)
            }}
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
              {(['all', ...STATUS_ORDER] as StatusFilter[]).map(key => {
                const count = key === 'all' ? projects.length : projects.filter(p => p.status === key).length
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
                    {key === 'all' ? 'All' : STATUS_CONFIG[key].label}
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
                const cfg = STATUS_CONFIG[project.status]
                return (
                  <button
                    key={project.id}
                    onClick={() => openProject(project)}
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

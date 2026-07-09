import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useMapStore } from '../store/mapStore'
import { COLLAPSED_W, SEPARATOR_W } from '../constants'
import ProjectModules from './ProjectModules'
import ProjectViewer3D from './ProjectViewer3D'
import { STATUS_CONFIG, TYPE_LABELS } from './projectConfig'
import { memberIncludedBuildings } from '../types/project'
import { computeScenarioDeltas } from '../utils/scenarioCalc'
import { totalCost, formatCHF } from '../utils/bkp'
import { GEAK_CLASS_COLORS } from '../utils/geakCalculation'

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

export default function ProjectPanel() {
  const { sidebarCollapsed, sidebarWidth, sidebarResizing,
          projects, activeProjectId, setProjectMode,
          projectScenarioPreviewId, setProjectScenarioPreviewId,
          buildingMeasurements } = useMapStore()

  const [leftPct, setLeftPct] = useState(33.33)
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const project = projects.find(p => p.id === activeProjectId) ?? null

  // Default the previewed scenario to the project's active scenario
  useEffect(() => {
    if (!project) return
    setProjectScenarioPreviewId(project.activeScenarioId)
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const allBuildings = useMemo(
    () => project?.members.flatMap(memberIncludedBuildings) ?? [],
    [project?.members],
  )

  const previewScenario = project?.scenarios.find(s => s.id === projectScenarioPreviewId) ?? null

  const deltas = useMemo(
    () => previewScenario
      ? computeScenarioDeltas(previewScenario.params, allBuildings, buildingMeasurements)
      : null,
    [previewScenario, allBuildings, buildingMeasurements],
  )

  const previewCost = previewScenario?.costs ? totalCost(previewScenario.costs) : null

  if (!project) return null

  const cfg = STATUS_CONFIG[project.status]

  return (
    <div
      ref={containerRef}
      className="absolute top-0 bottom-0 right-0 z-20 flex"
      style={{
        left: leftPx,
        transition: sidebarResizing ? 'none' : 'left 280ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {/* Left panel — project modules */}
      <div
        className="h-full shrink-0 overflow-hidden"
        style={{ width: `${leftPct}%` }}
      >
        <ProjectModules project={project} />
      </div>

      {/* Draggable vertical divider */}
      <div
        className="w-1 h-full cursor-col-resize bg-white/[0.07] hover:bg-white/20 shrink-0 transition-colors"
        onMouseDown={onDividerMouseDown}
      />

      {/* Right panel — 3D viewer */}
      <div className="flex-1 h-full bg-[#080808] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] shrink-0">
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0"
            style={{ backgroundColor: `${cfg.hex}22`, color: cfg.hex }}
          >
            {cfg.label}
          </span>
          <div className="min-w-0">
            <span className="text-[12px] text-white/85 font-medium truncate">{project.name}</span>
            <span className="ml-2 text-[9px] text-white/30 uppercase tracking-wider">
              {TYPE_LABELS[project.projectType]}
            </span>
          </div>

          {/* Scenario switcher */}
          {project.scenarios.length > 0 && (
            <div className="flex items-center gap-1 ml-2 min-w-0 overflow-x-auto">
              <button
                onClick={() => setProjectScenarioPreviewId(null)}
                className={`px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap transition-colors ${
                  projectScenarioPreviewId === null
                    ? 'bg-white/10 text-white/70'
                    : 'bg-white/5 text-white/25 hover:text-white/45'
                }`}
              >
                Bestand
              </button>
              {project.scenarios.map(s => (
                <button
                  key={s.id}
                  onClick={() => setProjectScenarioPreviewId(s.id)}
                  className={`px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap transition-colors ${
                    projectScenarioPreviewId === s.id
                      ? 'bg-accent/15 text-accent'
                      : 'bg-white/5 text-white/25 hover:text-white/45'
                  }`}
                  title={s.id === project.activeScenarioId ? `${s.name} (aktives Szenario)` : s.name}
                >
                  {s.name}
                  {s.id === project.activeScenarioId && <span className="ml-1 text-[8px]">●</span>}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1" />
          <button
            onClick={() => setProjectMode(false)}
            className="flex items-center gap-1.5 text-[11px] text-white/35 hover:text-white transition-colors shrink-0"
            aria-label="Close project"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor"
              strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Close Project
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <ProjectViewer3D project={project} />
        </div>

        {/* Live metrics strip for the previewed scenario */}
        {previewScenario && deltas && (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-white/[0.06] bg-[#080808] shrink-0 overflow-x-auto">
            <span className="text-[9px] text-white/25 uppercase tracking-widest shrink-0">
              {previewScenario.name}
            </span>
            <span className="text-[10px] text-white/55 whitespace-nowrap">
              +{Math.round(deltas.volumeM3).toLocaleString()} m³
            </span>
            <span className="text-[10px] text-white/55 whitespace-nowrap">
              +{Math.round(deltas.aE).toLocaleString()} m² A_E
            </span>
            <span className="flex items-center gap-1 text-[10px] text-white/55 whitespace-nowrap">
              GEAK <GeakChip cls={deltas.geakBefore.classGesamt} />
              <svg className="w-2.5 h-2.5 text-white/30" fill="none" stroke="currentColor" strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <GeakChip cls={deltas.geakAfter.classGesamt} />
            </span>
            {previewCost !== null && previewCost > 0 && (
              <span className="text-[10px] text-white/70 font-medium whitespace-nowrap ml-auto">
                {formatCHF(previewCost)}
              </span>
            )}
            {deltas.approximate && (
              <span className="text-[9px] text-amber-400/50 whitespace-nowrap shrink-0">≈ GWR estimate</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

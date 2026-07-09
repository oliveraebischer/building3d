import type { PortfolioEntry } from '../store/mapStore'
import type { ProjectMember, ProjectStatus, ProjectType } from '../types/project'

// ─── Status / type config (hex values shared with MapView layer colours) ──────

export const STATUS_ORDER: ProjectStatus[] = ['idea', 'study', 'planning', 'execution', 'done']

export const STATUS_CONFIG: Record<ProjectStatus, {
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
export const ALL_TYPES = Object.keys(TYPE_LABELS) as ProjectType[]

// ─── Geometry helpers ──────────────────────────────────────────────────────────

export function centroid(poly: GeoJSON.Polygon): [number, number] {
  const pts = poly.coordinates.flat() as [number, number][]
  return [
    pts.reduce((s, c) => s + c[0], 0) / pts.length,
    pts.reduce((s, c) => s + c[1], 0) / pts.length,
  ]
}

export function boundsOfPolygons(polys: GeoJSON.Polygon[]): [number, number, number, number] {
  const coords = polys.flatMap(p => p.coordinates.flat() as [number, number][])
  return [
    Math.min(...coords.map(c => c[0])),
    Math.min(...coords.map(c => c[1])),
    Math.max(...coords.map(c => c[0])),
    Math.max(...coords.map(c => c[1])),
  ]
}

export function memberFromPortfolioEntry(entry: PortfolioEntry): ProjectMember {
  return {
    parcel: entry.parcel,
    buildings: entry.buildings,
    includedEgids: null,
    sourcePortfolioEgrid: entry.parcel.egrid,
  }
}

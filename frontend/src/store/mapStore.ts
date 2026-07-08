import { create } from 'zustand'
import maplibregl from 'maplibre-gl'
import type { ParcelFeature, GwrFeature } from '../api/geoAdmin'
import { downloadTile as apiDownloadTile } from '../api/tiles'
import type { TileGridFeature } from '../api/tiles'
import type { BuildingMeasurements } from '../utils/buildingMeasurements'
import type { BuildingFeatureCollection } from '../api/buildings'
import type { TerrainGrid } from '../api/terrain'
import type { Project } from '../types/project'

export type PortfolioStatus = 'watch' | 'due-diligence' | 'active' | 'on-hold' | 'divested'

export type PortfolioSnapshot = {
  buildingGeometries: BuildingFeatureCollection
  neighborGeometries: BuildingFeatureCollection
  snapshotAt: string
}

export type PortfolioEntry = {
  parcel: ParcelFeature
  buildings: GwrFeature[]
  addedAt: string
  label?: string
  status?: PortfolioStatus
  notes?: string
  snapshot?: PortfolioSnapshot
}

const PORTFOLIO_KEY = 'building3d_portfolio'
export function loadPortfolioFromStorage(): PortfolioEntry[] {
  try { return JSON.parse(localStorage.getItem(PORTFOLIO_KEY) ?? '[]') } catch { return [] }
}
export function clearPortfolioStorage() {
  localStorage.removeItem(PORTFOLIO_KEY)
}

export type BaseLayer = {
  id: string
  label: string
  url: string
  attribution: string
}

export const BASE_LAYERS: BaseLayer[] = [
  {
    id: 'pixelkarte',
    label: 'SwissTopo Color',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
    attribution: '© swisstopo',
  },
  {
    id: 'swissimage',
    label: 'Aerial Imagery',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    attribution: '© swisstopo',
  },
  {
    id: 'grau',
    label: 'SwissTopo Gray',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg',
    attribution: '© swisstopo',
  },
]

type MapState = {
  activeBaseLayerId: string
  mapInstance: maplibregl.Map | null
  lookupParcel: ((lng: number, lat: number, showLoading?: boolean) => void) | null
  // Parcel panel state
  parcelLoading: boolean
  selectedParcel: ParcelFeature | null
  selectedGWR: GwrFeature[]
  parcelError: boolean
  // Data mode
  dataMode: boolean
  setDataMode: (v: boolean) => void
  sidebarWidth: number
  setSidebarWidth: (w: number) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  analysisMode: boolean
  setAnalysisMode: (v: boolean) => void
  helpMode: boolean
  setHelpMode: (v: boolean) => void
  helpPanelWidth: number
  setHelpPanelWidth: (w: number) => void
  sidebarResizing: boolean
  setSidebarResizing: (v: boolean) => void
  // Tile downloader
  tileGrid: TileGridFeature[]
  downloadedTileIds: Set<string>
  downloadingTileIds: Set<string>
  tileGridLoading: boolean
  setTileGrid: (tiles: TileGridFeature[]) => void
  setDownloadedTileIds: (ids: string[]) => void
  addDownloadedTileId: (id: string) => void
  removeDownloadedTileId: (id: string) => void
  setTileGridLoading: (v: boolean) => void
  triggerTileDownload: (id: string, url: string) => Promise<void>
  setActiveBaseLayer: (id: string) => void
  setMapInstance: (map: maplibregl.Map | null) => void
  setLookupParcel: (fn: ((lng: number, lat: number, showLoading?: boolean) => void) | null) => void
  clearHighlight: (() => void) | null
  setHighlightBuilding: ((geom: GeoJSON.Geometry | null) => void) | null
  parcelHighlightFn: ((geom: GeoJSON.Geometry) => void) | null
  setParcelLoading: (v: boolean) => void
  setParcelResult: (parcel: ParcelFeature | null, gwr: GwrFeature[], error?: boolean) => void
  clearParcel: () => void
  setClearHighlight: (fn: () => void) => void
  setHighlightBuildingFn: (fn: (geom: GeoJSON.Geometry | null) => void) => void
  setParcelHighlightFn: (fn: (geom: GeoJSON.Geometry) => void) => void
  // Bidirectional panel↔map tile highlight
  highlightedTileId: string | null
  setHighlightedTileId: (id: string | null) => void
  // Portfolio
  portfolio: PortfolioEntry[]
  setPortfolio: (entries: PortfolioEntry[]) => void
  addToPortfolio: (entry: PortfolioEntry) => void
  removeFromPortfolio: (egrid: string) => void
  updatePortfolioEntry: (egrid: string, patch: Partial<Pick<PortfolioEntry, 'label' | 'status' | 'notes'>>) => void
  savePortfolioSnapshot: (egrid: string, snapshot: PortfolioSnapshot) => void
  // Ingested data layer
  ingestedLayer: GeoJSON.FeatureCollection | null
  ingestedColumns: string[]
  setIngestedLayer: (fc: GeoJSON.FeatureCollection | null, columns?: string[]) => void
  portfolioHighlightFn: ((geoms: GeoJSON.Polygon[]) => void) | null
  setPortfolioHighlightFn: (fn: (geoms: GeoJSON.Polygon[]) => void) => void
  portfolioSnapshotGeometries: { own: BuildingFeatureCollection; neighbors: BuildingFeatureCollection } | null
  setPortfolioSnapshotGeometries: (g: { own: BuildingFeatureCollection; neighbors: BuildingFeatureCollection } | null) => void
  portfolioPinsFn: ((entries: PortfolioEntry[]) => void) | null
  setPortfolioPinsFn: (fn: ((entries: PortfolioEntry[]) => void) | null) => void
  portfolioPinClickedEgrid: string | null
  setPortfolioPinClickedEgrid: (egrid: string | null) => void
  portfolioHoveredBuildingEgid: string | null
  setPortfolioHoveredBuildingEgid: (egid: string | null) => void
  // Analysis panel ↔ 3D viewer building highlight
  analysisSelectedEgid: number | null
  setAnalysisSelectedEgid: (id: number | null) => void
  analysisHoveredEgid: number | null
  setAnalysisHoveredEgid: (id: number | null) => void
  // Per-building filter in analyse mode
  activeEgids: Set<number>
  setActiveEgids: (ids: Set<number>) => void
  toggleActiveEgid: (id: number) => void
  // Measurements computed from 3D geometry
  buildingMeasurements: Record<number, BuildingMeasurements> | null
  setBuildingMeasurements: (m: Record<number, BuildingMeasurements>) => void
  clearBuildingMeasurements: () => void
  // Sun & Shadow
  sunDayOfYear: number
  setSunDayOfYear: (d: number) => void
  sunHourOfDay: number
  setSunHourOfDay: (h: number) => void
  // Eagerly prefetched 3D geometry (loaded as soon as tile is ready, before Analyse is clicked)
  prefetchedGeometry: { egrid: string; data: BuildingFeatureCollection; terrain: TerrainGrid | null } | null
  setPrefetchedGeometry: (g: { egrid: string; data: BuildingFeatureCollection; terrain: TerrainGrid | null } | null) => void
  // Projects
  projects: Project[]
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'projectType' | 'phase' | 'notes' | 'milestones' | 'members' | 'scenarios'>>) => void
  projectsMapFn: ((projects: Project[]) => void) | null
  setProjectsMapFn: (fn: ((projects: Project[]) => void) | null) => void
  projectMarkerClickedId: string | null
  setProjectMarkerClickedId: (id: string | null) => void
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  // PortfolioPanel → ProjectsPanel promotion signal
  promoteToProjectEgrids: string[] | null
  setPromoteToProjectEgrids: (egrids: string[] | null) => void
  // Scenario preview shown in the 3D viewer
  scenarioPreview: { projectId: string; scenarioId: string } | null
  setScenarioPreview: (p: { projectId: string; scenarioId: string } | null) => void
}

export const useMapStore = create<MapState>((set, get) => ({
  activeBaseLayerId: 'pixelkarte',
  mapInstance: null,
  lookupParcel: null,
  parcelLoading: false,
  selectedParcel: null,
  selectedGWR: [],
  parcelError: false,
  clearHighlight: null,
  setHighlightBuilding: null,
  parcelHighlightFn: null,
  dataMode: false,
  setDataMode: (v) => set({ dataMode: v }),
  sidebarWidth: 260,
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  analysisMode: false,
  setAnalysisMode: (v) => set({ analysisMode: v }),
  helpMode: false,
  setHelpMode: (v) => set({ helpMode: v }),
  helpPanelWidth: 380,
  setHelpPanelWidth: (w) => set({ helpPanelWidth: w }),
  sidebarResizing: false,
  setSidebarResizing: (v) => set({ sidebarResizing: v }),
  tileGrid: [],
  downloadedTileIds: new Set(),
  downloadingTileIds: new Set(),
  tileGridLoading: false,
  setTileGrid: (tiles) => set({ tileGrid: tiles }),
  setDownloadedTileIds: (ids) => set({ downloadedTileIds: new Set(ids) }),
  addDownloadedTileId: (id) => set((s) => ({ downloadedTileIds: new Set([...s.downloadedTileIds, id]) })),
  removeDownloadedTileId: (id) => set((s) => {
    const next = new Set(s.downloadedTileIds)
    next.delete(id)
    return { downloadedTileIds: next }
  }),
  setTileGridLoading: (v) => set({ tileGridLoading: v }),
  triggerTileDownload: async (id, url) => {
    set((s) => ({ downloadingTileIds: new Set([...s.downloadingTileIds, id]) }))
    try {
      const result = await apiDownloadTile(id, url)
      set((s) => {
        const downloading = new Set(s.downloadingTileIds)
        downloading.delete(id)
        return {
          downloadedTileIds: new Set([...s.downloadedTileIds, result.id]),
          downloadingTileIds: downloading,
        }
      })
    } catch {
      set((s) => {
        const downloading = new Set(s.downloadingTileIds)
        downloading.delete(id)
        return { downloadingTileIds: downloading }
      })
    }
  },
  setActiveBaseLayer: (id) => set({ activeBaseLayerId: id }),
  setMapInstance: (map) => set({ mapInstance: map }),
  setLookupParcel: (fn) => set({ lookupParcel: fn }),
  setParcelLoading: (v) => set({ parcelLoading: v, parcelError: false }),
  setParcelResult: (parcel, gwr, error = false) =>
    set({
      selectedParcel: parcel, selectedGWR: gwr, parcelLoading: false, parcelError: error,
      activeEgids: new Set(gwr.map(b => Number(b.egid)).filter(id => id > 0)),
    }),
  clearParcel: () => {
    get().setHighlightBuilding?.(null)
    set({ selectedParcel: null, selectedGWR: [], parcelLoading: false, parcelError: false, activeEgids: new Set() })
  },
  setClearHighlight: (fn) => set({ clearHighlight: fn }),
  setHighlightBuildingFn: (fn) => set({ setHighlightBuilding: fn }),
  setParcelHighlightFn: (fn) => set({ parcelHighlightFn: fn }),
  highlightedTileId: null,
  setHighlightedTileId: (id) => set({ highlightedTileId: id }),
  portfolio: [],
  setPortfolio: (entries) => set({ portfolio: entries }),
  addToPortfolio: (entry) => set((s) => {
    const next = [entry, ...s.portfolio.filter(e => e.parcel.egrid !== entry.parcel.egrid)]
    fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {})
    return { portfolio: next }
  }),
  removeFromPortfolio: (egrid) => set((s) => {
    const next = s.portfolio.filter(e => e.parcel.egrid !== egrid)
    fetch(`/api/portfolio/${egrid}`, { method: 'DELETE' }).catch(() => {})
    return { portfolio: next }
  }),
  updatePortfolioEntry: (egrid, patch) => set((s) => {
    const next = s.portfolio.map(e => e.parcel.egrid === egrid ? { ...e, ...patch } : e)
    fetch(`/api/portfolio/${egrid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {})
    return { portfolio: next }
  }),
  savePortfolioSnapshot: (egrid, snapshot) => set((s) => {
    const next = s.portfolio.map(e => e.parcel.egrid === egrid ? { ...e, snapshot } : e)
    fetch(`/api/portfolio/${egrid}/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    }).catch(() => {})
    return { portfolio: next }
  }),
  ingestedLayer: null,
  ingestedColumns: [],
  setIngestedLayer: (fc, columns = []) => set({ ingestedLayer: fc, ingestedColumns: columns }),
  portfolioHighlightFn: null,
  setPortfolioHighlightFn: (fn) => set({ portfolioHighlightFn: fn }),
  portfolioSnapshotGeometries: null,
  setPortfolioSnapshotGeometries: (g) => set({ portfolioSnapshotGeometries: g }),
  portfolioPinsFn: null,
  setPortfolioPinsFn: (fn) => set({ portfolioPinsFn: fn }),
  portfolioPinClickedEgrid: null,
  setPortfolioPinClickedEgrid: (egrid) => set({ portfolioPinClickedEgrid: egrid }),
  portfolioHoveredBuildingEgid: null,
  setPortfolioHoveredBuildingEgid: (egid) => set({ portfolioHoveredBuildingEgid: egid }),
  analysisSelectedEgid: null,
  setAnalysisSelectedEgid: (id) => set({ analysisSelectedEgid: id }),
  analysisHoveredEgid: null,
  setAnalysisHoveredEgid: (id) => set({ analysisHoveredEgid: id }),
  activeEgids: new Set<number>(),
  setActiveEgids: (ids) => set({ activeEgids: ids }),
  toggleActiveEgid: (id) => set((s) => {
    const next = new Set(s.activeEgids)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { activeEgids: next }
  }),
  buildingMeasurements: null,
  setBuildingMeasurements: (m) => set({ buildingMeasurements: m }),
  clearBuildingMeasurements: () => set({ buildingMeasurements: null }),
  sunDayOfYear: 172,
  setSunDayOfYear: (d) => set({ sunDayOfYear: d }),
  sunHourOfDay: 12.0,
  setSunHourOfDay: (h) => set({ sunHourOfDay: h }),
  prefetchedGeometry: null,
  setPrefetchedGeometry: (g) => set({ prefetchedGeometry: g }),
  projects: [],
  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((s) => {
    const next = [project, ...s.projects.filter(p => p.id !== project.id)]
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    }).catch(() => {})
    return { projects: next }
  }),
  removeProject: (id) => set((s) => {
    const next = s.projects.filter(p => p.id !== id)
    fetch(`/api/projects/${id}`, { method: 'DELETE' }).catch(() => {})
    return { projects: next }
  }),
  updateProject: (id, patch) => set((s) => {
    const updatedAt = new Date().toISOString()
    const next = s.projects.map(p => p.id === id ? { ...p, ...patch, updatedAt } : p)
    fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {})
    return { projects: next }
  }),
  projectsMapFn: null,
  setProjectsMapFn: (fn) => set({ projectsMapFn: fn }),
  projectMarkerClickedId: null,
  setProjectMarkerClickedId: (id) => set({ projectMarkerClickedId: id }),
  activeProjectId: null,
  setActiveProjectId: (id) => set({ activeProjectId: id }),
  promoteToProjectEgrids: null,
  setPromoteToProjectEgrids: (egrids) => set({ promoteToProjectEgrids: egrids }),
  scenarioPreview: null,
  setScenarioPreview: (p) => set({ scenarioPreview: p }),
}))

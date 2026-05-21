import { create } from 'zustand'
import maplibregl from 'maplibre-gl'
import type { ParcelFeature, GwrFeature } from '../api/geoAdmin'
import { downloadTile as apiDownloadTile } from '../api/tiles'
import type { TileGridFeature } from '../api/tiles'

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
    set({ selectedParcel: parcel, selectedGWR: gwr, parcelLoading: false, parcelError: error }),
  clearParcel: () => {
    get().setHighlightBuilding?.(null)
    set({ selectedParcel: null, selectedGWR: [], parcelLoading: false, parcelError: false })
  },
  setClearHighlight: (fn) => set({ clearHighlight: fn }),
  setHighlightBuildingFn: (fn) => set({ setHighlightBuilding: fn }),
  setParcelHighlightFn: (fn) => set({ parcelHighlightFn: fn }),
  highlightedTileId: null,
  setHighlightedTileId: (id) => set({ highlightedTileId: id }),
}))

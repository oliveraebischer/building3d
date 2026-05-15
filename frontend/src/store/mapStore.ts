import { create } from 'zustand'
import maplibregl from 'maplibre-gl'
import type { ParcelFeature, GwrFeature } from '../api/geoAdmin'

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
  dataPanelWidth: number
  setDataPanelWidth: (w: number) => void
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
  dataPanelWidth: Math.round(window.innerWidth / 3),
  setDataPanelWidth: (w) => set({ dataPanelWidth: w }),
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
}))

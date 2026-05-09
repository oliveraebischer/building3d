import { create } from 'zustand'
import maplibregl from 'maplibre-gl'

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
  setActiveBaseLayer: (id: string) => void
  setMapInstance: (map: maplibregl.Map | null) => void
}

export const useMapStore = create<MapState>((set) => ({
  activeBaseLayerId: 'pixelkarte',
  mapInstance: null,
  setActiveBaseLayer: (id) => set({ activeBaseLayerId: id }),
  setMapInstance: (map) => set({ mapInstance: map }),
}))

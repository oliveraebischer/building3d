import { create } from 'zustand'

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
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{y}/{x}.jpeg',
    attribution: '© swisstopo',
  },
  {
    id: 'swissimage',
    label: 'Aerial Imagery',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{y}/{x}.jpeg',
    attribution: '© swisstopo',
  },
  {
    id: 'grau',
    label: 'SwissTopo Gray',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{y}/{x}.jpeg',
    attribution: '© swisstopo',
  },
]

type MapState = {
  activeBaseLayerId: string
  setActiveBaseLayer: (id: string) => void
}

export const useMapStore = create<MapState>((set) => ({
  activeBaseLayerId: 'pixelkarte',
  setActiveBaseLayer: (id) => set({ activeBaseLayerId: id }),
}))

import { useState, useRef, useEffect } from 'react'
import { BASE_LAYERS, useMapStore } from '../store/mapStore'

const THUMB: Record<string, string> = {
  pixelkarte: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/8/133/90.jpeg',
  swissimage:  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/8/133/90.jpeg',
  grau:        'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/8/133/90.jpeg',
}

function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 8.5 12 15 2 8.5 12 2" />
      <polyline points="2 15.5 12 22 22 15.5" />
      <polyline points="2 12 12 18.5 22 12" />
    </svg>
  )
}

export default function LayerSwitcher() {
  const { activeBaseLayerId, setActiveBaseLayer } = useMapStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="absolute bottom-8 right-4 z-20 flex flex-col items-end gap-2">

      {/* Expanded panel */}
      {open && (
        <div className="bg-[#0d0d0d] border border-white/[0.08] rounded-2xl shadow-2xl p-3
                        flex flex-col gap-2 animate-in">
          <p className="text-[9px] font-bold tracking-[0.12em] uppercase text-white/30 px-0.5 mb-0.5">
            Base Layer
          </p>

          {BASE_LAYERS.map((layer) => {
            const active = activeBaseLayerId === layer.id
            return (
              <button
                key={layer.id}
                onClick={() => { setActiveBaseLayer(layer.id); setOpen(false) }}
                className={`relative w-[120px] h-[78px] rounded-xl overflow-hidden border-2 transition-all
                            focus:outline-none
                            ${active ? 'border-accent' : 'border-transparent hover:border-white/20'}`}
              >
                <img src={THUMB[layer.id]} alt={layer.label}
                  className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                <div className={`absolute inset-0 flex items-end p-1.5
                                 ${active ? 'bg-black/20' : 'bg-black/55'}`}>
                  <span className={`text-[10px] font-semibold leading-tight
                                    ${active ? 'text-accent' : 'text-white/75'}`}>
                    {layer.label}
                  </span>
                </div>
                {active && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent
                                  flex items-center justify-center">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="#0d0d0d" strokeWidth="3"
                      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                )}
              </button>
            )
          })}

          <p className="text-[9px] text-white/25 px-0.5 pt-1 border-t border-white/[0.06]">
            Cadastral visible at zoom ≥ 14
          </p>
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Switch base layer"
        className={`w-10 h-10 rounded-xl flex items-center justify-center border
                    transition-all duration-150 shadow-xl
                    ${open
                      ? 'bg-accent border-accent text-[#0d0d0d]'
                      : 'bg-[#161616] border-white/[0.08] text-white/60 hover:text-white hover:border-white/20'}`}
      >
        <LayersIcon />
      </button>
    </div>
  )
}

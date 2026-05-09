import { BASE_LAYERS, useMapStore } from '../store/mapStore'

export default function LayerSwitcher() {
  const { activeBaseLayerId, setActiveBaseLayer } = useMapStore()

  return (
    <div className="absolute bottom-10 right-14 z-10 bg-surface/90 backdrop-blur-sm border border-white/10 rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Base Layer</p>
      <ul className="space-y-1">
        {BASE_LAYERS.map((layer) => (
          <li key={layer.id}>
            <button
              onClick={() => setActiveBaseLayer(layer.id)}
              className={[
                'w-full text-left px-3 py-1.5 rounded text-sm transition-colors',
                activeBaseLayerId === layer.id
                  ? 'bg-accent text-white font-medium'
                  : 'text-slate-300 hover:bg-white/10',
              ].join(' ')}
            >
              {layer.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

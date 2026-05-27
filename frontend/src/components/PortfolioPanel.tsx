import { useState } from 'react'
import { useMapStore } from '../store/mapStore'
import type { PortfolioEntry } from '../store/mapStore'

function centroid(poly: GeoJSON.Polygon): [number, number] {
  const pts = poly.coordinates.flat() as [number, number][]
  return [
    pts.reduce((s, c) => s + c[0], 0) / pts.length,
    pts.reduce((s, c) => s + c[1], 0) / pts.length,
  ]
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-white/40 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function EntryRow({ entry, onRemove }: { entry: PortfolioEntry; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const { mapInstance, portfolioHighlightFn } = useMapStore()

  const firstAddress = entry.buildings[0]?.address
  const label = firstAddress && firstAddress !== '—'
    ? firstAddress
    : `Parcel ${entry.parcel.parcelNumber}`

  const handleClick = () => {
    setOpen(o => !o)
    if (!mapInstance) return
    const [lng, lat] = centroid(entry.parcel.geometry)
    mapInstance.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 })
    portfolioHighlightFn?.([entry.parcel.geometry])
  }

  return (
    <div className="border-b border-white/[0.05] last:border-0">
      <div className="flex items-center group">
        <button
          onClick={handleClick}
          className="flex-1 min-w-0 flex items-center justify-between px-4 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
        >
          <div className="min-w-0">
            <span className="text-[11px] text-white/80 block truncate">{label}</span>
            <span className="text-[10px] text-white/30">
              {entry.parcel.parcelNumber} · {entry.parcel.canton}
              {entry.buildings.length > 0 && ` · ${entry.buildings.length} bldg`}
            </span>
          </div>
          <ChevronIcon open={open} />
        </button>
        <button
          onClick={onRemove}
          className="px-3 py-2.5 text-white/20 hover:text-white/70 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          aria-label="Remove from portfolio"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {open && entry.buildings.length > 0 && (
        <div className="px-4 pb-3 divide-y divide-white/[0.04]">
          {entry.buildings.map((b, i) => (
            <div key={b.egid !== '—' ? b.egid : i} className="pt-2 first:pt-1">
              <p className="text-[11px] text-white/60 truncate">
                {b.address !== '—' ? b.address : `Building ${i + 1}`}
              </p>
              <p className="text-[10px] text-white/30">EGID {b.egid}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PortfolioPanel() {
  const { portfolio, removeFromPortfolio } = useMapStore()

  return (
    <div className="overflow-y-auto max-h-[40vh]">
      <div className="m-3 rounded-xl border border-white/[0.08] bg-[#161616] overflow-hidden">
        {portfolio.length === 0 ? (
          <p className="px-4 py-4 text-[11px] text-white/25 italic">
            No parcels saved yet. Search an address and click "Add to Portfolio".
          </p>
        ) : (
          <div>
            {portfolio.map(entry => (
              <EntryRow
                key={entry.parcel.egrid}
                entry={entry}
                onRemove={() => removeFromPortfolio(entry.parcel.egrid)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

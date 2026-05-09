import { useState, useRef, useEffect, useCallback } from 'react'
import { useMapStore } from '../store/mapStore'

type Suggestion = {
  id: number
  label: string
  detail: string
  lat: number
  lon: number
  zoomlevel: number
}

const GEOCODE_URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer'
const DEFAULT_ZOOM = 14

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, '')
}

export default function SearchBar() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mapInstance = useMapStore((s) => s.mapInstance)
  const lookupParcel = useMapStore((s) => s.lookupParcel)

  const fetchSuggestions = useCallback(async (text: string) => {
    if (text.trim().length < 2) { setSuggestions([]); setOpen(false); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ searchText: text, type: 'locations', lang: 'en', limit: '8' })
      const res = await fetch(`${GEOCODE_URL}?${params}`)
      if (!res.ok) return
      const data = await res.json()
      const results: Suggestion[] = (data.results ?? []).map((r: any) => ({
        id: r.id, label: r.attrs.label, detail: r.attrs.detail,
        lat: r.attrs.lat, lon: r.attrs.lon,
        zoomlevel: r.attrs.zoomlevel < 25 ? r.attrs.zoomlevel : DEFAULT_ZOOM,
      }))
      setSuggestions(results)
      setOpen(results.length > 0)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 250)
  }

  const handleSelect = (s: Suggestion) => {
    setQuery(stripHtml(s.label))
    setOpen(false)
    setSuggestions([])

    if (!mapInstance) return

    // Zoom to 18 for address-level detail (cadastral + building clearly visible)
    const targetZoom = 18

    mapInstance.flyTo({ center: [s.lon, s.lat], zoom: targetZoom, duration: 1200 })

    // After fly ends, trigger parcel lookup with loading indicator
    mapInstance.once('moveend', () => {
      lookupParcel?.(s.lon, s.lat, true)
    })
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-searchbar]')) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div data-searchbar className="relative w-80">
      {/* Input */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors
                       bg-[#161616]
                       ${open || query ? 'border-accent/50' : 'border-white/[0.08] hover:border-white/[0.15]'}`}>
        <svg className="w-3.5 h-3.5 text-white/35 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), inputRef.current?.blur())}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="Search locations…"
          className="bg-transparent text-sm text-white placeholder-white/30 outline-none w-full"
        />
        {loading && (
          <span className="shrink-0 w-3 h-3 rounded-full border border-white/10 border-t-accent animate-spin" />
        )}
        {query && !loading && (
          <button onClick={() => { setQuery(''); setSuggestions([]); setOpen(false) }}
            className="text-white/30 hover:text-white shrink-0 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Suggestions */}
      {open && (
        <ul className="absolute top-full mt-1 left-0 right-0 bg-[#161616] border border-white/[0.08]
                       rounded-lg shadow-2xl overflow-hidden z-50 max-h-64 overflow-y-auto">
          {suggestions.map((s) => (
            <li key={s.id} className="border-b border-white/[0.06] last:border-0">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s)}
                className="w-full text-left px-4 py-2.5 hover:bg-[#222] transition-colors">
                <span className="text-sm text-white block"
                  dangerouslySetInnerHTML={{ __html: s.label }} />
                <span className="text-xs text-white/35 capitalize">{s.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

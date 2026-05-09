import { useState, useRef, useEffect, useCallback } from 'react'
import { useMapStore } from '../store/mapStore'

type Suggestion = {
  id: number
  label: string       // HTML label e.g. "<b>Bern (BE)</b>"
  detail: string      // plain text e.g. "bern be"
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

  const fetchSuggestions = useCallback(async (text: string) => {
    if (text.trim().length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({
        searchText: text,
        type: 'locations',
        lang: 'en',
        limit: '8',
      })
      const res = await fetch(`${GEOCODE_URL}?${params}`)
      if (!res.ok) return
      const data = await res.json()
      const results: Suggestion[] = (data.results ?? []).map((r: any) => ({
        id: r.id,
        label: r.attrs.label,
        detail: r.attrs.detail,
        lat: r.attrs.lat,
        lon: r.attrs.lon,
        zoomlevel: r.attrs.zoomlevel < 25 ? r.attrs.zoomlevel : DEFAULT_ZOOM,
      }))
      setSuggestions(results)
      setOpen(results.length > 0)
    } catch {
      // network error — silently ignore
    } finally {
      setLoading(false)
    }
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
    if (mapInstance) {
      mapInstance.flyTo({
        center: [s.lon, s.lat],
        zoom: Math.min(s.zoomlevel, 17),
        duration: 1200,
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-searchbar]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div data-searchbar className="relative w-72">
      <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 focus-within:border-accent focus-within:bg-white/15 transition-colors">
        {/* Search icon */}
        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="Search locations in Switzerland…"
          className="bg-transparent text-sm text-white placeholder-slate-400 outline-none w-full"
        />
        {loading && (
          <svg className="w-3.5 h-3.5 text-slate-400 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
          </svg>
        )}
        {query && !loading && (
          <button
            onClick={() => { setQuery(''); setSuggestions([]); setOpen(false) }}
            className="text-slate-400 hover:text-white shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <ul className="absolute top-full mt-1 left-0 right-0 bg-surface border border-white/10 rounded-lg shadow-2xl overflow-hidden z-50 max-h-72 overflow-y-auto">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                onMouseDown={(e) => e.preventDefault()} // prevent blur before click
                onClick={() => handleSelect(s)}
                className="w-full text-left px-4 py-2.5 hover:bg-white/10 transition-colors"
              >
                <span
                  className="text-sm text-white block"
                  dangerouslySetInnerHTML={{ __html: s.label }}
                />
                <span className="text-xs text-slate-400 capitalize">{s.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useState, useEffect, useRef, useMemo } from 'react'
import { useMapStore } from '../store/mapStore'
import type { GwrFeature } from '../api/geoAdmin'
import type { BuildingMeasurements } from '../utils/buildingMeasurements'
import { computeSunPosition, dayOfYearToLabel } from '../utils/solarPosition'
import SunShadowCharts from './SunShadowCharts'
import {
  calculateGEAK, getDefaultInputs, defaultCOP,
  GEAK_CLASS_COLORS, HEATING_SYSTEMS, USAGES, VENTILATION_TYPES,
} from '../utils/geakCalculation'
import type { GEAKInputs, GEAKHeatingSystem, GEAKUsage, GEAKVentilation } from '../utils/geakCalculation'

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-white/30 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function BuildingIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 21h18M3 21V7l9-4 9 4v14M9 21v-6h6v6" />
    </svg>
  )
}

function RulerIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 17.5L17.5 3l3.5 3.5L6.5 21z" />
      <path d="M8.5 15.5l1.5-1.5M12 12l1.5-1.5M15.5 8.5l1.5-1.5" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

// ─── GWR attribute row ────────────────────────────────────────────────────────

function Attr({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]">
      <span className="text-[10px] text-white/25 shrink-0">{label}</span>
      <span className="text-[10px] text-white/55 text-right">{value}</span>
    </div>
  )
}

// ─── Parcel summary header ────────────────────────────────────────────────────

function ParcelSummary() {
  const { selectedParcel, selectedGWR } = useMapStore()

  if (!selectedParcel) {
    return (
      <div className="px-4 py-5 border-b border-white/[0.05]">
        <p className="text-[11px] text-white/20 italic">No parcel selected.</p>
      </div>
    )
  }

  const totalFootprint = selectedGWR.reduce((s, b) => s + (b.footprintM2 ?? 0), 0)
  const years = selectedGWR.map(b => b.constructionYear).filter((y): y is number => y != null)
  const minYear = years.length ? Math.min(...years) : null
  const maxYear = years.length ? Math.max(...years) : null
  const yearStr = minYear === maxYear ? `${minYear}` : minYear && maxYear ? `${minYear}–${maxYear}` : null

  const catCounts: Record<string, number> = {}
  selectedGWR.forEach(b => {
    if (b.category && b.category !== '—') catCounts[b.category] = (catCounts[b.category] ?? 0) + 1
  })
  const dominantCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return (
    <div className="px-4 pt-3.5 pb-3 border-b border-white/[0.05]">
      <p className="text-[9px] font-mono text-white/20 tracking-widest uppercase mb-1">Parcel</p>
      <p className="text-[12px] text-white/75 font-medium leading-tight">
        {selectedParcel.parcelNumber} · {selectedParcel.canton}
      </p>
      <p className="text-[9px] font-mono text-accent/50 mt-0.5 mb-2">{selectedParcel.egrid}</p>
      {dominantCat && (
        <p className="text-[10px] text-white/35 mb-2">{dominantCat}</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {selectedGWR.length > 0 && (
          <span className="text-[10px] text-white/25">
            {selectedGWR.length} building{selectedGWR.length !== 1 ? 's' : ''}
          </span>
        )}
        {totalFootprint > 0 && (
          <span className="text-[10px] text-white/25">{totalFootprint} m²</span>
        )}
        {yearStr && (
          <span className="text-[10px] text-white/25">Built {yearStr}</span>
        )}
      </div>
    </div>
  )
}

// ─── Single building card inside the Buildings module ─────────────────────────

function BuildingItem({
  building,
  selected,
  onSelect,
  onHoverEnter,
  onHoverLeave,
}: {
  building: GwrFeature
  selected: boolean
  onSelect: () => void
  onHoverEnter: () => void
  onHoverLeave: () => void
}) {
  const attrs: { label: string; value: string | number }[] = []

  if (building.status && building.status !== '—')
    attrs.push({ label: 'Status', value: building.status })
  if (building.category && building.category !== '—')
    attrs.push({ label: 'Category', value: building.category })
  if (building.constructionYear)
    attrs.push({ label: 'Built', value: building.constructionYear })
  else if (building.constructionPeriod && building.constructionPeriod !== '—')
    attrs.push({ label: 'Built', value: building.constructionPeriod })
  if (building.floors != null)
    attrs.push({ label: 'Floors', value: building.floors })
  if (building.apartments != null && building.apartments > 0)
    attrs.push({ label: 'Apartments', value: building.apartments })
  if (building.footprintM2 != null)
    attrs.push({ label: 'Footprint', value: `${building.footprintM2} m²` })
  if (building.heatingSystem && building.heatingSystem !== '—')
    attrs.push({ label: 'Heating', value: building.heatingSystem })
  if (building.energySourceHeating && building.energySourceHeating !== '—')
    attrs.push({ label: 'Energy (heat)', value: building.energySourceHeating })
  if (building.energySourceHotWater && building.energySourceHotWater !== '—')
    attrs.push({ label: 'Energy (water)', value: building.energySourceHotWater })

  return (
    <div className={`border-b border-white/[0.04] last:border-0 transition-colors ${
      selected ? 'bg-accent/[0.07]' : ''
    }`}>
      {/* Clickable header */}
      <button
        onClick={onSelect}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        className={`w-full text-left px-4 py-2.5 transition-colors ${
          selected ? '' : 'hover:bg-white/[0.03]'
        }`}
      >
        <p className={`text-[11px] leading-tight truncate font-medium ${
          selected ? 'text-accent' : 'text-white/70'
        }`}>
          {building.address !== '—' ? building.address : 'Unknown address'}
        </p>
        <p className="text-[10px] text-white/25 font-mono leading-tight mt-0.5">
          EGID {building.egid}
          {building.municipality !== '—' && ` · ${building.municipality}`}
        </p>
      </button>

      {/* Attributes — always visible when parent module is open */}
      {attrs.length > 0 && (
        <div className="px-4 pb-2.5 divide-y divide-white/[0.03]">
          {attrs.map(a => <Attr key={a.label} label={a.label} value={a.value} />)}
        </div>
      )}
    </div>
  )
}

// ─── Buildings module ─────────────────────────────────────────────────────────

function BuildingsModule() {
  const {
    selectedGWR,
    setAnalysisSelectedEgid,
    setAnalysisHoveredEgid,
  } = useMapStore()

  const [open, setOpen] = useState(false)
  const [selectedEgid, setSelectedEgid] = useState<string | null>(
    selectedGWR[0]?.egid ?? null
  )
  const prevLengthRef = useRef(selectedGWR.length)

  useEffect(() => {
    const first = selectedGWR[0]?.egid ?? null
    setSelectedEgid(first)
    setAnalysisSelectedEgid(first && first !== '—' ? Number(first) : null)
    if (selectedGWR.length > 0 && prevLengthRef.current === 0) setOpen(true)
    prevLengthRef.current = selectedGWR.length
  }, [selectedGWR]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      setAnalysisSelectedEgid(null)
      setAnalysisHoveredEgid(null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (egid: string) => {
    setSelectedEgid(egid)
    setAnalysisSelectedEgid(egid !== '—' ? Number(egid) : null)
  }

  const handleHoverEnter = (egid: string) => {
    if (egid === selectedEgid) return
    setAnalysisHoveredEgid(egid !== '—' ? Number(egid) : null)
  }

  const handleHoverLeave = () => setAnalysisHoveredEgid(null)

  const summary = selectedGWR.length === 0
    ? 'Select a parcel'
    : `${selectedGWR.length} building${selectedGWR.length !== 1 ? 's' : ''}`

  return (
    <div className="border-b border-white/[0.05]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="shrink-0 text-white/35"><BuildingIcon /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-white/75 font-medium leading-tight">GWR</p>
          <p className="text-[10px] text-white/30 leading-tight mt-0.5">{summary}</p>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div>
          {selectedGWR.length === 0 ? (
            <p className="px-4 pb-4 pt-1 text-[11px] text-white/20 italic">No parcel selected.</p>
          ) : (
            selectedGWR.map(b => (
              <BuildingItem
                key={b.egid}
                building={b}
                selected={b.egid === selectedEgid}
                onSelect={() => handleSelect(b.egid)}
                onHoverEnter={() => handleHoverEnter(b.egid)}
                onHoverLeave={handleHoverLeave}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Measurements module ──────────────────────────────────────────────────────

function MeasurementRow({
  m, address, selected, onHoverEnter, onHoverLeave,
}: {
  m: BuildingMeasurements
  address: string
  selected: boolean
  onHoverEnter: () => void
  onHoverLeave: () => void
}) {
  return (
    <div
      className={`border-b border-white/[0.04] last:border-0 transition-colors ${selected ? 'bg-accent/[0.07]' : ''}`}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      <div className="px-4 py-2.5">
        <p className={`text-[11px] font-medium leading-tight truncate mb-1.5 ${selected ? 'text-accent' : 'text-white/60'}`}>
          {address}
        </p>
        <div className="divide-y divide-white/[0.03]">
          <Attr label="Volume" value={`${m.volumeM3.toFixed(1)} m³`} />
          <Attr label="Facade" value={`${m.facadeM2.toFixed(1)} m²`} />
          <Attr label="Roof area" value={`${m.roofM2.toFixed(1)} m²`} />
          <Attr label="Circumference" value={`${m.circumferenceM.toFixed(1)} m`} />
          <Attr label="Footprint" value={`${m.footprintM2.toFixed(1)} m²`} />
        </div>
      </div>
    </div>
  )
}

function MeasurementsModule() {
  const { selectedGWR, buildingMeasurements, setAnalysisHoveredEgid, analysisSelectedEgid } = useMapStore()
  const [open, setOpen] = useState(false)

  const egidToAddress = Object.fromEntries(
    selectedGWR.map(b => [Number(b.egid), b.address !== '—' ? b.address : `EGID ${b.egid}`])
  )

  const entries = buildingMeasurements
    ? Object.entries(buildingMeasurements).map(([egid, m]) => ({ egid: Number(egid), m }))
    : []

  const summary = buildingMeasurements === null
    ? 'Loading from 3D model…'
    : `${entries.length} building${entries.length !== 1 ? 's' : ''} measured`

  return (
    <div className="border-b border-white/[0.05]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="shrink-0 text-white/35"><RulerIcon /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-white/75 font-medium leading-tight">Measurements</p>
          <p className="text-[10px] text-white/30 leading-tight mt-0.5">{summary}</p>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div>
          {buildingMeasurements === null ? (
            <div className="flex items-center gap-2.5 px-4 py-4 text-white/30 text-[11px]">
              <span className="w-3 h-3 shrink-0 rounded-full border-2 border-white/10 border-t-accent animate-spin" />
              Computing from 3D geometry…
            </div>
          ) : entries.length === 0 ? (
            <p className="px-4 pb-4 pt-1 text-[11px] text-white/20 italic">No 3D data available.</p>
          ) : (
            entries.map(({ egid, m }) => (
              <MeasurementRow
                key={egid}
                m={m}
                address={egidToAddress[egid] ?? `EGID ${egid}`}
                selected={egid === analysisSelectedEgid}
                onHoverEnter={() => { if (egid !== analysisSelectedEgid) setAnalysisHoveredEgid(egid) }}
                onHoverLeave={() => setAnalysisHoveredEgid(null)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sun & Shadow module ──────────────────────────────────────────────────────

function formatHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h % 1) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function SunShadowModule() {
  const {
    sunDayOfYear, setSunDayOfYear,
    sunHourOfDay, setSunHourOfDay,
    selectedParcel,
  } = useMapStore()
  const [open, setOpen] = useState(false)

  // Derive lat/lon from parcel centroid — accurate enough for solar calculations
  const latLon = selectedParcel
    ? (() => {
        const coords = (selectedParcel.geometry.coordinates as [number, number][][]).flat()
        return {
          lat: coords.reduce((s, c) => s + c[1], 0) / coords.length,
          lon: coords.reduce((s, c) => s + c[0], 0) / coords.length,
        }
      })()
    : null

  const { elevation } = latLon
    ? computeSunPosition(latLon.lat, sunDayOfYear, sunHourOfDay)
    : { elevation: 0 }

  const isSunUp = elevation > 0
  const summary = `${dayOfYearToLabel(sunDayOfYear)} · ${formatHour(sunHourOfDay)}`

  return (
    <div className="border-b border-white/[0.05]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="shrink-0 text-white/35"><SunIcon /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-white/75 font-medium leading-tight">Sun & Shadow</p>
          <p className="text-[10px] text-white/30 leading-tight mt-0.5">{summary}</p>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {!latLon && (
            <p className="text-[11px] text-white/20 italic pt-1">
              Select a parcel to enable shadow simulation.
            </p>
          )}

          {/* Sliders */}
          <div className="space-y-3 pt-1">
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] text-white/30">Day of year</span>
                <span className="text-[10px] text-white/60 font-mono">{dayOfYearToLabel(sunDayOfYear)}</span>
              </div>
              <input
                type="range" min={1} max={365} step={1}
                value={sunDayOfYear}
                onChange={e => setSunDayOfYear(Number(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/10 accent-[#00E5FF]"
              />
            </div>

            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] text-white/30">Time of day</span>
                <span className="text-[10px] text-white/60 font-mono">
                  {formatHour(sunHourOfDay)}
                  {isSunUp
                    ? <span className="text-[9px] text-amber-400/60 ml-1.5">{elevation.toFixed(1)}°</span>
                    : <span className="text-[9px] text-white/20 ml-1.5"> below horizon</span>
                  }
                </span>
              </div>
              <input
                type="range" min={0} max={24} step={0.25}
                value={sunHourOfDay}
                onChange={e => setSunHourOfDay(Number(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/10 accent-[#00E5FF]"
              />
              <div className="flex justify-between mt-1 px-px">
                {[0, 6, 12, 18, 24].map(h => (
                  <span key={h} className="text-[8px] text-white/15">{h}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Charts */}
          {latLon && (
            <SunShadowCharts
              latDeg={latLon.lat}
              dayOfYear={sunDayOfYear}
              hourOfDay={sunHourOfDay}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Energy module ────────────────────────────────────────────────────────────

const RENEWABLE_SOURCES = new Set([
  'Wood', 'Wood Pellets', 'Wood Chips', 'Firewood',
  'Heat Pump', 'Ground Source', 'Water Source', 'Air Source', 'Solar',
])
const FOSSIL_SOURCES = new Set(['Gas', 'Biogas', 'Oil'])

function energyTag(source: string): 'renewable' | 'fossil' | 'other' {
  if (RENEWABLE_SOURCES.has(source)) return 'renewable'
  if (FOSSIL_SOURCES.has(source)) return 'fossil'
  return 'other'
}

function EnergyModule() {
  const { selectedGWR } = useMapStore()
  const [open, setOpen] = useState(false)

  const withData = selectedGWR.filter(b =>
    b.heatingSystem !== '—' || b.energySourceHeating !== '—' || b.energySourceHotWater !== '—'
  )

  const countRenewable = withData.filter(b => energyTag(b.energySourceHeating) === 'renewable').length
  const countFossil    = withData.filter(b => energyTag(b.energySourceHeating) === 'fossil').length

  const summary = withData.length === 0
    ? selectedGWR.length === 0 ? 'No parcel selected' : 'No data'
    : `${withData.length} building${withData.length !== 1 ? 's' : ''}`

  return (
    <div className="border-b border-white/[0.05]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="shrink-0 text-white/35"><BoltIcon /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-white/75 font-medium leading-tight">Energy</p>
          <p className="text-[10px] text-white/30 leading-tight mt-0.5">{summary}</p>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div>
          {withData.length === 0 ? (
            <p className="px-4 pb-4 pt-1 text-[11px] text-white/20 italic">
              {selectedGWR.length === 0 ? 'No parcel selected.' : 'No energy data available.'}
            </p>
          ) : (
            <>
              {(countRenewable > 0 || countFossil > 0) && (
                <div className="flex gap-2 px-4 pt-1 pb-2.5">
                  {countRenewable > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-400/10 text-emerald-400/70">
                      {countRenewable} renewable
                    </span>
                  )}
                  {countFossil > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] bg-amber-400/10 text-amber-400/70">
                      {countFossil} fossil
                    </span>
                  )}
                </div>
              )}
              {withData.map((b, i) => {
                const tag = energyTag(b.energySourceHeating)
                return (
                  <div key={b.egid} className="border-b border-white/[0.04] last:border-0 px-4 py-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <p className="text-[11px] text-white/55 truncate flex-1">
                        {b.address !== '—' ? b.address : `Building ${i + 1}`}
                      </p>
                      {tag !== 'other' && (
                        <span className={`shrink-0 text-[9px] px-1.5 py-px rounded-full ${
                          tag === 'renewable'
                            ? 'bg-emerald-400/10 text-emerald-400/60'
                            : 'bg-amber-400/10 text-amber-400/60'
                        }`}>
                          {tag}
                        </span>
                      )}
                    </div>
                    <div className="divide-y divide-white/[0.03]">
                      {b.heatingSystem !== '—'         && <Attr label="System"      value={b.heatingSystem} />}
                      {b.energySourceHeating !== '—'   && <Attr label="Heat source" value={b.energySourceHeating} />}
                      {b.energySourceHotWater !== '—'  && <Attr label="Hot water"   value={b.energySourceHotWater} />}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── GEAK module ──────────────────────────────────────────────────────────────

function GEAKIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
      <path d="M13 13h4M13 17h4" />
    </svg>
  )
}

// A–G scale bar for one label
function GEAKScaleBar({ currentClass, value, unit }: {
  currentClass: string
  value: number
  unit: string
}) {
  const classes = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  return (
    <div className="space-y-1">
      <div className="flex gap-px">
        {classes.map(cls => {
          const active = cls === currentClass
          return (
            <div
              key={cls}
              style={{ backgroundColor: GEAK_CLASS_COLORS[cls] + (active ? 'ff' : '33') }}
              className={`flex-1 h-5 flex items-center justify-center transition-all ${
                active ? 'ring-1 ring-white/60 ring-offset-1 ring-offset-[#080808]' : ''
              }`}
            >
              <span className={`text-[9px] font-bold ${active ? 'text-white' : 'text-white/30'}`}>
                {cls}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between">
        <span className="text-[9px] text-white/20">A</span>
        <span className="text-[10px] font-mono text-white/55">
          {value} <span className="text-[9px] text-white/25">{unit}</span>
        </span>
        <span className="text-[9px] text-white/20">G</span>
      </div>
    </div>
  )
}

// Compact number input
function NumInput({
  label, value, onChange, unit, step = 0.01, min = 0,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  unit?: string
  step?: number
  min?: number
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-white/25">{label}</span>
      <div className="flex items-baseline gap-1">
        <input
          type="number"
          step={step}
          min={min}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full text-[10px] text-white/70 bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5 outline-none focus:border-accent/40"
        />
        {unit && <span className="text-[9px] text-white/20 shrink-0">{unit}</span>}
      </div>
    </div>
  )
}

// Compact select input
function SelInput<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: T[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-white/25">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className="text-[10px] text-white/70 bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5 outline-none focus:border-accent/40"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// Collapsible sub-section inside GEAK
function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-white/[0.04]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-0 py-2 text-left"
      >
        <span className="text-[10px] text-white/40 font-medium">{title}</span>
        <ChevronIcon open={open} />
      </button>
      {open && <div className="pb-2 space-y-2">{children}</div>}
    </div>
  )
}

function GEAKModule() {
  const { selectedGWR, buildingMeasurements, analysisSelectedEgid } = useMapStore()
  const [open, setOpen] = useState(false)

  // Derive the active building
  const activeBldg: GwrFeature | null = useMemo(() => {
    if (analysisSelectedEgid != null) {
      return selectedGWR.find(b => Number(b.egid) === analysisSelectedEgid) ?? selectedGWR[0] ?? null
    }
    return selectedGWR[0] ?? null
  }, [selectedGWR, analysisSelectedEgid])

  const activeMeasurements: BuildingMeasurements | null = useMemo(() => {
    if (!buildingMeasurements) return null
    const egid = activeBldg ? Number(activeBldg.egid) : null
    return egid != null ? (buildingMeasurements[egid] ?? null) : null
  }, [buildingMeasurements, activeBldg])

  const [inputs, setInputs] = useState<GEAKInputs>(() =>
    getDefaultInputs(activeBldg, activeMeasurements)
  )

  // Re-derive defaults when active building or measurements change
  useEffect(() => {
    setInputs(getDefaultInputs(activeBldg, activeMeasurements))
  }, [activeBldg, activeMeasurements]) // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => calculateGEAK(inputs), [inputs])

  function set<K extends keyof GEAKInputs>(key: K, val: GEAKInputs[K]) {
    setInputs(prev => ({ ...prev, [key]: val }))
  }

  const headerSummary = activeBldg
    ? `${results.classHuelle} · ${results.classGesamt} · ${results.classCO2}`
    : 'No parcel selected'

  return (
    <div className="border-b border-white/[0.05]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="shrink-0 text-white/35"><GEAKIcon /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-white/75 font-medium leading-tight">GEAK</p>
          <p className="text-[10px] text-white/30 leading-tight mt-0.5">{headerSummary}</p>
        </div>
        {activeBldg && (
          <div className="flex gap-1 shrink-0">
            {[results.classHuelle, results.classGesamt, results.classCO2].map((cls, i) => (
              <span
                key={i}
                style={{ backgroundColor: GEAK_CLASS_COLORS[cls] + '33', color: GEAK_CLASS_COLORS[cls] }}
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              >
                {cls}
              </span>
            ))}
          </div>
        )}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {!activeBldg ? (
            <p className="text-[11px] text-white/20 italic pt-1">No parcel selected.</p>
          ) : (
            <>
              {/* Results */}
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <p className="text-[9px] text-white/25 uppercase tracking-widest">Gebäudehülle</p>
                  <GEAKScaleBar
                    currentClass={results.classHuelle}
                    value={results.qHEff}
                    unit="kWh/(m²·a)"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-white/25 uppercase tracking-widest">Gesamtenergie</p>
                  <GEAKScaleBar
                    currentClass={results.classGesamt}
                    value={results.eGew}
                    unit="kWh/(m²·a)"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-white/25 uppercase tracking-widest">CO₂ direkt</p>
                  <GEAKScaleBar
                    currentClass={results.classCO2}
                    value={results.co2Direkt}
                    unit="kg/(m²·a)"
                  />
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 h-px bg-white/[0.05]" />
                <span className="text-[9px] text-white/20 uppercase tracking-widest">Eingaben</span>
                <div className="flex-1 h-px bg-white/[0.05]" />
              </div>

              {/* Gebäude — always visible */}
              <div className="grid grid-cols-2 gap-2">
                <NumInput
                  label="Energiebezugsfläche A_E"
                  value={inputs.aE}
                  onChange={v => set('aE', Math.max(1, v))}
                  unit="m²"
                  step={1}
                  min={1}
                />
                <SelInput<GEAKUsage>
                  label="Nutzung"
                  value={inputs.usage}
                  options={USAGES}
                  onChange={v => set('usage', v)}
                />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-[9px] text-white/25">Kanton</span>
                <span className="text-[10px] text-white/50 font-mono">{inputs.canton}</span>
              </div>

              {/* Gebäudehülle */}
              <SubSection title="Gebäudehülle">
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="U-Wand" value={inputs.uWall}   onChange={v => set('uWall', v)}   unit="W/(m²·K)" />
                  <NumInput label="U-Dach"  value={inputs.uRoof}   onChange={v => set('uRoof', v)}   unit="W/(m²·K)" />
                  <NumInput label="U-Boden" value={inputs.uFloor}  onChange={v => set('uFloor', v)}  unit="W/(m²·K)" />
                  <NumInput label="U-Fenster" value={inputs.uWindow} onChange={v => set('uWindow', v)} unit="W/(m²·K)" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <NumInput label="Fensteranteil" value={Math.round(inputs.windowFraction * 100)} onChange={v => set('windowFraction', v / 100)} unit="%" step={1} min={5} />
                  <NumInput label="g-Wert" value={inputs.gValue} onChange={v => set('gValue', v)} />
                  <NumInput label="Verschattung Fs" value={inputs.shadingFs} onChange={v => set('shadingFs', v)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="Luftdichtheit n₅₀" value={inputs.n50} onChange={v => set('n50', v)} unit="h⁻¹" step={0.1} />
                  <NumInput label="Wärmebrücken ΔU"   value={inputs.thermalBridges} onChange={v => set('thermalBridges', v)} unit="W/(m²·K)" />
                </div>
              </SubSection>

              {/* Heizung & WW */}
              <SubSection title="Heizung & Warmwasser">
                <SelInput<GEAKHeatingSystem>
                  label="Heizsystem"
                  value={inputs.heatingSystem}
                  options={HEATING_SYSTEMS}
                  onChange={v => {
                    set('heatingSystem', v)
                    set('cop', defaultCOP(v))
                  }}
                />
                <NumInput
                  label={inputs.heatingSystem.startsWith('WP') ? 'COP' : 'Wirkungsgrad η'}
                  value={inputs.cop}
                  onChange={v => set('cop', v)}
                  step={0.1}
                  min={0.5}
                />
              </SubSection>

              {/* Lüftung */}
              <SubSection title="Lüftung">
                <SelInput<GEAKVentilation>
                  label="Lüftungstyp"
                  value={inputs.ventilation}
                  options={VENTILATION_TYPES}
                  onChange={v => set('ventilation', v)}
                />
                {inputs.ventilation === 'Mechanisch' && (
                  <NumInput
                    label="Wärmerückgewinnungsgrad"
                    value={Math.round(inputs.heatRecovery * 100)}
                    onChange={v => set('heatRecovery', v / 100)}
                    unit="%"
                    step={1}
                    min={0}
                  />
                )}
              </SubSection>

              {/* PV */}
              <SubSection title="Photovoltaik">
                <NumInput
                  label="PV-Leistung"
                  value={inputs.pvKwp}
                  onChange={v => set('pvKwp', v)}
                  unit="kWp"
                  step={0.5}
                  min={0}
                />
              </SubSection>

              {/* Detail breakdown */}
              <div className="border-t border-white/[0.04] pt-2 divide-y divide-white/[0.03]">
                <Attr label="Heizwärmebedarf Q_H,eff" value={`${results.qHEff} kWh/(m²·a)`} />
                <Attr label="Endenergie Heizung"       value={`${results.eH.toLocaleString()} kWh/a`} />
                <Attr label="Endenergie Warmwasser"    value={`${results.eWW.toLocaleString()} kWh/a`} />
                {results.eLueft > 0 && <Attr label="Hilfsenergie Lüftung" value={`${results.eLueft.toLocaleString()} kWh/a`} />}
                {results.ePV > 0    && <Attr label="PV-Produktion"        value={`−${results.ePV.toLocaleString()} kWh/a`} />}
                <Attr label="Gewichtete Energie E_gew" value={`${results.eGew} kWh/(m²·a)`} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function AnalysisModules() {
  return (
    <div className="h-full flex flex-col bg-[#080808] overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <ParcelSummary />
        <BuildingsModule />
        <MeasurementsModule />
        <EnergyModule />
        <SunShadowModule />
        <GEAKModule />
      </div>
    </div>
  )
}

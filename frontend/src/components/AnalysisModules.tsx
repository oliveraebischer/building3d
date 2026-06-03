import { useState, useEffect } from 'react'
import { useMapStore } from '../store/mapStore'
import type { GwrFeature } from '../api/geoAdmin'
import type { BuildingMeasurements } from '../utils/buildingMeasurements'
import { computeSunPosition, dayOfYearToLabel } from '../utils/solarPosition'
import SunShadowCharts from './SunShadowCharts'

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

  useEffect(() => {
    const first = selectedGWR[0]?.egid ?? null
    setSelectedEgid(first)
    setAnalysisSelectedEgid(first && first !== '—' ? Number(first) : null)
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
    sunSceneCenter,
  } = useMapStore()
  const [open, setOpen] = useState(false)

  const { elevation } = sunSceneCenter
    ? computeSunPosition(sunSceneCenter.lat, sunDayOfYear, sunHourOfDay)
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
          {!sunSceneCenter && (
            <p className="text-[11px] text-white/20 italic pt-1">
              Load a 3D scene to enable shadow simulation.
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
          {sunSceneCenter && (
            <SunShadowCharts
              latDeg={sunSceneCenter.lat}
              dayOfYear={sunDayOfYear}
              hourOfDay={sunHourOfDay}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Generic placeholder module ───────────────────────────────────────────────

type ModuleDef = {
  id: string
  icon: React.ReactNode
  title: string
  summary: string
}

const MODULES: ModuleDef[] = [
  {
    id: 'energy',
    icon: <BoltIcon />,
    title: 'Energy',
    summary: 'Heating demand and solar potential',
  },
]

function ModuleCard({ mod }: { mod: ModuleDef }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-white/[0.05] last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="shrink-0 text-white/35">{mod.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-white/75 font-medium leading-tight">{mod.title}</p>
          <p className="text-[10px] text-white/30 leading-tight mt-0.5">{mod.summary}</p>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1">
          <p className="text-[11px] text-white/20 italic">Coming soon.</p>
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
        <BuildingsModule />
        <MeasurementsModule />
        <SunShadowModule />
        {MODULES.map(mod => (
          <ModuleCard key={mod.id} mod={mod} />
        ))}
      </div>
    </div>
  )
}

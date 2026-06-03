import { useMemo } from 'react'
import {
  computeSunPosition, getSunriseSunset,
  getElevationCurve, getMonthlyDaylightHours,
  getSunPathArc, getFacadeSunHours,
  dayOfYearToMonth,
  type SunPosition, type FacadeSunHours,
} from '../utils/solarPosition'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0')
}
function fmtHour(h: number): string {
  return `${fmt2(h)}:${fmt2((h % 1) * 60)}`
}

function ChartLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] text-white/20 font-medium tracking-widest uppercase mb-1.5">
      {children}
    </p>
  )
}

// ─── Chart 1: Sun Elevation Curve ────────────────────────────────────────────

function ElevationCurveChart({
  elevCurve, hourOfDay, sunPos, sunrise, sunset,
}: {
  elevCurve: { hour: number; elevation: number }[]
  hourOfDay: number
  sunPos: SunPosition
  sunrise: number
  sunset: number
}) {
  const W = 280, H = 110
  const ml = 30, mr = 8, mt = 10, mb = 22
  const pw = W - ml - mr, ph = H - mt - mb
  const minEl = -10, maxEl = 90

  const mapX = (h: number) => ml + (h / 24) * pw
  const mapY = (e: number) => mt + ph - ((e - minEl) / (maxEl - minEl)) * ph
  const horizY = mapY(0)

  // Split curve into above/below horizon segments
  const abovePoints: string[] = []
  const belowPoints: string[] = []
  for (const { hour, elevation } of elevCurve) {
    const x = mapX(hour).toFixed(1), y = mapY(elevation).toFixed(1)
    abovePoints.push(elevation >= 0 ? `${x},${y}` : `${x},${horizY.toFixed(1)}`)
    belowPoints.push(elevation <= 0 ? `${x},${y}` : `${x},${horizY.toFixed(1)}`)
  }

  const curX = mapX(hourOfDay)
  const curY = mapY(sunPos.elevation)
  const isSunUp = sunPos.elevation > 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <rect width={W} height={H} fill="#0a0a0a" rx="3" />
      {/* Grid lines */}
      {[30, 60].map(e => (
        <line key={e} x1={ml} y1={mapY(e)} x2={W - mr} y2={mapY(e)}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      {/* Horizon */}
      <line x1={ml} y1={horizY} x2={W - mr} y2={horizY}
        stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      {/* Below-horizon curve */}
      <polyline points={belowPoints.join(' ')} fill="none"
        stroke="rgba(255,255,255,0.1)" strokeWidth="1.2" />
      {/* Above-horizon curve */}
      <polyline points={abovePoints.join(' ')} fill="none"
        stroke="#f59e0b" strokeWidth="1.5" />
      {/* Sunrise / sunset ticks */}
      {[sunrise, sunset].map((t, i) => (
        <line key={i} x1={mapX(t)} y1={horizY - 6} x2={mapX(t)} y2={horizY}
          stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      ))}
      {/* Current hour line */}
      <line x1={curX} y1={mt} x2={curX} y2={H - mb}
        stroke="#00E5FF" strokeWidth="1" strokeOpacity="0.6" strokeDasharray="2 2" />
      {/* Current position dot */}
      {isSunUp && (
        <circle cx={curX} cy={curY} r="3" fill="#00E5FF" />
      )}
      {/* Y-axis labels */}
      {[0, 30, 60].map(e => (
        <text key={e} x={ml - 3} y={mapY(e) + 3.5} textAnchor="end"
          fontSize="7" fill="rgba(255,255,255,0.25)">{e}°</text>
      ))}
      {/* X-axis labels */}
      {[6, 12, 18].map(h => (
        <text key={h} x={mapX(h)} y={H - 5} textAnchor="middle"
          fontSize="7" fill="rgba(255,255,255,0.2)">{h}</text>
      ))}
      {/* Sunrise / sunset times */}
      <text x={mapX(sunrise)} y={horizY + 11} textAnchor="middle"
        fontSize="7" fill="rgba(255,255,255,0.3)">{fmtHour(sunrise)}</text>
      <text x={mapX(sunset)} y={horizY + 11} textAnchor="middle"
        fontSize="7" fill="rgba(255,255,255,0.3)">{fmtHour(sunset)}</text>
      {/* Current elevation */}
      {isSunUp && (
        <text x={W - mr - 2} y={mt + 8} textAnchor="end"
          fontSize="8" fill="#f59e0b">{sunPos.elevation.toFixed(1)}°</text>
      )}
    </svg>
  )
}

// ─── Chart 2: Monthly Daylight Hours ─────────────────────────────────────────

const MONTH_CHARS = ['J','F','M','A','M','J','J','A','S','O','N','D']

function MonthlyDaylightChart({
  monthlyHours, dayOfYear,
}: {
  monthlyHours: number[]
  dayOfYear: number
}) {
  const W = 280, H = 90
  const ml = 26, mr = 6, mt = 8, mb = 18
  const pw = W - ml - mr, ph = H - mt - mb
  const maxH = 18
  const currentMonth = dayOfYearToMonth(dayOfYear)
  const slotW = pw / 12

  const mapY = (h: number) => mt + ph - (h / maxH) * ph
  const barH = (h: number) => (h / maxH) * ph

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <rect width={W} height={H} fill="#0a0a0a" rx="3" />
      {/* Grid */}
      {[6, 12].map(h => (
        <line key={h} x1={ml} y1={mapY(h)} x2={W - mr} y2={mapY(h)}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      {/* Bars */}
      {monthlyHours.map((h, i) => {
        const x = ml + i * slotW + slotW * 0.15
        const bw = slotW * 0.7
        const by = mapY(h)
        const bh = barH(h)
        const isCurrent = i === currentMonth
        return (
          <g key={i}>
            <rect x={x} y={by} width={bw} height={bh}
              fill={isCurrent ? '#00E5FF' : 'rgba(255,255,255,0.12)'}
              fillOpacity={isCurrent ? 0.7 : 1} rx="1" />
            {isCurrent && (
              <text x={x + bw / 2} y={by - 2} textAnchor="middle"
                fontSize="7" fill="#00E5FF">{h.toFixed(1)}h</text>
            )}
          </g>
        )
      })}
      {/* Month labels */}
      {MONTH_CHARS.map((c, i) => (
        <text key={i} x={ml + i * slotW + slotW / 2} y={H - 4}
          textAnchor="middle" fontSize="7"
          fill={i === currentMonth ? 'rgba(0,229,255,0.6)' : 'rgba(255,255,255,0.2)'}>
          {c}
        </text>
      ))}
      {/* Y-axis label */}
      <text x={ml - 3} y={mt + 5} textAnchor="end"
        fontSize="7" fill="rgba(255,255,255,0.2)">18h</text>
    </svg>
  )
}

// ─── Chart 3: Sun Path Diagram ────────────────────────────────────────────────

function arcPoints(arc: SunPosition[], mapX: (az: number) => number, mapY: (el: number) => number): string {
  return arc.map(p => `${mapX(p.azimuth).toFixed(1)},${mapY(p.elevation).toFixed(1)}`).join(' ')
}

function SunPathChart({
  summerArc, equinoxArc, winterArc, currentArc, sunPos,
}: {
  summerArc: SunPosition[]
  equinoxArc: SunPosition[]
  winterArc: SunPosition[]
  currentArc: SunPosition[]
  sunPos: SunPosition
}) {
  const W = 280, H = 160
  const ml = 28, mr = 8, mt = 12, mb = 24
  const pw = W - ml - mr, ph = H - mt - mb
  const minAz = 40, maxAz = 320
  const maxEl = 75

  const mapX = (az: number) => ml + ((az - minAz) / (maxAz - minAz)) * pw
  const mapY = (el: number) => mt + ph - (el / maxEl) * ph
  const horizY = mt + ph

  const cardinals: [number, string][] = [[90, 'E'], [180, 'S'], [270, 'W']]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <rect width={W} height={H} fill="#0a0a0a" rx="3" />
      {/* Elevation grid */}
      {[15, 30, 45, 60].map(e => (
        <line key={e} x1={ml} y1={mapY(e)} x2={W - mr} y2={mapY(e)}
          stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      ))}
      {/* Cardinal verticals */}
      {cardinals.map(([az]) => (
        <line key={az} x1={mapX(az)} y1={mt} x2={mapX(az)} y2={horizY}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      {/* Horizon */}
      <line x1={ml} y1={horizY} x2={W - mr} y2={horizY}
        stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      {/* Reference arcs */}
      {winterArc.length > 1 && (
        <polyline points={arcPoints(winterArc, mapX, mapY)} fill="none"
          stroke="#60a5fa" strokeWidth="1" strokeOpacity="0.35" />
      )}
      {equinoxArc.length > 1 && (
        <polyline points={arcPoints(equinoxArc, mapX, mapY)} fill="none"
          stroke="#a3a3a3" strokeWidth="1" strokeOpacity="0.35" />
      )}
      {summerArc.length > 1 && (
        <polyline points={arcPoints(summerArc, mapX, mapY)} fill="none"
          stroke="#f97316" strokeWidth="1" strokeOpacity="0.35" />
      )}
      {/* Current day arc */}
      {currentArc.length > 1 && (
        <polyline points={arcPoints(currentArc, mapX, mapY)} fill="none"
          stroke="#00E5FF" strokeWidth="1.5" />
      )}
      {/* Current sun position */}
      {sunPos.elevation > 0 && (
        <circle cx={mapX(sunPos.azimuth)} cy={mapY(sunPos.elevation)} r="4"
          fill="#FFD700" stroke="#0a0a0a" strokeWidth="0.5" />
      )}
      {/* Cardinal labels */}
      {cardinals.map(([az, label]) => (
        <text key={az} x={mapX(az)} y={H - 6} textAnchor="middle"
          fontSize="8" fill="rgba(255,255,255,0.25)">{label}</text>
      ))}
      {/* Elevation labels */}
      {[30, 60].map(e => (
        <text key={e} x={ml - 3} y={mapY(e) + 3} textAnchor="end"
          fontSize="7" fill="rgba(255,255,255,0.2)">{e}°</text>
      ))}
      {/* Legend */}
      {[
        { color: '#60a5fa', label: 'Dec 21' },
        { color: '#a3a3a3', label: 'Mar 20' },
        { color: '#f97316', label: 'Jun 21' },
      ].map(({ color, label }, i) => (
        <g key={i} transform={`translate(${W - mr - 60},${mt + 2 + i * 10})`}>
          <line x1="0" y1="3" x2="10" y2="3" stroke={color} strokeWidth="1.5" strokeOpacity="0.5" />
          <text x="13" y="6" fontSize="7" fill="rgba(255,255,255,0.2)">{label}</text>
        </g>
      ))}
    </svg>
  )
}

// ─── Chart 4: Facade Sun Hours ────────────────────────────────────────────────

function FacadeSunChart({ facadeHours }: { facadeHours: FacadeSunHours }) {
  const W = 280, H = 92
  const ml = 22, mr = 48, mt = 8
  const pw = W - ml - mr
  const rowH = (H - mt) / 4
  const maxHours = 16

  const directions: { key: keyof FacadeSunHours; color: string }[] = [
    { key: 'S', color: '#f59e0b' },
    { key: 'E', color: '#3b82f6' },
    { key: 'W', color: '#a855f7' },
    { key: 'N', color: '#6b7280' },
  ]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <rect width={W} height={H} fill="#0a0a0a" rx="3" />
      {directions.map(({ key, color }, i) => {
        const h = facadeHours[key]
        const bw = (h / maxHours) * pw
        const y = mt + i * rowH
        const bh = rowH - 4
        return (
          <g key={key}>
            {/* Direction label */}
            <text x={ml - 4} y={y + bh * 0.5 + 3.5} textAnchor="end"
              fontSize="8" fontWeight="600" fill={color} fillOpacity="0.7">{key}</text>
            {/* Background track */}
            <rect x={ml} y={y + 2} width={pw} height={bh}
              fill="rgba(255,255,255,0.04)" rx="2" />
            {/* Filled bar */}
            {bw > 0 && (
              <rect x={ml} y={y + 2} width={bw} height={bh}
                fill={color} fillOpacity="0.4" rx="2" />
            )}
            {/* Hours label */}
            <text x={ml + pw + 4} y={y + bh * 0.5 + 3.5}
              fontSize="8" fill="rgba(255,255,255,0.4)">{h.toFixed(1)}h</text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function SunShadowCharts({
  latDeg, dayOfYear, hourOfDay,
}: {
  latDeg: number
  dayOfYear: number
  hourOfDay: number
}) {
  const elevCurve    = useMemo(() => getElevationCurve(latDeg, dayOfYear),       [latDeg, dayOfYear])
  const monthlyHours = useMemo(() => getMonthlyDaylightHours(latDeg),            [latDeg])
  const facadeHours  = useMemo(() => getFacadeSunHours(latDeg, dayOfYear),       [latDeg, dayOfYear])
  const sunPos       = useMemo(() => computeSunPosition(latDeg, dayOfYear, hourOfDay), [latDeg, dayOfYear, hourOfDay])
  const { sunrise, sunset } = useMemo(() => getSunriseSunset(latDeg, dayOfYear), [latDeg, dayOfYear])
  const summerArc  = useMemo(() => getSunPathArc(latDeg, 172), [latDeg])
  const equinoxArc = useMemo(() => getSunPathArc(latDeg, 80),  [latDeg])
  const winterArc  = useMemo(() => getSunPathArc(latDeg, 355), [latDeg])
  const currentArc = useMemo(() => getSunPathArc(latDeg, dayOfYear), [latDeg, dayOfYear])

  return (
    <div className="space-y-3 pt-1">
      <div>
        <ChartLabel>Sun elevation</ChartLabel>
        <ElevationCurveChart elevCurve={elevCurve} hourOfDay={hourOfDay}
          sunPos={sunPos} sunrise={sunrise} sunset={sunset} />
      </div>
      <div>
        <ChartLabel>Monthly daylight hours</ChartLabel>
        <MonthlyDaylightChart monthlyHours={monthlyHours} dayOfYear={dayOfYear} />
      </div>
      <div>
        <ChartLabel>Sun path</ChartLabel>
        <SunPathChart summerArc={summerArc} equinoxArc={equinoxArc}
          winterArc={winterArc} currentArc={currentArc} sunPos={sunPos} />
      </div>
      <div>
        <ChartLabel>Facade sun hours</ChartLabel>
        <FacadeSunChart facadeHours={facadeHours} />
      </div>
    </div>
  )
}

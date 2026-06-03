export type SunPosition = {
  azimuth: number   // degrees from North, clockwise (0=N, 90=E, 180=S, 270=W)
  elevation: number // degrees above horizon (negative = below)
}

export type FacadeSunHours = { N: number; E: number; S: number; W: number }

const DEG = Math.PI / 180

function declination(dayOfYear: number): number {
  // Spencer formula — error < 0.01°
  return -23.45 * Math.cos(2 * Math.PI * (dayOfYear + 10) / 365) * DEG
}

export function computeSunPosition(latDeg: number, dayOfYear: number, hourOfDay: number): SunPosition {
  const lat  = latDeg * DEG
  const decl = declination(dayOfYear)
  const H    = (hourOfDay - 12) * 15 * DEG // solar hour angle

  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H)
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) / DEG

  const x = -Math.cos(decl) * Math.sin(H)
  const y = Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.cos(H) * Math.sin(lat)
  const azimuth = ((Math.atan2(x, y) / DEG) + 360) % 360

  return { azimuth, elevation }
}

export function getSunriseSunset(latDeg: number, dayOfYear: number): { sunrise: number; sunset: number } {
  const lat  = latDeg * DEG
  const decl = declination(dayOfYear)
  const cosH0 = -Math.tan(lat) * Math.tan(decl)
  if (cosH0 <= -1) return { sunrise: 0, sunset: 24 }   // polar day
  if (cosH0 >= 1)  return { sunrise: 12, sunset: 12 }  // polar night
  const H0 = Math.acos(cosH0) / DEG
  return { sunrise: 12 - H0 / 15, sunset: 12 + H0 / 15 }
}

export function getElevationCurve(latDeg: number, dayOfYear: number): { hour: number; elevation: number }[] {
  const pts: { hour: number; elevation: number }[] = []
  for (let h = 0; h <= 24; h += 0.25) {
    pts.push({ hour: h, elevation: computeSunPosition(latDeg, dayOfYear, h).elevation })
  }
  return pts
}

const MID_MONTH_DAYS = [16, 47, 75, 106, 136, 167, 197, 228, 259, 289, 320, 350]

export function getMonthlyDaylightHours(latDeg: number): number[] {
  return MID_MONTH_DAYS.map(day => {
    const { sunrise, sunset } = getSunriseSunset(latDeg, day)
    return Math.max(0, sunset - sunrise)
  })
}

export function getSunPathArc(latDeg: number, dayOfYear: number): SunPosition[] {
  const pts: SunPosition[] = []
  for (let h = 0; h <= 24; h += 0.25) {
    const pos = computeSunPosition(latDeg, dayOfYear, h)
    if (pos.elevation > 0) pts.push(pos)
  }
  return pts
}

export function getFacadeSunHours(latDeg: number, dayOfYear: number): FacadeSunHours {
  const { sunrise, sunset } = getSunriseSunset(latDeg, dayOfYear)
  const step = 0.25
  const hours: FacadeSunHours = { N: 0, E: 0, S: 0, W: 0 }
  for (let h = sunrise; h < sunset; h += step) {
    const { azimuth, elevation } = computeSunPosition(latDeg, dayOfYear, h)
    if (elevation <= 0) continue
    const az = azimuth * DEG
    const el = elevation * DEG
    // Scene: X=East, Z=South (North=-Z)
    const sunX =  Math.sin(az) * Math.cos(el)
    const sunZ = -Math.cos(az) * Math.cos(el)
    if (sunZ < 0) hours.N += step  // sun in northern sky (az near 0 or 360)
    if (sunX > 0) hours.E += step
    if (sunZ > 0) hours.S += step
    if (sunX < 0) hours.W += step
  }
  return hours
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_SHORT   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function dayOfYearToLabel(doy: number): string {
  let rem = Math.max(1, Math.min(365, doy)) - 1
  let m = 0
  while (m < 11 && rem >= MONTH_LENGTHS[m]) { rem -= MONTH_LENGTHS[m]; m++ }
  return `${MONTH_SHORT[m]} ${rem + 1}`
}

export function dayOfYearToMonth(doy: number): number {
  let rem = Math.max(1, Math.min(365, doy)) - 1
  let m = 0
  while (m < 11 && rem >= MONTH_LENGTHS[m]) { rem -= MONTH_LENGTHS[m]; m++ }
  return m
}

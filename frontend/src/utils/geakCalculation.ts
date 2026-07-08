import type { GwrFeature } from '../api/geoAdmin'
import type { BuildingMeasurements } from './buildingMeasurements'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GEAKUsage = 'EFH' | 'MFH' | 'Büro' | 'Schule' | 'Verkauf'
export type GEAKHeatingSystem =
  | 'Ölkessel' | 'Gaskessel' | 'WP Luft' | 'WP Sole' | 'WP Wasser'
  | 'Pellets' | 'Holz' | 'Fernwärme' | 'Elektro' | 'Keine'
export type GEAKVentilation = 'Keine' | 'Kleinanlage' | 'Mechanisch'

export interface GEAKInputs {
  // Gebäude
  aE: number              // Energiebezugsfläche [m²]
  usage: GEAKUsage
  canton: string
  floors: number
  floorHeight: number     // [m]
  // Gebäudehülle — from 3D model when available
  facadeM2: number | null
  roofM2: number | null
  footprintM2: number | null
  volumeM3: number | null // 3D model volume above terrain
  // U-values [W/(m²·K)]
  uWall: number
  uRoof: number
  uFloor: number
  uWindow: number
  windowFraction: number  // fraction of facade area [0–1]
  gValue: number          // solar energy transmittance
  shadingFs: number       // shading factor
  n50: number             // air tightness [h⁻¹]
  thermalBridges: number  // ΔU [W/(m²·K)] applied to A_E
  // Heizung & WW
  heatingSystem: GEAKHeatingSystem
  cop: number             // COP for heat pumps, η for fossil
  // Lüftung
  ventilation: GEAKVentilation
  heatRecovery: number    // WRG efficiency [0–1]
  // PV
  pvKwp: number
}

export interface GEAKResults {
  // Module 1
  qHEff: number           // Heizwärmebedarf [kWh/(m²·a)]
  qHRef: number           // Reference value [kWh/(m²·a)]
  kwHuelle: number        // KW Gebäudehülle
  classHuelle: string     // A–G
  // Module 2+3
  eH: number              // Heating end energy [kWh/a]
  eWW: number             // Hot water end energy [kWh/a]
  eLueft: number          // Ventilation electricity [kWh/a]
  eEl: number             // Other electricity [kWh/a]
  ePV: number             // PV production [kWh/a]
  // Module 6
  eGew: number            // Weighted energy [kWh/(m²·a)]
  eGewRef: number         // Reference weighted [kWh/(m²·a)]
  kwGesamt: number        // KW Gesamtenergie
  classGesamt: string     // A–G
  co2Direkt: number       // [kg CO₂/(m²·a)]
  classCO2: string        // A–G
  // Intermediate values exposed for Berechnungsmodell display
  calc: {
    hdd: number
    iSolar: number
    facade: number
    roof: number
    floor: number
    aWindow: number
    vBuilding: number
    hT: number
    nEff: number
    hV: number
    qTrans: number
    qVent: number
    qI: number
    qS: number
    gamma: number
    etaG: number
    fCarrier: number
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

// HDD (Heizgradtage, base 12/20°C) by canton — SIA MB 2028 references
const HDD_BY_CANTON: Record<string, number> = {
  AG: 3200, AI: 3400, AR: 3600, BE: 3200, BL: 3000, BS: 2900,
  FR: 3000, GE: 2500, GL: 3800, GR: 4000, JU: 3100, LU: 3200,
  NE: 3100, NW: 3400, OW: 3600, SG: 3300, SH: 3300, SO: 3100,
  SZ: 3300, TG: 3200, TI: 2200, UR: 3600, VD: 3000, VS: 2800,
  ZG: 3100, ZH: 3200,
}

// Annual horizontal solar irradiation [kWh/(m²·a)] — Swiss average
const SOLAR_IRRADIATION: Record<string, number> = {
  TI: 1350, VS: 1300, GE: 1200, VD: 1150, default: 1100,
}

// Weighting factors (SIA MB 2031)
const F_WEIGHT: Record<GEAKHeatingSystem, number> = {
  'Ölkessel':  1.0,
  'Gaskessel': 1.0,
  'WP Luft':   2.0,
  'WP Sole':   2.0,
  'WP Wasser': 2.0,
  'Pellets':   0.5,
  'Holz':      0.5,
  'Fernwärme': 0.6,
  'Elektro':   2.0,
  'Keine':     0.0,
}
const F_EL = 2.0  // weighting factor electricity

// CO₂ emission factors [kg CO₂/kWh end energy]
const EF_CO2: Record<GEAKHeatingSystem, number> = {
  'Ölkessel':  0.265,
  'Gaskessel': 0.198,
  'WP Luft':   0.0,   // electricity — not counted as direct
  'WP Sole':   0.0,
  'WP Wasser': 0.0,
  'Pellets':   0.0,
  'Holz':      0.0,
  'Fernwärme': 0.0,
  'Elektro':   0.0,
  'Keine':     0.0,
}

// Reference Heizwärmebedarf Q_H,Ref [kWh/(m²·a)] by usage
const Q_H_REF: Record<GEAKUsage, number> = {
  EFH:    60,
  MFH:    45,
  Büro:   50,
  Schule: 48,
  Verkauf: 55,
}

// Reference weighted energy demand E_gew,Ref [kWh/(m²·a)] by usage
const E_GEW_REF: Record<GEAKUsage, number> = {
  EFH:    120,
  MFH:    100,
  Büro:   130,
  Schule: 110,
  Verkauf: 150,
}

// Electricity demand [kWh/(m²·a)] by usage (Module 5, standard values)
const E_EL_SPECIFIC: Record<GEAKUsage, number> = {
  EFH:    20,
  MFH:    22,
  Büro:   40,
  Schule: 35,
  Verkauf: 60,
}

// A_E / gross-floor-area benchmark factors by usage (SIA 380/1 practice)
export const AE_FACTOR: Record<GEAKUsage, number> = {
  EFH:     0.80,
  MFH:     0.76,
  Büro:    0.72,
  Schule:  0.68,
  Verkauf: 0.65,
}

// Standard internal heat gains q_I [W/m²] by usage
const Q_INTERNAL: Record<GEAKUsage, number> = {
  EFH:    3.0,
  MFH:    3.5,
  Büro:   6.0,
  Schule: 8.0,
  Verkauf: 10.0,
}

// Heating hours per year [h]
const T_HEAT: Record<GEAKUsage, number> = {
  EFH:    4800,
  MFH:    4800,
  Büro:   3500,
  Schule: 3200,
  Verkauf: 4500,
}

// ─── Classification ───────────────────────────────────────────────────────────

const KW_BOUNDS = [0.25, 0.50, 0.75, 1.00, 1.30, 1.60]
const CO2_BOUNDS = [0, 5, 10, 15, 20, 25]
const CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

function classFromKW(kw: number): string {
  for (let i = 0; i < KW_BOUNDS.length; i++) {
    if (kw <= KW_BOUNDS[i]) return CLASSES[i]
  }
  return 'G'
}

function classFromCO2(co2: number): string {
  if (co2 <= 0) return 'A'
  for (let i = 1; i < CO2_BOUNDS.length; i++) {
    if (co2 <= CO2_BOUNDS[i]) return CLASSES[i]
  }
  return 'G'
}

// ─── Main calculation ─────────────────────────────────────────────────────────

export function calculateGEAK(inp: GEAKInputs): GEAKResults {
  const hdd = HDD_BY_CANTON[inp.canton] ?? 3200
  const iSolar = SOLAR_IRRADIATION[inp.canton] ?? SOLAR_IRRADIATION.default

  // Derived geometry
  const footprint = inp.footprintM2 ?? (inp.aE / inp.floors)
  const facade    = inp.facadeM2   ?? (Math.sqrt(footprint) * 4 * inp.floors * inp.floorHeight)
  const roof      = inp.roofM2     ?? footprint * 1.1
  const aWindow   = facade * inp.windowFraction
  const vBuilding = inp.volumeM3 ?? (footprint * inp.floors * inp.floorHeight)

  // Module 1 — Heizwärmebedarf (SIA 380/1 simplified)
  const hT =
    inp.uWall  * (facade - aWindow) +
    inp.uRoof  * roof +
    inp.uFloor * footprint +
    inp.uWindow * aWindow +
    inp.thermalBridges * inp.aE        // ΔU × A_E

  // Ventilation: effective air change considering heat recovery
  const nEff = inp.ventilation === 'Mechanisch'
    ? 0.5  * (1 - inp.heatRecovery) + 0.1  // full mechanical with WRG + infiltration
    : inp.ventilation === 'Kleinanlage'
    ? 0.35 * (1 - inp.heatRecovery) + 0.1  // single-room units, lower ACH, partial WRG
    : inp.n50 * 0.07                        // natural: n50 × e (SIA 380/1 standard factor)

  const hV = 0.34 * nEff * vBuilding  // [W/K]

  const tH = T_HEAT[inp.usage]
  const qTrans = hT * hdd * 24 / 1000  // [kWh/a]
  const qVent  = hV * hdd * 24 / 1000  // [kWh/a]

  const qI = Q_INTERNAL[inp.usage] * inp.aE * tH / 1000  // [kWh/a]
  const qS = aWindow * iSolar * inp.gValue * inp.shadingFs * 0.9  // [kWh/a] (0.9 = frame factor)

  const qTotal = qTrans + qVent
  const gamma   = qTotal > 0 ? (qI + qS) / qTotal : 0

  // Utilization factor η_g (SIA 380/1, thermal time constant τ ≈ 50h)
  const tau = 50
  const a   = 1 + tau / 15
  let etaG: number
  if (Math.abs(gamma - 1) < 1e-6) {
    etaG = a / (a + 1)
  } else {
    const gA   = Math.pow(gamma, a)
    const gA1  = Math.pow(gamma, a + 1)
    etaG = (1 - gA) / (1 - gA1)
  }

  const qHEff = Math.max(0, (qTotal - etaG * (qI + qS)) / inp.aE)
  const qHRef = Q_H_REF[inp.usage]
  const kwHuelle = qHEff / qHRef

  // Module 2 — Heizung & Warmwasser
  const eH  = (qHEff * inp.aE) / inp.cop           // [kWh/a] end energy for heating
  const isHP = inp.heatingSystem.startsWith('WP')
  const eWWFinal = isHP ? (25 * inp.aE) / inp.cop : (25 * inp.aE) / 0.85

  // Module 3 — Lüftung
  const fanPower: Record<GEAKVentilation, number> = { Keine: 0, Kleinanlage: 0.5, Mechanisch: 1.0 }
  const eLueft = fanPower[inp.ventilation] * inp.aE * 8760 / 1000  // [kWh/a]

  // Module 4 — PV
  const ePV = inp.pvKwp * 900  // [kWh/a]

  // Module 5 — Electricity
  const eEl = E_EL_SPECIFIC[inp.usage] * inp.aE  // [kWh/a]

  // Module 6 — Gesamtenergie & Klassierung
  const fCarrier = F_WEIGHT[inp.heatingSystem]
  const eGewAbs =
    (eH + eWWFinal) * fCarrier +
    eLueft * F_EL +
    eEl * F_EL -
    ePV * F_EL

  const eGew    = Math.max(0, eGewAbs) / inp.aE   // [kWh/(m²·a)]
  const eGewRef = E_GEW_REF[inp.usage]
  const kwGesamt = eGew / eGewRef

  // CO₂ direkt — only fossil end-energy for heating and WW
  const ef = EF_CO2[inp.heatingSystem]
  const co2Direkt = ((eH + eWWFinal) * ef) / inp.aE

  return {
    qHEff: Math.round(qHEff * 10) / 10,
    qHRef,
    kwHuelle: Math.round(kwHuelle * 100) / 100,
    classHuelle: classFromKW(kwHuelle),
    eH: Math.round(eH),
    eWW: Math.round(eWWFinal),
    eLueft: Math.round(eLueft),
    eEl: Math.round(eEl),
    ePV: Math.round(ePV),
    eGew: Math.round(eGew * 10) / 10,
    eGewRef,
    kwGesamt: Math.round(kwGesamt * 100) / 100,
    classGesamt: classFromKW(kwGesamt),
    co2Direkt: Math.round(co2Direkt * 10) / 10,
    classCO2: classFromCO2(co2Direkt),
    calc: {
      hdd,
      iSolar,
      facade: Math.round(facade * 10) / 10,
      roof:   Math.round(roof   * 10) / 10,
      floor:  Math.round(footprint * 10) / 10,
      aWindow: Math.round(aWindow * 10) / 10,
      vBuilding: Math.round(vBuilding),
      hT:      Math.round(hT * 10) / 10,
      nEff:    Math.round(nEff * 1000) / 1000,
      hV:      Math.round(hV * 10) / 10,
      qTrans:  Math.round(qTrans),
      qVent:   Math.round(qVent),
      qI:      Math.round(qI),
      qS:      Math.round(qS),
      gamma:   Math.round(gamma * 1000) / 1000,
      etaG:    Math.round(etaG * 1000) / 1000,
      fCarrier,
    },
  }
}

// ─── U-value defaults by construction year ────────────────────────────────────

interface UDefaults { uWall: number; uRoof: number; uFloor: number; uWindow: number; n50: number; gValue: number }

function uDefaultsByYear(year: number | null): UDefaults {
  if (!year || year < 1921) return { uWall: 1.50, uRoof: 1.00, uFloor: 0.80, uWindow: 3.00, n50: 4.0, gValue: 0.60 }
  if (year < 1946)         return { uWall: 1.30, uRoof: 0.80, uFloor: 0.60, uWindow: 2.80, n50: 3.5, gValue: 0.60 }
  if (year < 1961)         return { uWall: 1.00, uRoof: 0.60, uFloor: 0.50, uWindow: 2.50, n50: 3.0, gValue: 0.60 }
  if (year < 1981)         return { uWall: 0.80, uRoof: 0.40, uFloor: 0.40, uWindow: 2.20, n50: 2.5, gValue: 0.60 }
  if (year < 1991)         return { uWall: 0.50, uRoof: 0.25, uFloor: 0.30, uWindow: 1.80, n50: 2.0, gValue: 0.55 }
  if (year < 2001)         return { uWall: 0.35, uRoof: 0.20, uFloor: 0.25, uWindow: 1.50, n50: 1.5, gValue: 0.50 }
  if (year < 2011)         return { uWall: 0.25, uRoof: 0.15, uFloor: 0.20, uWindow: 1.30, n50: 1.2, gValue: 0.50 }
  if (year < 2021)         return { uWall: 0.20, uRoof: 0.12, uFloor: 0.18, uWindow: 1.10, n50: 1.0, gValue: 0.50 }
  return                         { uWall: 0.15, uRoof: 0.10, uFloor: 0.15, uWindow: 0.90, n50: 0.6, gValue: 0.50 }
}

// ─── Map GWR energy source to heating system ──────────────────────────────────

function gwrToHeatingSystem(source: string): GEAKHeatingSystem {
  const map: Record<string, GEAKHeatingSystem> = {
    'Gas':           'Gaskessel',
    'Biogas':        'Gaskessel',
    'Oil':           'Ölkessel',
    'Wood':          'Holz',
    'Wood Pellets':  'Pellets',
    'Wood Chips':    'Holz',
    'Firewood':      'Holz',
    'Heat Pump':     'WP Luft',
    'Air Source':    'WP Luft',
    'Ground Source': 'WP Sole',
    'Water Source':  'WP Wasser',
    'Solar':         'Elektro',
    'Electricity':   'Elektro',
    'District Heating': 'Fernwärme',
  }
  return map[source] ?? 'Gaskessel'
}

// Default COP / efficiency by system
export function defaultCOP(system: GEAKHeatingSystem): number {
  const cops: Record<GEAKHeatingSystem, number> = {
    'WP Luft':   3.0,
    'WP Sole':   3.8,
    'WP Wasser': 4.2,
    'Gaskessel': 0.90,
    'Ölkessel':  0.85,
    'Pellets':   0.85,
    'Holz':      0.75,
    'Fernwärme': 0.95,
    'Elektro':   1.00,
    'Keine':     1.00,
  }
  return cops[system]
}

// ─── GWR category to GEAK usage ──────────────────────────────────────────────

function gwrToUsage(category: string): GEAKUsage {
  if (category.includes('Residential (1') || category.includes('1–2')) return 'EFH'
  if (category.includes('Residential (3') || category.includes('3+')) return 'MFH'
  if (category.includes('Mixed')) return 'MFH'
  if (category.includes('Commercial')) return 'Büro'
  if (category.includes('Care') || category.includes('Nursing')) return 'Büro'
  if (category.includes('Industrial') || category.includes('Special')) return 'Büro'
  return 'MFH'
}

// ─── Build default inputs from GWR + 3D data ─────────────────────────────────

export function getDefaultInputs(
  gwr: GwrFeature | null,
  measurements: BuildingMeasurements | null,
  allGwr: GwrFeature[] = [],
): GEAKInputs {
  const year = gwr?.constructionYear ?? null
  const uDef = uDefaultsByYear(year)
  const floors = gwr?.floors ?? 3

  const usage   = gwrToUsage(gwr?.category ?? '')
  const heating = gwrToHeatingSystem(gwr?.energySourceHeating ?? '')
  const isResidential = usage === 'EFH' || usage === 'MFH'

  // Aggregate A_E across ALL buildings on the parcel
  const buildings = allGwr.length > 0 ? allGwr : (gwr ? [gwr] : [])
  const aEFromGWR = buildings.reduce((sum, b) => {
    const fp = b.footprintM2
    const fl = b.floors ?? 3
    return fp != null ? sum + fp * fl * AE_FACTOR[gwrToUsage(b.category ?? '')] : sum
  }, 0)
  // When 3D measurements are available they carry aggregated footprint; pair with avg floors
  const avgFloors = buildings.length > 0
    ? buildings.reduce((s, b) => s + (b.floors ?? 3), 0) / buildings.length
    : floors
  const aEFrom3D = measurements?.footprintM2 != null
    ? measurements.footprintM2 * avgFloors * AE_FACTOR[usage]
    : null
  // GWR footprint is the authoritative registry value — prefer it over the 3D-derived estimate,
  // which can be inaccurate when the floor ring detection picks the wrong polygon face.
  const aE = Math.round(aEFromGWR > 0 ? aEFromGWR : (aEFrom3D ?? 300))

  return {
    aE,
    usage,
    canton: gwr?.canton ?? 'ZH',
    floors,
    floorHeight: 2.8,
    facadeM2:    measurements?.facadeM2    ?? null,
    roofM2:      measurements?.roofM2      ?? null,
    footprintM2: measurements?.footprintM2 ?? gwr?.footprintM2 ?? null,
    volumeM3:    measurements?.volumeM3    ?? null,
    uWall:   uDef.uWall,
    uRoof:   uDef.uRoof,
    uFloor:  uDef.uFloor,
    uWindow: uDef.uWindow,
    windowFraction: isResidential ? 0.20 : 0.30,
    gValue:   uDef.gValue,
    shadingFs: 0.50,
    n50:       uDef.n50,
    thermalBridges: 0.05,
    heatingSystem: heating,
    cop: defaultCOP(heating),
    ventilation: 'Keine',
    heatRecovery: 0.75,
    pvKwp: 0,
  }
}

// ─── Exports for UI ───────────────────────────────────────────────────────────

export const GEAK_CLASS_COLORS: Record<string, string> = {
  A: '#00A651', B: '#52B04C', C: '#C0D027',
  D: '#FECB00', E: '#F9A71F', F: '#F7821E', G: '#EE2724',
}

export const HEATING_SYSTEMS: GEAKHeatingSystem[] = [
  'Gaskessel', 'Ölkessel', 'WP Luft', 'WP Sole', 'WP Wasser',
  'Pellets', 'Holz', 'Fernwärme', 'Elektro', 'Keine',
]

export const USAGES: GEAKUsage[] = ['EFH', 'MFH', 'Büro', 'Schule', 'Verkauf']
export const VENTILATION_TYPES: GEAKVentilation[] = ['Keine', 'Kleinanlage', 'Mechanisch']

import type { GEAKHeatingSystem } from './geakCalculation'

// ─── Heuristic cost prefills for future-state energy systems (user-editable) ──

/** Installed cost, CHF per kW thermal. */
export const HEAT_COST_CHF_PER_KW: Partial<Record<GEAKHeatingSystem, number>> = {
  'WP Luft': 3500,
  'WP Sole': 4800,
  'WP Wasser': 5200,
  Pellets: 2600,
  Holz: 2400,
  Gaskessel: 1400,
  'Ölkessel': 1500,
  'Fernwärme': 1800,
  Elektro: 900,
}

/** Suggested thermal power from annual heat demand via full-load hours. */
export function suggestedHeatPowerKW(qHEff: number, aE: number, fullLoadHours = 2100): number {
  const annualKWh = qHEff * aE
  return Math.max(1, Math.round(annualKWh / fullLoadHours))
}

export function heatSystemCost(system: GEAKHeatingSystem, powerKW: number): number {
  const rate = HEAT_COST_CHF_PER_KW[system] ?? 2000
  return Math.round(rate * powerKW)
}

// ─── Photovoltaics ─────────────────────────────────────────────────────────────

export const PV_KWP_PER_M2 = 0.18
export const PV_USABLE_ROOF_FRACTION = 0.6
export const PV_DEFAULT_SPECIFIC_YIELD = 980 // kWh/kWp per year

export function suggestedPvKwp(roofM2: number): number {
  return Math.max(1, Math.round(roofM2 * PV_KWP_PER_M2 * PV_USABLE_ROOF_FRACTION))
}

/** Degressive unit cost: small systems cost more per kWp. */
export function pvCost(kWp: number): number {
  if (kWp <= 0) return 0
  return Math.round(kWp * 2400 * Math.pow(kWp, -0.12))
}

import type { BkpCode, ScenarioCosts } from '../types/project'
import type { ScenarioDeltas } from './scenarioCalc'
import type { GEAKUsage } from './geakCalculation'

// ─── BKP (Baukostenplan SN 506 500) structure ─────────────────────────────────

export const BKP_MAIN_CODES: BkpCode[] = ['0', '1', '2', '3', '4', '5', '8', '9']
export const BKP2_SUB_CODES: BkpCode[] = ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29']

export const BKP_LABELS: Record<BkpCode, string> = {
  '0': 'Grundstück',
  '1': 'Vorbereitungsarbeiten',
  '2': 'Gebäude',
  '3': 'Betriebseinrichtungen',
  '4': 'Umgebung',
  '5': 'Baunebenkosten',
  '8': 'Unvorhergesehenes',
  '9': 'Ausstattung',
  '20': 'Baugrube',
  '21': 'Rohbau 1',
  '22': 'Rohbau 2',
  '23': 'Elektroanlagen',
  '24': 'Heizung, Lüftung, Klima (HLKK)',
  '25': 'Sanitäranlagen',
  '26': 'Transportanlagen',
  '27': 'Ausbau 1',
  '28': 'Ausbau 2',
  '29': 'Honorare',
}

// Heuristic v1 rates, CHF per m³ Gebäudevolumen (SIA 416). User revises via overrides.
export const RATE_CHF_M3: Record<GEAKUsage, number> = {
  EFH: 850,
  MFH: 780,
  'Büro': 900,
  Schule: 950,
  Verkauf: 800,
}

/** Working on an existing structure (Aufstockung/Umbau) costs more per m³ than greenfield. */
export const EXISTING_STRUCTURE_FACTOR = 1.15

/** Distribution of BKP 2 across its subgroups, in % (sums to 100). */
export const BKP2_DISTRIBUTION: Record<string, number> = {
  '20': 3, '21': 28, '22': 12, '23': 7, '24': 11,
  '25': 9, '26': 2, '27': 9, '28': 5, '29': 14,
}

/** Other Hauptgruppen as % of BKP 2. BKP 0 (Grundstück) is manual-only. */
export const MAIN_AS_PCT_OF_BKP2: Record<string, number> = {
  '1': 4, '3': 1, '4': 5, '5': 9, '8': 5, '9': 2,
}

// ─── Estimation ────────────────────────────────────────────────────────────────

export function estimateBkp(deltas: ScenarioDeltas, usage: GEAKUsage): NonNullable<ScenarioCosts['estimate']> {
  const bkp2 = deltas.volumeM3 * RATE_CHF_M3[usage] * EXISTING_STRUCTURE_FACTOR
  const lines: Partial<Record<BkpCode, number>> = { '0': 0 }
  for (const code of BKP2_SUB_CODES) {
    lines[code] = Math.round(bkp2 * (BKP2_DISTRIBUTION[code] ?? 0) / 100)
  }
  for (const [code, pct] of Object.entries(MAIN_AS_PCT_OF_BKP2)) {
    lines[code as BkpCode] = Math.round(bkp2 * pct / 100)
  }
  return {
    generatedAt: new Date().toISOString(),
    usage,
    deltaVolumeM3: Math.round(deltas.volumeM3),
    lines,
    approximate: deltas.approximate,
  }
}

/** Estimate + manual overrides layered on top. Never includes the '2' aggregate. */
export function effectiveLines(costs: ScenarioCosts): Partial<Record<BkpCode, number>> {
  return { ...(costs.estimate?.lines ?? {}), ...costs.overrides }
}

/** Sum of BKP 2 subgroups from the effective lines. */
export function bkp2Total(costs: ScenarioCosts): number {
  const lines = effectiveLines(costs)
  return BKP2_SUB_CODES.reduce((s, c) => s + (lines[c] ?? 0), 0)
}

/** Grand total: all Hauptgruppen, with BKP 2 as the sum of its subgroups. */
export function totalCost(costs: ScenarioCosts): number {
  const lines = effectiveLines(costs)
  const mains = BKP_MAIN_CODES.filter(c => c !== '2')
    .reduce((s, c) => s + (lines[c] ?? 0), 0)
  return mains + bkp2Total(costs)
}

export function formatCHF(v: number): string {
  return `CHF ${Math.round(v).toLocaleString('de-CH')}`
}

import type { SiaPhase, SiaPhaseCode, SiaTimeline } from '../types/project'

// ─── SIA 112 phases ────────────────────────────────────────────────────────────

export const SIA_PHASE_LABELS: Record<SiaPhaseCode, string> = {
  '1': 'Strategische Planung',
  '2': 'Vorstudien',
  '3': 'Projektierung',
  '4': 'Ausschreibung',
  '5': 'Realisierung',
  '6': 'Bewirtschaftung',
}

/** Phases rendered as bars (phase 6 is open-ended). */
export const SIA_BAR_PHASES: SiaPhaseCode[] = ['1', '2', '3', '4', '5']

/**
 * Auto-estimate phase durations (weeks) from total project cost.
 * Realization scales sub-linearly with cost; planning phases as fractions of it.
 * ≈18 wks at 1 MCHF, ≈40 wks at 6 MCHF, ≈75 wks at 25 MCHF.
 */
export function estimateDurations(totalCostCHF: number): SiaPhase[] {
  const c = Math.max(totalCostCHF, 100_000)
  const w5 = Math.min(120, Math.max(12, Math.round(18 * Math.pow(c / 1e6, 0.45))))
  const w1 = Math.max(4, Math.round(0.15 * w5))
  const w2 = Math.max(4, Math.round(0.25 * w5))
  const w3 = Math.max(6, Math.round(0.45 * w5))
  const w4 = Math.max(4, Math.round(0.20 * w5))
  return [
    { code: '1', durationWeeks: w1 },
    { code: '2', durationWeeks: w2 },
    { code: '3', durationWeeks: w3 },
    { code: '4', durationWeeks: w4 },
    { code: '5', durationWeeks: w5 },
  ]
}

export function defaultTimeline(totalCostCHF: number): SiaTimeline {
  return {
    startDate: new Date().toISOString().slice(0, 10),
    phases: estimateDurations(totalCostCHF),
    autoEstimated: true,
  }
}

export type PhaseSpan = { code: SiaPhaseCode; start: Date; end: Date }

/** Sequential spans from startDate; only bar phases (1–5). */
export function phaseSpans(timeline: SiaTimeline): PhaseSpan[] {
  const spans: PhaseSpan[] = []
  let cursor = new Date(timeline.startDate + 'T00:00:00')
  if (isNaN(cursor.getTime())) cursor = new Date()
  for (const code of SIA_BAR_PHASES) {
    const phase = timeline.phases.find(p => p.code === code)
    if (!phase) continue
    const start = new Date(cursor)
    const end = new Date(cursor.getTime() + phase.durationWeeks * 7 * 86_400_000)
    spans.push({ code, start, end })
    cursor = end
  }
  return spans
}

export function totalWeeks(timeline: SiaTimeline): number {
  return timeline.phases
    .filter(p => SIA_BAR_PHASES.includes(p.code))
    .reduce((s, p) => s + p.durationWeeks, 0)
}

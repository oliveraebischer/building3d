import type { Project } from '../types/project'

/**
 * Read-time normalization for project records: maps the legacy `phase` field
 * to `status` and default-fills fields introduced after v1.
 */
export function normalizeProject(raw: any): Project {
  const scenarios = Array.isArray(raw.scenarios) ? raw.scenarios : []
  return {
    ...raw,
    status: raw.status ?? raw.phase ?? 'idea',
    milestones: Array.isArray(raw.milestones) ? raw.milestones : [],
    members: Array.isArray(raw.members) ? raw.members : [],
    scenarios,
    activeScenarioId: raw.activeScenarioId ?? scenarios[0]?.id ?? null,
  }
}

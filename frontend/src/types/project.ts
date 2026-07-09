import type { ParcelFeature, GwrFeature } from '../api/geoAdmin'
import type { GEAKUsage, GEAKInputs, GEAKHeatingSystem } from '../utils/geakCalculation'

export type ProjectType = 'renovation' | 'development' | 'refurbishment'

/** Project status — independent of the SIA phase timeline. */
export type ProjectStatus = 'idea' | 'study' | 'planning' | 'execution' | 'done'

export type Milestone = {
  id: string
  title: string
  due?: string
  done: boolean
}

export type ProjectMember = {
  parcel: ParcelFeature
  buildings: GwrFeature[]
  /** null = all buildings on the parcel are part of the project */
  includedEgids: string[] | null
  sourcePortfolioEgrid: string
}

export type ScenarioParams = {
  extraFloors: number
  roofType: 'unchanged' | 'flat' | 'gable'
  useChange: GEAKUsage | null
  /** null = all included buildings across members */
  targetEgids: string[] | null
}

/** BKP (Baukostenplan SN 506 500): Hauptgruppen plus 2-stellige Untergruppen von BKP 2. */
export type BkpCode =
  | '0' | '1' | '2' | '3' | '4' | '5' | '8' | '9'
  | '20' | '21' | '22' | '23' | '24' | '25' | '26' | '27' | '28' | '29'

export type CostChange = {
  ts: string
  code: BkpCode
  old: number
  new: number
  note?: string
}

export type ScenarioCosts = {
  /** Auto-computed estimate snapshot (stable without 3D data loaded). */
  estimate: {
    generatedAt: string
    usage: GEAKUsage
    deltaVolumeM3: number
    lines: Partial<Record<BkpCode, number>>
    approximate: boolean
  } | null
  /** Manual revisions layered on top of the estimate. */
  overrides: Partial<Record<BkpCode, number>>
  changeLog: CostChange[]
}

export type Scenario = {
  id: string
  name: string
  params: ScenarioParams
  createdAt: string
  costs?: ScenarioCosts
}

/** SIA 112 phases: 1 Strategische Planung … 5 Realisierung, 6 Bewirtschaftung. */
export type SiaPhaseCode = '1' | '2' | '3' | '4' | '5' | '6'

export type SiaPhase = {
  code: SiaPhaseCode
  durationWeeks: number
}

export type SiaTimeline = {
  /** ISO date, start of phase 1 */
  startDate: string
  phases: SiaPhase[]
  autoEstimated: boolean
}

export type EnergyPlan = {
  /** Future-state GEAK parameter overrides on top of the defaults. */
  geakOverrides: Partial<GEAKInputs>
  heatGeneration: {
    system: GEAKHeatingSystem
    powerKW: number | null
    costCHF: number | null
  } | null
  pv: {
    kWp: number
    /** kWh/kWp per year */
    specificYield: number
    costCHF: number | null
  } | null
  /** Whether the current heat/PV costs were pushed into the active scenario's BKP. */
  pushedToBkp: boolean
}

export type Project = {
  id: string
  name: string
  projectType: ProjectType
  status: ProjectStatus
  milestones: Milestone[]
  notes?: string
  members: ProjectMember[]
  scenarios: Scenario[]
  activeScenarioId: string | null
  siaTimeline?: SiaTimeline
  energyPlan?: EnergyPlan
  createdAt: string
  updatedAt: string
}

/** Buildings of a member that are part of the project (respects includedEgids). */
export function memberIncludedBuildings(m: ProjectMember): GwrFeature[] {
  if (m.includedEgids === null) return m.buildings
  return m.buildings.filter(b => m.includedEgids!.includes(b.egid))
}

export function emptyCosts(): ScenarioCosts {
  return { estimate: null, overrides: {}, changeLog: [] }
}

export function emptyEnergyPlan(): EnergyPlan {
  return { geakOverrides: {}, heatGeneration: null, pv: null, pushedToBkp: false }
}

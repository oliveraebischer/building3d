import type { ParcelFeature, GwrFeature } from '../api/geoAdmin'
import type { GEAKUsage } from '../utils/geakCalculation'

export type ProjectType = 'renovation' | 'development' | 'refurbishment'

export type ProjectPhase = 'idea' | 'study' | 'planning' | 'execution' | 'done'

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

export type Scenario = {
  id: string
  name: string
  params: ScenarioParams
  createdAt: string
}

export type Project = {
  id: string
  name: string
  projectType: ProjectType
  phase: ProjectPhase
  milestones: Milestone[]
  notes?: string
  members: ProjectMember[]
  scenarios: Scenario[]
  createdAt: string
  updatedAt: string
}

/** Buildings of a member that are part of the project (respects includedEgids). */
export function memberIncludedBuildings(m: ProjectMember): GwrFeature[] {
  if (m.includedEgids === null) return m.buildings
  return m.buildings.filter(b => m.includedEgids!.includes(b.egid))
}

import type { GwrFeature } from '../api/geoAdmin'
import type { BuildingMeasurements } from './buildingMeasurements'
import type { ScenarioParams } from '../types/project'
import {
  AE_FACTOR, calculateGEAK, getDefaultInputs,
  type GEAKResults,
} from './geakCalculation'

const FLOOR_H = 2.8 // matches getDefaultInputs floorHeight

export type ScenarioDeltas = {
  volumeM3: number
  aE: number
  facadeM2: number
  roofM2: number
  geakBefore: GEAKResults
  geakAfter: GEAKResults
  perBuilding: Record<string, { volumeM3: number; aE: number }>
  /** true when at least one targeted building fell back to GWR registry values */
  approximate: boolean
}

function aggregate(
  buildings: GwrFeature[],
  measurements: Record<number, BuildingMeasurements> | null,
): BuildingMeasurements | null {
  let any = false
  const agg: BuildingMeasurements = { volumeM3: 0, facadeM2: 0, roofM2: 0, circumferenceM: 0, footprintM2: 0 }
  for (const b of buildings) {
    const m = measurements?.[Number(b.egid)]
    if (!m) continue
    any = true
    agg.volumeM3 += m.volumeM3
    agg.facadeM2 += m.facadeM2
    agg.roofM2 += m.roofM2
    agg.circumferenceM += m.circumferenceM
    agg.footprintM2 += m.footprintM2
  }
  return any ? agg : null
}

export function computeScenarioDeltas(
  params: ScenarioParams,
  buildings: GwrFeature[],
  measurements: Record<number, BuildingMeasurements> | null,
): ScenarioDeltas | null {
  if (buildings.length === 0) return null

  const targets = params.targetEgids === null
    ? buildings
    : buildings.filter(b => params.targetEgids!.includes(b.egid))
  if (targets.length === 0) return null

  const primary = buildings[0]
  const beforeInputs = getDefaultInputs(primary, aggregate(buildings, measurements), buildings)
  const usage = params.useChange ?? beforeInputs.usage

  let dVolume = 0
  let dFacade = 0
  let dAE = 0
  let approximate = false
  const perBuilding: Record<string, { volumeM3: number; aE: number }> = {}

  for (const b of targets) {
    const m = measurements?.[Number(b.egid)]
    const footprint = m?.footprintM2 ?? b.footprintM2 ?? 0
    if (!m) approximate = true
    if (footprint <= 0) continue
    const perimeter = m?.circumferenceM ?? 4 * Math.sqrt(footprint)
    const bVolume = footprint * params.extraFloors * FLOOR_H
    const bAE = footprint * params.extraFloors * AE_FACTOR[usage]
    dVolume += bVolume
    dFacade += perimeter * params.extraFloors * FLOOR_H
    dAE += bAE
    perBuilding[b.egid] = { volumeM3: bVolume, aE: bAE }
  }

  // Roof change: flat → gable adds ~15% roof surface (pitch factor), v1 approximation
  const roofBase = beforeInputs.roofM2 ?? beforeInputs.footprintM2 ?? 0
  const dRoof = params.roofType === 'gable' ? roofBase * 0.15 : 0
  if (params.roofType !== 'unchanged' && beforeInputs.roofM2 == null) approximate = true

  const geakBefore = calculateGEAK(beforeInputs)
  const geakAfter = calculateGEAK({
    ...beforeInputs,
    usage,
    aE: Math.max(1, beforeInputs.aE + dAE),
    floors: beforeInputs.floors + params.extraFloors,
    volumeM3: beforeInputs.volumeM3 != null ? beforeInputs.volumeM3 + dVolume : null,
    facadeM2: beforeInputs.facadeM2 != null ? beforeInputs.facadeM2 + dFacade : null,
    roofM2: beforeInputs.roofM2 != null ? beforeInputs.roofM2 + dRoof : null,
  })

  const fmt = (v: number) => Math.round(v * 10) / 10
  return {
    volumeM3: fmt(dVolume),
    aE: fmt(dAE),
    facadeM2: fmt(dFacade),
    roofM2: fmt(dRoof),
    geakBefore,
    geakAfter,
    perBuilding,
    approximate,
  }
}

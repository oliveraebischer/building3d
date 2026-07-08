import type * as THREE from 'three'
import type { BuildingFeature } from '../api/buildings'

export type BuildingMeasurements = {
  volumeM3: number
  facadeM2: number
  roofM2: number
  circumferenceM: number
  footprintM2: number
}

type Vec3 = [number, number, number]

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function lenVec(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function triArea3D(v0: Vec3, v1: Vec3, v2: Vec3): number {
  return lenVec(cross(sub(v1, v0), sub(v2, v0))) / 2
}

// Safe interpolation parameter along an edge from point with height `a` to point with height `b`.
// Returns t ∈ [0,1] where the edge crosses terrain (height = 0).
function edgeT(a: number, b: number): number {
  const denom = a - b
  return Math.abs(denom) < 1e-10 ? 0 : a / denom
}

// Clip a single triangle against the terrain surface, returning 0–2 above-terrain triangles.
// a_i = vertex_i.y − terrainHeight(vertex_i.x, vertex_i.z)  (positive = above terrain)
function clipTriangle(v0: Vec3, v1: Vec3, v2: Vec3, a0: number, a1: number, a2: number): Vec3[][] {
  const above0 = a0 >= 0, above1 = a1 >= 0, above2 = a2 >= 0
  const count = (above0 ? 1 : 0) + (above1 ? 1 : 0) + (above2 ? 1 : 0)

  if (count === 3) return [[v0, v1, v2]]
  if (count === 0) return []

  const verts: Vec3[] = [v0, v1, v2]
  const as = [a0, a1, a2]
  const above = [above0, above1, above2]

  if (count === 1) {
    // One vertex above — find it, clip the two edges going to below vertices
    const idx = above.findIndex(Boolean)
    const r0 = verts[idx], ra0 = as[idx]
    const r1 = verts[(idx + 1) % 3], ra1 = as[(idx + 1) % 3]
    const r2 = verts[(idx + 2) % 3], ra2 = as[(idx + 2) % 3]
    const p01 = lerp3(r0, r1, edgeT(ra0, ra1))
    const p02 = lerp3(r0, r2, edgeT(ra0, ra2))
    return [[r0, p01, p02]]
  }

  // Two vertices above — find the below vertex, clip edges going to it
  const belowIdx = above.findIndex(v => !v)
  const r0 = verts[(belowIdx + 1) % 3], ra0 = as[(belowIdx + 1) % 3]
  const r1 = verts[(belowIdx + 2) % 3], ra1 = as[(belowIdx + 2) % 3]
  const rb = verts[belowIdx], rab = as[belowIdx]
  const p0b = lerp3(r0, rb, edgeT(ra0, rab))
  const p1b = lerp3(r1, rb, edgeT(ra1, rab))
  return [
    [r0, r1, p0b],
    [r1, p1b, p0b],
  ]
}

// Identify the floor polygon: the exterior ring (index 0) of the polygon with the lowest avg Z.
// Only exterior rings are considered — interior rings (holes) are GeoJSON index 1+ and must be skipped,
// otherwise a small interior hole at a slightly lower elevation can be selected instead of the full footprint.
export function findFloorRing(feature: BuildingFeature): [number, number, number][] | null {
  let floorRing: [number, number, number][] | null = null
  let minAvgZ = Infinity
  for (const poly of feature.geometry.coordinates) {
    const ring = poly[0]  // exterior ring only
    if (!ring || ring.length < 3) continue
    const avgZ = ring.reduce((s, v) => s + v[2], 0) / ring.length
    if (avgZ < minAvgZ) { minAvgZ = avgZ; floorRing = ring }
  }
  return floorRing
}

export function computeMeasurements(
  mesh: THREE.Mesh,
  feature: BuildingFeature,
  terrainHeightAt: (x: number, z: number) => number,
  toLocal: (lng: number, lat: number, z: number) => [number, number, number],
): BuildingMeasurements {
  const pos = mesh.geometry.attributes.position.array as Float32Array

  let volumeM3 = 0
  let facadeM2 = 0
  let roofM2 = 0

  for (let i = 0; i < pos.length; i += 9) {
    const v0: Vec3 = [pos[i],     pos[i + 1], pos[i + 2]]
    const v1: Vec3 = [pos[i + 3], pos[i + 4], pos[i + 5]]
    const v2: Vec3 = [pos[i + 6], pos[i + 7], pos[i + 8]]

    const n = cross(sub(v1, v0), sub(v2, v0))
    const nLen = lenVec(n)
    if (nLen < 1e-10) continue
    const ny = n[1] / nLen

    // Volume: sign-independent — works regardless of GDB winding convention.
    // Walls have |ny| ≈ 0 so A_xz ≈ 0; floor faces have a_i ≈ 0 at terrain level.
    // Only roof faces (horizontal, above terrain) contribute meaningfully.
    const A_xz = Math.abs(n[1]) / 2
    if (A_xz > 1e-6) {
      const t0 = terrainHeightAt(v0[0], v0[2])
      const t1 = terrainHeightAt(v1[0], v1[2])
      const t2 = terrainHeightAt(v2[0], v2[2])
      const a0 = Math.max(0, v0[1] - t0)
      const a1 = Math.max(0, v1[1] - t1)
      const a2 = Math.max(0, v2[1] - t2)
      volumeM3 += A_xz * (a0 + a1 + a2) / 3

      // Roof: horizontal face (|ny| > 0.5) AND above terrain
      if (Math.abs(ny) > 0.5 && (a0 + a1 + a2) > 0) {
        roofM2 += nLen / 2
      }
    }

    if (Math.abs(ny) < 0.5) {
      // Vertical-ish face — facade above terrain (clip at terrain surface)
      const a0 = v0[1] - terrainHeightAt(v0[0], v0[2])
      const a1 = v1[1] - terrainHeightAt(v1[0], v1[2])
      const a2 = v2[1] - terrainHeightAt(v2[0], v2[2])
      for (const tri of clipTriangle(v0, v1, v2, a0, a1, a2)) {
        facadeM2 += triArea3D(tri[0], tri[1], tri[2])
      }
    }
  }

  const floorRing = findFloorRing(feature)

  let circumferenceM = 0
  let footprintM2 = 0

  if (floorRing && floorRing.length >= 3) {
    // GeoJSON rings are closed (first == last), use length-1 unique points
    const nPts = floorRing.length - 1
    const pts = floorRing.slice(0, nPts).map(([lng, lat, z]) => toLocal(lng, lat, z))

    // Shoelace formula in the XZ plane (x = east, z = north)
    let area = 0
    for (let j = 0; j < nPts; j++) {
      const k = (j + 1) % nPts
      area += pts[j][0] * pts[k][2] - pts[k][0] * pts[j][2]
    }
    footprintM2 = Math.abs(area) / 2

    // Perimeter in XZ plane
    for (let j = 0; j < nPts; j++) {
      const k = (j + 1) % nPts
      const dx = pts[k][0] - pts[j][0]
      const dz = pts[k][2] - pts[j][2]
      circumferenceM += Math.sqrt(dx * dx + dz * dz)
    }
  }

  const fmt = (v: number) => Math.round(v * 10) / 10
  return {
    volumeM3: fmt(volumeM3),
    facadeM2: fmt(facadeM2),
    roofM2: fmt(roofM2),
    circumferenceM: fmt(circumferenceM),
    footprintM2: fmt(footprintM2),
  }
}

import * as THREE from 'three'
import type { ScenarioParams } from '../types/project'

export const FLOOR_H = 2.8
const SLAB_H = 0.15
const ROOF_PITCH_RAD = 25 * Math.PI / 180

export type MassingMaterials = {
  floor: THREE.Material
  slab: THREE.Material
  roof: THREE.Material
}

export function makeMassingMaterials(): MassingMaterials {
  return {
    floor: new THREE.MeshPhongMaterial({
      color: 0x34D399, transparent: true, opacity: 0.30,
      depthWrite: false, side: THREE.DoubleSide, flatShading: true,
    }),
    slab: new THREE.MeshPhongMaterial({
      color: 0x34D399, transparent: true, opacity: 0.55,
      depthWrite: false, side: THREE.DoubleSide, flatShading: true,
    }),
    roof: new THREE.MeshPhongMaterial({
      color: 0x34D399, transparent: true, opacity: 0.30,
      depthWrite: false, side: THREE.DoubleSide, flatShading: true,
    }),
  }
}

/**
 * Eaves height of an existing building: for each footprint-ring vertex, the max
 * mesh Y among vertices within 0.5 m horizontal distance (= wall tops), then
 * the median over ring vertices. Puts new floors at the eaves line rather than
 * on the ridge of a pitched roof. Falls back to the mesh bounding-box top.
 */
export function computeEavesY(
  positions: ArrayLike<number>,
  footprintLocal: [number, number][], // local [x, z] pairs
  bboxMaxY: number,
): number {
  const tops: number[] = []
  for (const [fx, fz] of footprintLocal) {
    let top = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i] - fx
      const dz = positions[i + 2] - fz
      if (dx * dx + dz * dz <= 0.25 && positions[i + 1] > top) top = positions[i + 1]
    }
    if (top > -Infinity) tops.push(top)
  }
  if (tops.length === 0) return bboxMaxY
  tops.sort((a, b) => a - b)
  return tops[Math.floor(tops.length / 2)]
}

// ─── Oriented bounding rectangle (rotating calipers on the convex hull) ───────

function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop()
    lower.push(pt)
  }
  const upper: [number, number][] = []
  for (const pt of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop()
    upper.push(pt)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

type OBB = {
  center: [number, number]
  axis: [number, number]      // unit vector along the long side
  halfLength: number          // along axis
  halfWidth: number           // perpendicular
}

export function orientedBoundingBox(pts: [number, number][]): OBB | null {
  const hull = convexHull(pts)
  if (hull.length < 3) return null
  let best: OBB | null = null
  let bestArea = Infinity
  for (let i = 0; i < hull.length; i++) {
    const [x0, y0] = hull[i]
    const [x1, y1] = hull[(i + 1) % hull.length]
    const len = Math.hypot(x1 - x0, y1 - y0)
    if (len < 1e-9) continue
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len   // edge direction
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const [px, py] of hull) {
      const u = px * ux + py * uy
      const v = -px * uy + py * ux
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const du = maxU - minU, dv = maxV - minV
    const area = du * dv
    if (area < bestArea) {
      bestArea = area
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2
      const center: [number, number] = [cu * ux - cv * uy, cu * uy + cv * ux]
      // Long side defines the ridge direction
      best = du >= dv
        ? { center, axis: [ux, uy], halfLength: du / 2, halfWidth: dv / 2 }
        : { center, axis: [-uy, ux], halfLength: dv / 2, halfWidth: du / 2 }
    }
  }
  return best
}

/**
 * Simplified gable roof over the footprint's oriented bounding rectangle:
 * ridge along the long axis at halfWidth·tan(25°) above the eaves, two roof
 * quads plus two gable triangles. Visually approximate for L-shaped rings.
 */
function buildGableRoofGeometry(footprint: [number, number][], roofBaseY: number): THREE.BufferGeometry | null {
  const obb = orientedBoundingBox(footprint)
  if (!obb) return null
  const { center, axis, halfLength, halfWidth } = obb
  const [ax, az] = axis
  const px = -az, pz = ax // perpendicular
  const ridgeH = halfWidth * Math.tan(ROOF_PITCH_RAD)

  const corner = (s: number, t: number): [number, number, number] => [
    center[0] + s * ax * halfLength + t * px * halfWidth,
    roofBaseY,
    center[1] + s * az * halfLength + t * pz * halfWidth,
  ]
  const ridge = (s: number): [number, number, number] => [
    center[0] + s * ax * halfLength,
    roofBaseY + ridgeH,
    center[1] + s * az * halfLength,
  ]

  const c00 = corner(-1, -1), c01 = corner(-1, 1)
  const c10 = corner(1, -1), c11 = corner(1, 1)
  const r0 = ridge(-1), r1 = ridge(1)

  const positions: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c)
  // Roof plane t=-1 side (quad c00→c10→r1→r0)
  tri(c00, c10, r1); tri(c00, r1, r0)
  // Roof plane t=+1 side (quad c01→c11→r1→r0)
  tri(c01, r1, c11); tri(c01, r0, r1)
  // Gable triangles at both ends
  tri(c00, r0, c01)
  tri(c10, c11, r1)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geo.computeVertexNormals()
  return geo
}

/**
 * Massing for one building: per-floor prisms with visible slab lines, plus an
 * optional simplified gable roof. `footprintLocal` are local-space [x, z] pairs
 * of the floor ring (open, no closing vertex); `baseY` is the eaves height.
 */
export function buildMassingMeshes(
  footprintLocal: [number, number][],
  baseY: number,
  params: ScenarioParams,
  materials: MassingMaterials,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  if (footprintLocal.length < 3) return meshes

  // Shape lies in XY, extruded along +Z; rotating -90° about X maps (sx, sy, d)
  // → (sx, d, -sy), so shape y must be the negated world z.
  const shape = new THREE.Shape(footprintLocal.map(([x, z]) => new THREE.Vector2(x, -z)))

  const addExtrusion = (depth: number, y: number, mat: THREE.Material) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = y
    meshes.push(mesh)
  }

  for (let i = 0; i < params.extraFloors; i++) {
    const floorBase = baseY + i * FLOOR_H
    addExtrusion(SLAB_H, floorBase, materials.slab)                    // slab line
    addExtrusion(FLOOR_H - SLAB_H, floorBase + SLAB_H, materials.floor) // floor volume
  }
  const roofBaseY = baseY + params.extraFloors * FLOOR_H
  if (params.extraFloors > 0) {
    addExtrusion(SLAB_H, roofBaseY, materials.slab) // top slab
  }

  if (params.roofType === 'gable') {
    const geo = buildGableRoofGeometry(footprintLocal, roofBaseY + (params.extraFloors > 0 ? SLAB_H : 0))
    if (geo) meshes.push(new THREE.Mesh(geo, materials.roof))
  }

  return meshes
}

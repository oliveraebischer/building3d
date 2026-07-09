import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useMapStore } from '../store/mapStore'
import { fetchBuildings, type BuildingFeature, type BuildingFeatureCollection } from '../api/buildings'
import { fetchTerrain, type TerrainGrid } from '../api/terrain'
import { computeMeasurements, findFloorRing } from '../utils/buildingMeasurements'
import type { Project } from '../types/project'
import { memberIncludedBuildings } from '../types/project'
import { computeSunPosition } from '../utils/solarPosition'
import { loadImage, computeMapUrlsFromBbox } from '../utils/mapTexture'
import { pointInRing } from '../utils/tileUtils'
import { buildMassingMeshes, makeMassingMaterials, computeEavesY } from '../utils/massingGeometry'

// Centroid of floor-level vertices (min Z ±2 m) — same approach as BuildingViewer3D.
function floorCentroid(coords: [number, number, number][][][]): [number, number] | null {
  const all = coords.flat(2) as [number, number, number][]
  if (!all.length) return null
  const minZ = Math.min(...all.map(c => c[2]))
  const floor = all.filter(c => c[2] <= minZ + 2)
  const pts = floor.length ? floor : all
  return [
    pts.reduce((s, c) => s + c[0], 0) / pts.length,
    pts.reduce((s, c) => s + c[1], 0) / pts.length,
  ]
}

// swisstopo approximation formulas — accuracy < 1 m across Switzerland
function lv95ToWgs84(E: number, N: number): [number, number] {
  const e = (E - 2600000) / 1000000
  const n = (N - 1200000) / 1000000
  const lon = 2.6779094 + 4.728982*e + 0.791484*e*n + 0.1306*e*n*n - 0.0436*e*e*e
  const lat = 16.9023892 + 3.238272*n - 0.270978*e*e - 0.002528*n*n - 0.0447*e*e*n - 0.0140*n*n*n
  return [lon * 100/36, lat * 100/36]
}

function fillNullElevations(raw: (number | null)[][], minElev: number): number[][] {
  const rows = raw.length, cols = raw[0]?.length ?? 0
  const grid: (number | null)[][] = raw.map(r => [...r])
  const allValid = grid.flat().filter((v): v is number => v !== null)
  if (allValid.length === 0) return grid.map(r => r.map(() => minElev)) as number[][]
  const sorted = [...allValid].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  for (let pass = 0; pass < 4; pass++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null) continue
        const nbrs: number[] = []
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const v = grid[r + dr]?.[c + dc]
          if (v !== null && v !== undefined) nbrs.push(v)
        }
        if (nbrs.length > 0) grid[r][c] = nbrs.reduce((a, b) => a + b, 0) / nbrs.length
      }
    }
  }
  return grid.map(r => r.map(v => v ?? median)) as number[][]
}

type ViewerState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'ready'; data: BuildingFeatureCollection; terrain: TerrainGrid | null }

export default function ProjectViewer3D({ project }: { project: Project }) {
  const {
    sunDayOfYear, sunHourOfDay,
    setBuildingMeasurements,
    projectScenarioPreviewId,
  } = useMapStore()
  const [state, setState] = useState<ViewerState>({ status: 'loading' })
  const [showMapLayer, setShowMapLayer] = useState(true)
  const showMapLayerRef = useRef(true)
  showMapLayerRef.current = showMapLayer
  const canvasRef = useRef<HTMLDivElement>(null)
  const compassRef = useRef<HTMLDivElement>(null)

  const dirLightRef = useRef<THREE.DirectionalLight | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const massingGroupRef = useRef<THREE.Group | null>(null)
  const meshByEgidRef = useRef<Map<number, { mesh: THREE.Mesh; feat: BuildingFeature }>>(new Map())
  const sceneCenterRef = useRef<{ lon: number; lat: number } | null>(null)
  const toLocalRef = useRef<((lng: number, lat: number, z: number) => [number, number, number]) | null>(null)
  const terrainMatRef = useRef<THREE.MeshLambertMaterial | null>(null)
  const compositeTexRef = useRef<THREE.CanvasTexture | null>(null)

  // Members fingerprint so the load effect reruns when parcels/buildings change
  const memberKey = useMemo(
    () => project.members
      .map(m => `${m.parcel.egrid}:${(m.includedEgids ?? ['*']).join('.')}`)
      .join('|'),
    [project.members],
  )

  const memberRings = useMemo(
    () => project.members.map(m => (m.parcel.geometry.coordinates as [number, number][][])[0]),
    [project.members],
  )

  // ── Load geometry + terrain for the whole project ──────────────────────────
  useEffect(() => {
    const buildings = project.members.flatMap(memberIncludedBuildings)
    const egids = buildings.map(b => b.egid).filter(e => e !== '—')
    if (egids.length === 0) { setState({ status: 'empty' }); return }

    const coords = memberRings.flat()
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const bbox: [number, number, number, number] = [minLng, minLat, maxLng, maxLat]
    const pad = 1.5
    const terrainBbox: [number, number, number, number] = [
      minLng - (maxLng - minLng) * pad, minLat - (maxLat - minLat) * pad,
      maxLng + (maxLng - minLng) * pad, maxLat + (maxLat - minLat) * pad,
    ]

    let cancelled = false
    setState({ status: 'loading' })
    Promise.all([
      fetchBuildings(egids, bbox),
      fetchTerrain(terrainBbox, 32).catch(() => null),
    ]).then(([data, terrain]) => {
      if (cancelled) return
      // Null-EGID features must sit on one of the member parcels
      const features = data.features.filter(feat => {
        if (feat.properties.egid != null) return true
        const c = floorCentroid(feat.geometry.coordinates)
        return c ? memberRings.some(ring => pointInRing(c[0], c[1], ring)) : false
      })
      setState(features.length > 0
        ? { status: 'ready', data: { ...data, features }, terrain }
        : { status: 'empty' })
    }).catch(() => { if (!cancelled) setState({ status: 'error' }) })

    return () => { cancelled = true }
  }, [project.id, memberKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Three.js scene ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status !== 'ready' || !canvasRef.current) return
    const container = canvasRef.current
    const { width, height } = container.getBoundingClientRect()

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x080808)

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    rendererRef.current = renderer
    container.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dir = new THREE.DirectionalLight(0xffffff, 1.0)
    dir.castShadow = true
    dir.shadow.mapSize.set(2048, 2048)
    dir.shadow.camera.near = 0.5
    dir.shadow.camera.far = 2000
    dir.shadow.camera.left = -400
    dir.shadow.camera.right = 400
    dir.shadow.camera.top = 400
    dir.shadow.camera.bottom = -400
    dir.shadow.camera.updateProjectionMatrix()
    dir.shadow.bias = -0.001
    dir.position.set(1, 2, 1)
    scene.add(dir)
    dirLightRef.current = dir

    // Scene origin: terrain center (shared coordinate system) or building centroid
    const allLngs: number[] = [], allLats: number[] = [], allZs: number[] = []
    for (const feat of state.data.features) {
      for (const poly of feat.geometry.coordinates)
        for (const ring of poly)
          for (const [lng, lat, z] of ring) {
            allLngs.push(lng); allLats.push(lat); allZs.push(z)
          }
    }
    const buildingMinZ = Math.min(...allZs)
    const minZ = state.terrain
      ? Math.min(buildingMinZ, state.terrain.min_elevation)
      : buildingMinZ
    const terrainCenterLv95 = state.terrain
      ? [(state.terrain.bbox_lv95[0] + state.terrain.bbox_lv95[2]) / 2,
         (state.terrain.bbox_lv95[1] + state.terrain.bbox_lv95[3]) / 2] as [number, number]
      : null
    const cx = (Math.min(...allLngs) + Math.max(...allLngs)) / 2
    const cy = (Math.min(...allLats) + Math.max(...allLats)) / 2
    const [originLon, originLat] = terrainCenterLv95
      ? lv95ToWgs84(...terrainCenterLv95)
      : [cx, cy]
    sceneCenterRef.current = { lon: originLon, lat: originLat }
    const cosLat = Math.cos(originLat * Math.PI / 180)
    const toLocal = (lng: number, lat: number, z: number): [number, number, number] => [
      (lng - originLon) * cosLat * 111320,
      z - minZ,
      -(lat - originLat) * 111320,
    ]
    toLocalRef.current = toLocal

    // Building meshes
    meshByEgidRef.current.clear()
    const material = new THREE.MeshPhongMaterial({
      color: 0x2a6099,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    const group = new THREE.Group()
    const allFeatureMeshes: { feat: BuildingFeature; mesh: THREE.Mesh; key: number }[] = []
    let syntheticKey = -1
    for (const feat of state.data.features) {
      const positions: number[] = []
      for (const poly of feat.geometry.coordinates) {
        const ring = poly[0]
        for (let i = 1; i < ring.length - 2; i++) {
          positions.push(
            ...toLocal(...ring[0]),
            ...toLocal(...ring[i]),
            ...toLocal(...ring[i + 1]),
          )
        }
      }
      if (positions.length === 0) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      const key = feat.properties.egid ?? syntheticKey--
      meshByEgidRef.current.set(key, { mesh, feat })
      allFeatureMeshes.push({ feat, mesh, key })
      group.add(mesh)
    }
    scene.add(group)

    // Massing group (populated by a separate effect)
    const massingGroup = new THREE.Group()
    scene.add(massingGroup)
    massingGroupRef.current = massingGroup

    // Terrain (elevation mesh, or flat plane fallback)
    let terrainMesh: THREE.Mesh | null = null
    const terrainMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, side: THREE.FrontSide })
    terrainMatRef.current = terrainMat
    let filledElevations: number[][] = []
    let textureBbox: [number, number, number, number] | null = null

    // Same padded bbox as the fetch — used for both flat plane sizing and texture
    const memberCoords = memberRings.flat()
    const mLngs = memberCoords.map(c => c[0]), mLats = memberCoords.map(c => c[1])
    const bMinLng = Math.min(...mLngs), bMaxLng = Math.max(...mLngs)
    const bMinLat = Math.min(...mLats), bMaxLat = Math.max(...mLats)
    const pad = 1.5
    const paddedBbox: [number, number, number, number] = [
      bMinLng - (bMaxLng - bMinLng) * pad, bMinLat - (bMaxLat - bMinLat) * pad,
      bMaxLng + (bMaxLng - bMinLng) * pad, bMaxLat + (bMaxLat - bMinLat) * pad,
    ]

    if (state.terrain) {
      const N = state.terrain.grid_size
      const [exp_minE, exp_minN, exp_maxE, exp_maxN] = state.terrain.bbox_lv95
      const centerE = (exp_minE + exp_maxE) / 2
      const centerN = (exp_minN + exp_maxN) / 2
      filledElevations = fillNullElevations(state.terrain.elevations, state.terrain.min_elevation)

      const vertAt = (col: number, row: number): [number, number, number] => {
        const E = exp_minE + col * (exp_maxE - exp_minE) / (N - 1)
        const Nv = exp_minN + row * (exp_maxN - exp_minN) / (N - 1)
        return [E - centerE, filledElevations[row][col] - minZ, -(Nv - centerN)]
      }
      const tPositions: number[] = []
      const tUVs: number[] = []
      for (let row = 0; row < N - 1; row++) {
        for (let col = 0; col < N - 1; col++) {
          const v00 = vertAt(col, row)
          const v10 = vertAt(col + 1, row)
          const v01 = vertAt(col, row + 1)
          const v11 = vertAt(col + 1, row + 1)
          tPositions.push(...v00, ...v10, ...v01, ...v10, ...v11, ...v01)
          const u0 = col / (N - 1), u1 = (col + 1) / (N - 1)
          const r0 = row / (N - 1), r1 = (row + 1) / (N - 1)
          tUVs.push(u0,r0, u1,r0, u0,r1,  u1,r0, u1,r1, u0,r1)
        }
      }
      const terrainGeo = new THREE.BufferGeometry()
      terrainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tPositions), 3))
      terrainGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tUVs), 2))
      terrainGeo.computeVertexNormals()
      terrainMesh = new THREE.Mesh(terrainGeo, terrainMat)
      terrainMesh.receiveShadow = true
      scene.add(terrainMesh)
      const [wLng0, wLat0] = lv95ToWgs84(exp_minE, exp_minN)
      const [wLng1, wLat1] = lv95ToWgs84(exp_maxE, exp_maxN)
      textureBbox = [wLng0, wLat0, wLng1, wLat1]
    } else {
      const fx0 = (paddedBbox[0] - originLon) * cosLat * 111320
      const fx1 = (paddedBbox[2] - originLon) * cosLat * 111320
      const fz0 = -(paddedBbox[1] - originLat) * 111320
      const fz1 = -(paddedBbox[3] - originLat) * 111320
      const flatGeo = new THREE.BufferGeometry()
      flatGeo.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array([fx0,0,fz0,  fx1,0,fz0,  fx0,0,fz1,  fx1,0,fz1]), 3))
      flatGeo.setAttribute('uv', new THREE.BufferAttribute(
        new Float32Array([0,0,  1,0,  0,1,  1,1]), 2))
      flatGeo.setIndex([0,1,2,  1,3,2])
      flatGeo.computeVertexNormals()
      terrainMesh = new THREE.Mesh(flatGeo, terrainMat)
      terrainMesh.receiveShadow = true
      scene.add(terrainMesh)
      textureBbox = paddedBbox
    }

    // Aerial + cadastral texture
    let loadCancelled = false
    const loadMapTexture = async () => {
      try {
        if (!textureBbox) return
        const { swissUrl, cadUrl, imgW, imgH } = computeMapUrlsFromBbox(...textureBbox)
        const [swissImg, cadImg] = await Promise.all([loadImage(swissUrl), loadImage(cadUrl)])
        if (loadCancelled) return
        const canvas = document.createElement('canvas')
        canvas.width = imgW; canvas.height = imgH
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(swissImg, 0, 0)
        ctx.globalAlpha = 0.5
        ctx.drawImage(cadImg, 0, 0)
        if (loadCancelled) return
        const tex = new THREE.CanvasTexture(canvas)
        compositeTexRef.current = tex
        if (showMapLayerRef.current) {
          terrainMat.map = tex
          terrainMat.color.set(0xffffff)
          terrainMat.needsUpdate = true
        }
      } catch { /* keep gray on error */ }
    }
    loadMapTexture()

    // Terrain height lookup (bilinear on the null-filled grid)
    const terrainHeightAt = (sceneX: number, sceneZ: number): number => {
      if (!state.terrain || filledElevations.length === 0) return 0
      const N = state.terrain.grid_size
      const [exp_minE, exp_minN, exp_maxE, exp_maxN] = state.terrain.bbox_lv95
      const centerE = (exp_minE + exp_maxE) / 2
      const centerN = (exp_minN + exp_maxN) / 2
      const E = sceneX + centerE
      const Nv = -sceneZ + centerN
      const u = (E - exp_minE) / (exp_maxE - exp_minE) * (N - 1)
      const v = (Nv - exp_minN) / (exp_maxN - exp_minN) * (N - 1)
      const u0 = Math.max(0, Math.min(N - 2, Math.floor(u)))
      const v0 = Math.max(0, Math.min(N - 2, Math.floor(v)))
      const fu = u - u0, fv = v - v0
      const el = filledElevations
      return (el[v0][u0] * (1 - fu) * (1 - fv) + el[v0][u0 + 1] * fu * (1 - fv) +
              el[v0 + 1][u0] * (1 - fu) * fv + el[v0 + 1][u0 + 1] * fu * fv) - minZ
    }

    // Member parcel outlines draped on the terrain
    const outlineMat = new THREE.LineBasicMaterial({ color: 0x00E5FF, transparent: true, opacity: 0.5 })
    const outlines: THREE.Line[] = []
    for (const ring of memberRings) {
      const pts = ring.map(([lng, lat]) => {
        const [x, , z] = toLocal(lng, lat, minZ)
        return new THREE.Vector3(x, terrainHeightAt(x, z) + 0.4, z)
      })
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.Line(lineGeo, outlineMat)
      outlines.push(line)
      scene.add(line)
    }

    // Measurements for all project buildings (consumed by deltas, BKP, GEAK)
    const measurements: Record<number, ReturnType<typeof computeMeasurements>> = {}
    for (const { feat, mesh, key } of allFeatureMeshes) {
      measurements[key] = computeMeasurements(mesh, feat, terrainHeightAt, toLocal)
    }
    setBuildingMeasurements(measurements)

    // Camera framing
    const groupBox = new THREE.Box3().setFromObject(group)
    const center = groupBox.getCenter(new THREE.Vector3())
    const sceneBox = new THREE.Box3().setFromObject(scene)
    const size = sceneBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.z, 10)
    camera.position.set(center.x + maxDim, center.y + maxDim * 0.8, center.z + maxDim)
    camera.lookAt(center)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(center)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.screenSpacePanning = false
    controls.minDistance = 3
    controls.maxDistance = maxDim * 6
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    controls.update()

    const onControlsChange = () => {
      const camFloor = terrainHeightAt(camera.position.x, camera.position.z)
      if (camera.position.y < camFloor + 2) camera.position.y = camFloor + 2
      const tgtFloor = terrainHeightAt(controls.target.x, controls.target.z)
      if (controls.target.y < tgtFloor) controls.target.y = tgtFloor
    }
    controls.addEventListener('change', onControlsChange)

    const ro = new ResizeObserver(() => {
      const { width: w, height: h } = container.getBoundingClientRect()
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(container)

    const northVec = new THREE.Vector3()
    let animId: number
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
      if (compassRef.current) {
        northVec.set(0, 0, -1).transformDirection(camera.matrixWorldInverse)
        const angle = Math.atan2(northVec.x, northVec.y) * (180 / Math.PI)
        compassRef.current.style.transform = `rotate(${angle}deg)`
      }
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      loadCancelled = true
      ro.disconnect()
      controls.removeEventListener('change', onControlsChange)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      for (const child of group.children)
        if (child instanceof THREE.Mesh) child.geometry.dispose()
      material.dispose()
      for (const line of outlines) line.geometry.dispose()
      outlineMat.dispose()
      for (const child of massingGroup.children)
        if (child instanceof THREE.Mesh) child.geometry.dispose()
      massingGroupRef.current = null
      meshByEgidRef.current.clear()
      if (terrainMesh) terrainMesh.geometry.dispose()
      terrainMat.dispose()
      terrainMatRef.current = null
      compositeTexRef.current?.dispose()
      compositeTexRef.current = null
      dirLightRef.current = null
      rendererRef.current = null
      sceneCenterRef.current = null
      toLocalRef.current = null
    }
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Massing overlay for the previewed scenario ──────────────────────────────
  useEffect(() => {
    const mg = massingGroupRef.current
    const toLocal = toLocalRef.current
    if (!mg || !toLocal || state.status !== 'ready') return

    for (const child of [...mg.children])
      if (child instanceof THREE.Mesh) child.geometry.dispose()
    mg.clear()

    const scenario = project.scenarios.find(s => s.id === projectScenarioPreviewId)
    if (!scenario) return
    const { params } = scenario
    if (params.extraFloors <= 0 && params.roofType !== 'gable') {
      if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true
      return
    }

    const includedEgids = project.members.flatMap(memberIncludedBuildings).map(b => b.egid)
    const targets = new Set((params.targetEgids ?? includedEgids).map(Number))
    const materials = makeMassingMaterials()

    for (const [key, { mesh, feat }] of meshByEgidRef.current) {
      if (!targets.has(key)) continue
      const ring = findFloorRing(feat)
      if (!ring || ring.length < 4) continue
      const nPts = ring.length - 1
      const footprintLocal = ring.slice(0, nPts).map(([lng, lat, z]) => {
        const [x, , z2] = toLocal(lng, lat, z)
        return [x, z2] as [number, number]
      })
      const positions = mesh.geometry.attributes.position.array
      const bboxMaxY = new THREE.Box3().setFromObject(mesh).max.y
      const baseY = computeEavesY(positions, footprintLocal, bboxMaxY)
      for (const m of buildMassingMeshes(footprintLocal, baseY, params, materials)) {
        mg.add(m)
      }
    }
    if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true

    return () => {
      materials.floor.dispose()
      materials.slab.dispose()
      materials.roof.dispose()
    }
  }, [projectScenarioPreviewId, project.scenarios, project.members, state])

  // ── Map texture toggle ──────────────────────────────────────────────────────
  useEffect(() => {
    const mat = terrainMatRef.current
    if (!mat) return
    mat.map = showMapLayer ? (compositeTexRef.current ?? null) : null
    mat.color.set(showMapLayer && compositeTexRef.current ? 0xffffff : 0x2a2a2a)
    mat.needsUpdate = true
  }, [showMapLayer])

  // ── Sun position ────────────────────────────────────────────────────────────
  useEffect(() => {
    const light = dirLightRef.current
    if (!light || state.status !== 'ready') return
    const center = sceneCenterRef.current
    if (!center) return
    const { azimuth, elevation } = computeSunPosition(center.lat, sunDayOfYear, sunHourOfDay)
    if (elevation <= 0) { light.intensity = 0; return }
    light.intensity = 1.0
    const az = azimuth * Math.PI / 180
    const el = elevation * Math.PI / 180
    light.position.set(
      Math.sin(az) * Math.cos(el) * 1000,
      Math.sin(el) * 1000,
      -Math.cos(az) * Math.cos(el) * 1000,
    )
    if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true
  }, [sunDayOfYear, sunHourOfDay, state.status]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full h-full relative bg-[#080808]">
      <div ref={canvasRef} className="w-full h-full" />

      {state.status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2.5 text-white/30 text-[12px]">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-white/10 border-t-accent animate-spin" />
            Loading project 3D model…
          </div>
        </div>
      )}

      {state.status === 'empty' && (
        <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
          <p className="text-[12px] text-white/30 text-center">
            No 3D geometry found for this project's buildings in downloaded tiles.
          </p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
          <p className="text-[12px] text-red-400/60 text-center">Failed to load 3D data.</p>
        </div>
      )}

      {/* Compass — lower-right corner */}
      {state.status === 'ready' && (
        <div className="absolute bottom-4 right-4 z-10 pointer-events-none select-none">
          <div ref={compassRef} className="w-20 h-20">
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <circle cx="20" cy="20" r="19" fill="rgba(0,0,0,0.62)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
              <circle cx="37" cy="20" r="1.1" fill="rgba(255,255,255,0.2)"/>
              <circle cx="20" cy="37" r="1.1" fill="rgba(255,255,255,0.2)"/>
              <circle cx="3"  cy="20" r="1.1" fill="rgba(255,255,255,0.2)"/>
              <path d="M20 7 L17 20 L23 20 Z" fill="rgba(210,55,55,0.9)"/>
              <path d="M20 33 L17 20 L23 20 Z" fill="rgba(255,255,255,0.18)"/>
              <circle cx="20" cy="20" r="2.5" fill="rgba(255,255,255,0.5)"/>
              <text x="20" y="6" textAnchor="middle" fontSize="5" fontWeight="700"
                    fill="rgba(210,55,55,0.9)" fontFamily="system-ui, sans-serif">N</text>
            </svg>
          </div>
        </div>
      )}

      {/* View toolbar */}
      {state.status === 'ready' && (
        <div className="absolute bottom-4 left-4 z-10">
          <div className="bg-black/60 backdrop-blur-sm rounded-md border border-white/[0.08] min-w-[172px]">
            <div className="px-3 pt-2 pb-1">
              <span className="text-[9px] text-white/20 font-medium tracking-widest uppercase">View</span>
            </div>
            <div className="px-3 pb-2 space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <button
                  role="switch"
                  aria-checked={showMapLayer}
                  onClick={() => setShowMapLayer(v => !v)}
                  className={`relative w-7 h-[14px] rounded-full transition-colors shrink-0 ${
                    showMapLayer ? 'bg-accent' : 'bg-white/15 group-hover:bg-white/20'
                  }`}
                >
                  <span className={`absolute top-[2px] w-[10px] h-[10px] rounded-full bg-white shadow transition-all ${
                    showMapLayer ? 'left-[14px]' : 'left-[2px]'
                  }`} />
                </button>
                <span className="text-[11px] text-white/40 group-hover:text-white/60 transition-colors select-none leading-none">
                  Aerial + cadastral
                </span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useMapStore } from '../store/mapStore'
import { fetchBuildings, fetchNeighborBuildings, type BuildingFeatureCollection } from '../api/buildings'
import { fetchTerrain, type TerrainGrid } from '../api/terrain'
import { findBuildingByEGID } from '../api/geoAdmin'
import { computeMeasurements } from '../utils/buildingMeasurements'
import { computeSunPosition } from '../utils/solarPosition'
import { loadImage, computeMapUrls, getPreloadedMapImages } from '../utils/mapTexture'
import { pointInRing } from '../utils/tileUtils'
import type { AutoTileStatus } from '../hooks/useAutoTileDownload'

function filterNullEgidByParcel(
  data: BuildingFeatureCollection,
  parcelRing: [number, number][],
): BuildingFeatureCollection {
  const features = data.features.filter(feat => {
    if (feat.properties.egid != null) return true
    const all = feat.geometry.coordinates.flat(2) as [number, number, number][]
    if (!all.length) return false
    const lng = all.reduce((s, c) => s + c[0], 0) / all.length
    const lat = all.reduce((s, c) => s + c[1], 0) / all.length
    return pointInRing(lng, lat, parcelRing)
  })
  return { ...data, features }
}

const fmtLV95 = (n: number) =>
  n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2019') // Swiss apostrophe: 2'660'123

// swisstopo approximation formulas — accuracy < 1 m across Switzerland
function lv95ToWgs84(E: number, N: number): [number, number] {
  const e = (E - 2600000) / 1000000
  const n = (N - 1200000) / 1000000
  const lon = 2.6779094 + 4.728982*e + 0.791484*e*n + 0.1306*e*n*n - 0.0436*e*e*e
  const lat = 16.9023892 + 3.238272*n - 0.270978*e*e - 0.002528*n*n - 0.0447*e*e*n - 0.0140*n*n*n
  return [lon * 100/36, lat * 100/36]
}

type ViewerState =
  | { status: 'idle' }
  | { status: 'no-tile' }
  | { status: 'fetching-tile-index' }
  | { status: 'downloading-tile' }
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'ready'; data: BuildingFeatureCollection; terrain: TerrainGrid | null }

export default function BuildingViewer3D({ autoTileStatus }: { autoTileStatus: AutoTileStatus }) {
  const {
    selectedParcel, selectedGWR,
    analysisSelectedEgid, analysisHoveredEgid,
    setBuildingMeasurements, clearBuildingMeasurements,
    sunDayOfYear, sunHourOfDay,
    portfolioSnapshotGeometries, setPortfolioSnapshotGeometries,
    prefetchedGeometry,
  } = useMapStore()
  const [state, setState] = useState<ViewerState>({ status: 'idle' })
  const canvasRef = useRef<HTMLDivElement>(null)
  const compassRef = useRef<HTMLDivElement>(null)

  // Refs so mousemove handler always reads current store values without stale closures
  const selectedGWRRef = useRef(selectedGWR)
  selectedGWRRef.current = selectedGWR
  const selectedParcelRef = useRef(selectedParcel)
  selectedParcelRef.current = selectedParcel

  // Per-session cache for neighbour building lookups (cleared on parcel change)
  const neighborCacheRef = useRef<Map<number, { address: string | null; egrid: string | null } | null>>(new Map())
  const fetchingRef = useRef(new Set<number>())

  const [showNeighbors, setShowNeighbors] = useState(false)
  const [showMapLayer, setShowMapLayer] = useState(true)
  const showMapLayerRef = useRef(true)
  showMapLayerRef.current = showMapLayer
  const terrainMatRef   = useRef<THREE.MeshLambertMaterial | null>(null)
  const compositeTexRef = useRef<THREE.CanvasTexture | null>(null)
  const sceneCenterRef  = useRef<{ lon: number; lat: number } | null>(null)
  const [cursorInfo, setCursorInfo] = useState<{ e: number; n: number; elevation: number } | null>(null)
  const [hoveredInfo, setHoveredInfo] = useState<{
    egid: number
    address?: string
    egrid?: string
    x: number
    y: number
  } | null>(null)
  const [neighborData, setNeighborData] = useState<BuildingFeatureCollection | null>(null)
  const [neighborLoading, setNeighborLoading] = useState(false)
  const neighborGroupRef = useRef<THREE.Group | null>(null)
  const neighborMatRef   = useRef<THREE.MeshPhongMaterial | null>(null)

  // Refs for panel ↔ 3D viewer building highlight
  const dirLightRef             = useRef<THREE.DirectionalLight | null>(null)
  const rendererRef             = useRef<THREE.WebGLRenderer | null>(null)
  const meshByEgidRef           = useRef<Map<number, THREE.Mesh>>(new Map())
  const defaultMatRef           = useRef<THREE.MeshPhongMaterial | null>(null)
  const highlightMatRef         = useRef<THREE.MeshPhongMaterial | null>(null)
  const panelSelectMatRef       = useRef<THREE.MeshPhongMaterial | null>(null)
  const analysisSelectedEgidRef = useRef<number | null>(null)
  analysisSelectedEgidRef.current = analysisSelectedEgid
  const analysisHoveredEgidRef  = useRef<number | null>(null)
  analysisHoveredEgidRef.current  = analysisHoveredEgid

  // Fetch building geometry + terrain when parcel/buildings change
  useEffect(() => {
    if (!selectedParcel) { setState({ status: 'idle' }); return }

    // Use portfolio snapshot if available (bypasses tile requirement and API fetch)
    const snapshot = portfolioSnapshotGeometries
    if (snapshot) {
      setPortfolioSnapshotGeometries(null)
      setNeighborData(snapshot.neighbors)
      const data = snapshot.own
      setState(data.features.length > 0 ? { status: 'ready', data, terrain: null } : { status: 'empty' })
      return
    }

    if (autoTileStatus === 'fetching-index') { setState({ status: 'fetching-tile-index' }); return }
    if (autoTileStatus === 'downloading')    { setState({ status: 'downloading-tile' }); return }
    if (autoTileStatus === 'tile-not-found') { setState({ status: 'no-tile' }); return }
    if (autoTileStatus !== 'ready') { setState({ status: 'idle' }); return }

    const parcelRing = (selectedParcel.geometry.coordinates as [number, number][][])[0]

    // Use prefetched geometry if already loaded in the background
    const prefetched = prefetchedGeometry
    if (prefetched?.egrid === selectedParcel.egrid) {
      const filtered = filterNullEgidByParcel(prefetched.data, parcelRing)
      setState(filtered.features.length > 0
        ? { status: 'ready', data: filtered, terrain: prefetched.terrain }
        : { status: 'empty' })
      return
    }

    const egids = selectedGWRRef.current.map(b => b.egid).filter(e => e !== '—')
    if (egids.length === 0) { setState({ status: 'empty' }); return }

    const coords = (selectedParcel.geometry.coordinates as [number, number][][]).flat()
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const bbox: [number, number, number, number] = [minLng, minLat, maxLng, maxLat]

    // Terrain fetched with extra margin beyond the neighbour bbox so all buildings
    // sit fully on the ground plane
    const pad = 1.5
    const terrainBbox: [number, number, number, number] = [
      minLng - (maxLng - minLng) * pad, minLat - (maxLat - minLat) * pad,
      maxLng + (maxLng - minLng) * pad, maxLat + (maxLat - minLat) * pad,
    ]

    let cancelled = false
    setNeighborData(null)
    setState({ status: 'loading' })

    Promise.all([
      fetchBuildings(egids, bbox),
      fetchTerrain(terrainBbox, 32).catch(() => null),
    ]).then(([data, terrain]) => {
      if (cancelled) return
      const filtered = filterNullEgidByParcel(data, parcelRing)
      setState(filtered.features.length > 0
        ? { status: 'ready', data: filtered, terrain }
        : { status: 'empty' })
    }).catch(() => { if (!cancelled) setState({ status: 'error' }) })

    return () => {
      cancelled = true
      neighborCacheRef.current.clear()
      fetchingRef.current.clear()
    }
  }, [selectedParcel?.egrid, autoTileStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fill null terrain elevation values with neighbor interpolation before mesh construction.
  // Null cells from geo.admin.ch fall back to min_elevation, creating deep spikes in the mesh.
  function fillNullElevations(raw: (number | null)[][], minElev: number): number[][] {
    const rows = raw.length, cols = raw[0]?.length ?? 0
    const grid: (number | null)[][] = raw.map(r => [...r])
    const allValid = grid.flat().filter((v): v is number => v !== null)
    if (allValid.length === 0) return grid.map(r => r.map(() => minElev)) as number[][]
    const sorted = [...allValid].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    // 4 passes of cardinal-neighbor averaging to propagate values inward
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

  // Three.js scene — only when data is ready
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
    renderer.shadowMap.autoUpdate = false  // only update when sun moves
    renderer.shadowMap.needsUpdate = true  // initial render
    rendererRef.current = renderer
    container.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dir = new THREE.DirectionalLight(0xffffff, 1.0)
    dir.castShadow = true
    dir.shadow.mapSize.set(2048, 2048)
    dir.shadow.camera.near = 0.5
    dir.shadow.camera.far = 2000
    dir.shadow.camera.left   = -300
    dir.shadow.camera.right  =  300
    dir.shadow.camera.top    =  300
    dir.shadow.camera.bottom = -300
    dir.shadow.camera.updateProjectionMatrix()
    dir.shadow.bias = -0.001
    dir.position.set(1, 2, 1)
    scene.add(dir)
    dirLightRef.current = dir

    // Collect all building coords to compute scene centre
    const allLngs: number[] = [], allLats: number[] = [], allZs: number[] = []
    for (const feat of state.data.features) {
      for (const poly of feat.geometry.coordinates)
        for (const ring of poly)
          for (const [lng, lat, z] of ring) {
            allLngs.push(lng); allLats.push(lat); allZs.push(z)
          }
    }
    const buildingMinZ = Math.min(...allZs)
    // Terrain is at or below buildings; use terrain min as scene floor
    const minZ = state.terrain
      ? Math.min(buildingMinZ, state.terrain.min_elevation)
      : buildingMinZ

    // Use terrain geographic center as the shared scene origin so that
    // buildings, terrain mesh, and map texture all share one coordinate system.
    // Falls back to building WGS84 centroid when no terrain is available.
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

    // Selected parcel buildings
    meshByEgidRef.current.clear()
    const material = new THREE.MeshPhongMaterial({
      color: 0x2a6099,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    defaultMatRef.current = material
    const group = new THREE.Group()
    for (const feat of state.data.features) {
      const positions: number[] = []
      for (const poly of feat.geometry.coordinates) {
        const ring = poly[0]
        for (let i = 1; i < ring.length - 2; i++) {
          const [x0, y0, z0] = toLocal(...ring[0])
          const [x1, y1, z1] = toLocal(...ring[i])
          const [x2, y2, z2] = toLocal(...ring[i + 1])
          positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2)
        }
      }
      if (positions.length === 0) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData = { egid: feat.properties.egid, isNeighbor: false }
      if (feat.properties.egid != null) meshByEgidRef.current.set(feat.properties.egid, mesh)
      group.add(mesh)
    }
    scene.add(group)

    // Neighbour buildings group (populated by a separate effect)
    const neighborGroup = new THREE.Group()
    neighborGroup.visible = showNeighbors
    scene.add(neighborGroup)
    neighborGroupRef.current = neighborGroup

    const neighborMat = new THREE.MeshPhongMaterial({
      color: 0x607880,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    neighborMatRef.current = neighborMat

    const highlightMat = new THREE.MeshPhongMaterial({
      color: 0x3a80c0,
      emissive: 0x0a1a2a,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    highlightMatRef.current = highlightMat
    const neighborHighlightMat = new THREE.MeshPhongMaterial({
      color: 0x80a0ac,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    const panelSelectMat = new THREE.MeshPhongMaterial({
      color: 0x80c8ff,
      emissive: 0x1a3060,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    panelSelectMatRef.current = panelSelectMat

    // Ground surface — elevation mesh when available, flat plane otherwise
    // LV95 is metric: E-centerE→X, elev-minZ→Y, -(N-centerN)→Z
    let terrainMesh: THREE.Mesh | null = null
    let terrainMat: THREE.MeshLambertMaterial | null = null
    // Null-filled elevation grid — hoisted so terrainHeightAt can reference it
    let filledElevations: number[][] = []
    let terrainCenterE = 0, terrainCenterN = 0

    terrainMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, side: THREE.FrontSide })
    terrainMatRef.current = terrainMat

    if (state.terrain) {
      const N = state.terrain.grid_size
      const [exp_minE, exp_minN, exp_maxE, exp_maxN] = state.terrain.bbox_lv95
      const centerE = (exp_minE + exp_maxE) / 2
      const centerN = (exp_minN + exp_maxN) / 2
      terrainCenterE = centerE
      terrainCenterN = centerN
      const fallbackElev = state.terrain.min_elevation
      filledElevations = fillNullElevations(state.terrain.elevations, fallbackElev)

      const vertAt = (col: number, row: number): [number, number, number] => {
        const E = exp_minE + col * (exp_maxE - exp_minE) / (N - 1)
        const Nv = exp_minN + row * (exp_maxN - exp_minN) / (N - 1)
        const elev = filledElevations[row][col]
        return [E - centerE, elev - minZ, -(Nv - centerN)]
      }

      const tPositions: number[] = []
      const tUVs: number[] = []
      for (let row = 0; row < N - 1; row++) {
        for (let col = 0; col < N - 1; col++) {
          const v00 = vertAt(col,     row)
          const v10 = vertAt(col + 1, row)
          const v01 = vertAt(col,     row + 1)
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
    } else {
      // Flat plane at building floor level with UV mapping matching the terrain bbox
      const parcelCoords = (selectedParcel!.geometry.coordinates as [number, number][][]).flat()
      const plngs = parcelCoords.map(c => c[0]), plats = parcelCoords.map(c => c[1])
      const pMinLng = Math.min(...plngs), pMaxLng = Math.max(...plngs)
      const pMinLat = Math.min(...plats), pMaxLat = Math.max(...plats)
      const tpad = 1.5
      const tMinLng = pMinLng - (pMaxLng - pMinLng) * tpad
      const tMaxLng = pMaxLng + (pMaxLng - pMinLng) * tpad
      const tMinLat = pMinLat - (pMaxLat - pMinLat) * tpad
      const tMaxLat = pMaxLat + (pMaxLat - pMinLat) * tpad
      // Scene coords: x=east, z=south (large z = south, small z = north)
      const fx0 = (tMinLng - originLon) * cosLat * 111320  // west edge
      const fx1 = (tMaxLng - originLon) * cosLat * 111320  // east edge
      const fz0 = -(tMinLat - originLat) * 111320          // south edge (large z)
      const fz1 = -(tMaxLat - originLat) * 111320          // north edge (small z)
      const flatGeo = new THREE.BufferGeometry()
      // SW=(u0,v0), SE=(u1,v0), NW=(u0,v1), NE=(u1,v1)
      flatGeo.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array([fx0,0,fz0,  fx1,0,fz0,  fx0,0,fz1,  fx1,0,fz1]), 3))
      flatGeo.setAttribute('uv', new THREE.BufferAttribute(
        new Float32Array([0,0,  1,0,  0,1,  1,1]), 2))
      flatGeo.setIndex([0,1,2,  1,3,2])
      flatGeo.computeVertexNormals()
      terrainMesh = new THREE.Mesh(flatGeo, terrainMat)
      terrainMesh.receiveShadow = true
      scene.add(terrainMesh)
    }

    // Always load aerial + cadastral texture onto whichever ground surface we have
    let loadCancelled = false
    const loadMapTexture = async () => {
      try {
        const { swissUrl, cadUrl, imgW, imgH } = computeMapUrls(selectedParcel!)
        const cached = getPreloadedMapImages(selectedParcel!.egrid)
        const [swissImg, cadImg] = cached
          ? [cached.swissImg, cached.cadImg]
          : await Promise.all([loadImage(swissUrl), loadImage(cadUrl)])
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
        const mat = terrainMatRef.current
        if (mat && showMapLayerRef.current) {
          mat.map = tex
          mat.color.set(0xffffff)
          mat.needsUpdate = true
        }
      } catch { /* keep gray on error */ }
    }
    loadMapTexture()
    ;(terrainMesh as THREE.Mesh & { _cancelLoad?: () => void })._cancelLoad =
      () => { loadCancelled = true }

    // Camera framing — center on buildings; maxDim from full scene (includes terrain)
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
    controls.screenSpacePanning = false  // pan moves target in world XZ plane, like a map
    controls.minDistance = 3
    controls.maxDistance = maxDim * 6
    controls.maxPolarAngle = Math.PI / 2 - 0.02  // can't orbit below horizon
    controls.update()

    // Camera floor constraint — can't go below terrain surface
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
      const el = filledElevations  // use null-filled grid — no ?? needed
      const e00 = el[v0][u0],       e10 = el[v0][u0 + 1]
      const e01 = el[v0 + 1][u0],   e11 = el[v0 + 1][u0 + 1]
      return (e00 * (1 - fu) * (1 - fv) + e10 * fu * (1 - fv) +
              e01 * (1 - fu) * fv        + e11 * fu * fv) - minZ
    }

    // Compute measurements for each parcel building using 3D mesh + terrain
    const measurements: Record<number, ReturnType<typeof computeMeasurements>> = {}
    for (const feat of state.data.features) {
      if (feat.properties.egid == null) continue
      const mesh = meshByEgidRef.current.get(feat.properties.egid)
      if (mesh) {
        measurements[feat.properties.egid] = computeMeasurements(mesh, feat, terrainHeightAt, toLocal)
      }
    }
    setBuildingMeasurements(measurements)

    const onControlsChange = () => {
      // Keep camera above terrain surface
      const camFloor = terrainHeightAt(camera.position.x, camera.position.z)
      if (camera.position.y < camFloor + 2) camera.position.y = camFloor + 2
      // Keep orbit target above terrain so rotations feel grounded
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

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    let isDragging = false
    let hoveredMesh: THREE.Mesh | null = null

    const restoreHighlight = () => {
      if (!hoveredMesh) return
      const egid = hoveredMesh.userData.egid as number
      const isNeighbor = hoveredMesh.userData.isNeighbor as boolean
      if (egid === analysisSelectedEgidRef.current) {
        // panel-selected: material was not changed by mouse hover, just clear tracker
      } else if (egid === analysisHoveredEgidRef.current) {
        // panel-hovered: keep panel hover material, just clear tracker
      } else {
        hoveredMesh.material = isNeighbor ? neighborMat : material
      }
      hoveredMesh = null
    }
    const applyHighlight = (mesh: THREE.Mesh) => {
      if (mesh.userData.egid === analysisSelectedEgidRef.current) {
        // already at strongest highlight; don't dim it, but track for leave
        hoveredMesh = mesh
        return
      }
      mesh.material = mesh.userData.isNeighbor ? neighborHighlightMat : highlightMat
      hoveredMesh = mesh
    }

    const onMouseDown = () => { isDragging = true; restoreHighlight(); setHoveredInfo(null) }
    const onDocMouseUp = () => { isDragging = false }
    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      if (!isDragging) {
      const targets = [
        ...group.children,
        ...(neighborGroupRef.current?.visible ? neighborGroupRef.current.children : []),
      ]
      const hit = raycaster.intersectObjects(targets, false)[0]
      const hitMesh = hit ? (hit.object as THREE.Mesh) : null
      if (hitMesh !== hoveredMesh) { restoreHighlight(); if (hitMesh) applyHighlight(hitMesh) }
      if (hit) {
        const egid: number = (hit.object as THREE.Mesh).userData.egid
        const gwr = selectedGWRRef.current.find(b => Number(b.egid) === egid)
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        if (gwr) {
          const address = gwr.address !== '—' ? gwr.address : undefined
          const egrid = selectedParcelRef.current?.egrid !== '—'
            ? selectedParcelRef.current?.egrid : undefined
          setHoveredInfo({ egid, address, egrid, x, y })
        } else {
          if (neighborCacheRef.current.has(egid)) {
            const cached = neighborCacheRef.current.get(egid)
            setHoveredInfo({ egid, address: cached?.address ?? undefined, egrid: cached?.egrid ?? undefined, x, y })
          } else {
            setHoveredInfo({ egid, x, y })
            if (!fetchingRef.current.has(egid)) {
              fetchingRef.current.add(egid)
              findBuildingByEGID(String(egid))
                .then(result => {
                  neighborCacheRef.current.set(egid, result)
                  setHoveredInfo(prev =>
                    prev?.egid === egid
                      ? { ...prev, address: result?.address ?? undefined, egrid: result?.egrid ?? undefined }
                      : prev
                  )
                })
                .catch(() => { neighborCacheRef.current.set(egid, null) })
                .finally(() => { fetchingRef.current.delete(egid) })
            }
          }
        }
      } else {
        setHoveredInfo(null)
      }
      } // end !isDragging
      // Always update terrain coordinates regardless of building hover or drag
      if (terrainMesh) {
        const tHit = raycaster.intersectObject(terrainMesh, false)[0]
        if (tHit) {
          setCursorInfo({
            e:         Math.round(tHit.point.x + terrainCenterE),
            n:         Math.round(terrainCenterN - tHit.point.z),
            elevation: Math.round((tHit.point.y + minZ) * 10) / 10,
          })
        } else {
          setCursorInfo(null)
        }
      }
    }
    const onMouseLeave = () => { restoreHighlight(); setHoveredInfo(null); setCursorInfo(null) }

    container.addEventListener('mousedown',  onMouseDown)
    container.addEventListener('mousemove',  onMouseMove)
    container.addEventListener('mouseleave', onMouseLeave)
    document.addEventListener('mouseup', onDocMouseUp)

    return () => {
      cancelAnimationFrame(animId)
      container.removeEventListener('mousedown',  onMouseDown)
      container.removeEventListener('mousemove',  onMouseMove)
      container.removeEventListener('mouseleave', onMouseLeave)
      document.removeEventListener('mouseup', onDocMouseUp)
      restoreHighlight()
      setHoveredInfo(null)
      setCursorInfo(null)
      ro.disconnect()
      controls.removeEventListener('change', onControlsChange)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      for (const child of group.children) {
        if (child instanceof THREE.Mesh) child.geometry.dispose()
      }
      material.dispose()
      highlightMat.dispose()
      panelSelectMat.dispose()
      meshByEgidRef.current.clear()
      clearBuildingMeasurements()
      dirLightRef.current = null
      rendererRef.current = null
      defaultMatRef.current = null
      highlightMatRef.current = null
      panelSelectMatRef.current = null
      if (terrainMesh) {
        ;(terrainMesh as THREE.Mesh & { _cancelLoad?: () => void })._cancelLoad?.()
        terrainMesh.geometry.dispose()
        terrainMat?.dispose()
      }
      compositeTexRef.current?.dispose()
      compositeTexRef.current = null
      terrainMatRef.current = null
      sceneCenterRef.current = null
      for (const child of neighborGroup.children)
        if (child instanceof THREE.Mesh) child.geometry.dispose()
      neighborMat.dispose()
      neighborHighlightMat.dispose()
      neighborGroupRef.current = null
      neighborMatRef.current = null
    }
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Populate neighbour group when data arrives (runs after main effect due to declaration order)
  useEffect(() => {
    const ng  = neighborGroupRef.current
    const mat = neighborMatRef.current
    if (!ng || !mat || state.status !== 'ready') return

    for (const child of [...ng.children])
      if (child instanceof THREE.Mesh) child.geometry.dispose()
    ng.clear()

    if (!neighborData?.features.length) return

    const center = sceneCenterRef.current
    if (!center) return
    const allZs: number[] = []
    for (const f of state.data.features)
      for (const poly of f.geometry.coordinates)
        for (const ring of poly)
          for (const [,, z] of ring) allZs.push(z)
    const buildingMinZ = Math.min(...allZs)
    const minZ = state.terrain ? Math.min(buildingMinZ, state.terrain.min_elevation) : buildingMinZ
    const cosLat = Math.cos(center.lat * Math.PI / 180)
    const toLocal = (lng: number, lat: number, z: number): [number, number, number] => [
      (lng - center.lon) * cosLat * 111320, z - minZ, -(lat - center.lat) * 111320,
    ]

    const selectedEgids = new Set(selectedGWR.map(b => b.egid))
    const parcelRing = (selectedParcel!.geometry.coordinates as [number, number][][])[0]
    for (const feat of neighborData.features) {
      if (selectedEgids.has(String(feat.properties.egid))) continue
      if (feat.properties.egid == null) {
        const all = feat.geometry.coordinates.flat(2) as [number, number, number][]
        const lng = all.reduce((s, c) => s + c[0], 0) / all.length
        const lat = all.reduce((s, c) => s + c[1], 0) / all.length
        if (pointInRing(lng, lat, parcelRing)) continue
      }
      const positions: number[] = []
      for (const poly of feat.geometry.coordinates) {
        const ring = poly[0]
        for (let i = 1; i < ring.length - 2; i++)
          positions.push(...toLocal(...ring[0]), ...toLocal(...ring[i]), ...toLocal(...ring[i + 1]))
      }
      if (!positions.length) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.userData = { egid: feat.properties.egid, isNeighbor: true }
      ng.add(mesh)
    }
  }, [neighborData, state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle neighbour group visibility without rebuilding the scene
  useEffect(() => {
    if (neighborGroupRef.current) neighborGroupRef.current.visible = showNeighbors
  }, [showNeighbors])

  // Toggle aerial+cadastral texture without rebuilding the scene
  useEffect(() => {
    const mat = terrainMatRef.current
    if (!mat) return
    mat.map = showMapLayer ? (compositeTexRef.current ?? null) : null
    mat.color.set(showMapLayer && compositeTexRef.current ? 0xffffff : 0x2a2a2a)
    mat.needsUpdate = true
  }, [showMapLayer])

  // Update directional light position when sun day/time changes
  useEffect(() => {
    const light = dirLightRef.current
    if (!light || state.status !== 'ready') return
    const center = sceneCenterRef.current
    if (!center) return
    const { azimuth, elevation } = computeSunPosition(center.lat, sunDayOfYear, sunHourOfDay)
    if (elevation <= 0) {
      light.intensity = 0
      return
    }
    light.intensity = 1.0
    const az = azimuth * Math.PI / 180
    const el = elevation * Math.PI / 180
    light.position.set(
      Math.sin(az) * Math.cos(el) * 1000,
      Math.sin(el) * 1000,
      -Math.cos(az) * Math.cos(el) * 1000,
    )
    // Trigger one shadow map re-render (autoUpdate is false for performance)
    if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true
  }, [sunDayOfYear, sunHourOfDay, state.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply panel building highlights whenever selected/hovered egid changes
  useEffect(() => {
    if (state.status !== 'ready') return
    const meshMap = meshByEgidRef.current
    if (!meshMap.size) return
    const selEgid = analysisSelectedEgid
    const hovEgid = analysisHoveredEgid
    meshMap.forEach((mesh, egid) => {
      if (egid === selEgid && panelSelectMatRef.current) {
        mesh.material = panelSelectMatRef.current
      } else if (egid === hovEgid && highlightMatRef.current) {
        mesh.material = highlightMatRef.current
      } else if (defaultMatRef.current) {
        mesh.material = defaultMatRef.current
      }
    })
  }, [analysisSelectedEgid, analysisHoveredEgid, state.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Preload neighbours as soon as the scene is ready — before the toggle is clicked
  useEffect(() => {
    if (state.status !== 'ready' || neighborData !== null || !selectedParcel) return
    const coords = (selectedParcel.geometry.coordinates as [number, number][][]).flat()
    const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1])
    const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2
    const cy = (Math.min(...lats) + Math.max(...lats)) / 2
    // Fixed 200 m radius — consistent regardless of parcel size
    const rLat = 200 / 111320
    const rLon = 200 / (111320 * Math.cos(cy * Math.PI / 180))
    const neighborBbox: [number, number, number, number] = [
      cx - rLon, cy - rLat, cx + rLon, cy + rLat,
    ]
    let cancelled = false
    setNeighborLoading(true)
    fetchNeighborBuildings(neighborBbox)
      .then(data => { if (!cancelled) setNeighborData(data) })
      .catch(() => { if (!cancelled) setNeighborData({ type: 'FeatureCollection', features: [] }) })
      .finally(() => { if (!cancelled) setNeighborLoading(false) })
    return () => { cancelled = true }
  }, [state.status, selectedParcel?.egrid]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full h-full relative bg-[#080808]">
      <div ref={canvasRef} className="w-full h-full" />

      {state.status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2.5 text-white/30 text-[12px]">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-white/10 border-t-accent animate-spin" />
            Loading 3D model…
          </div>
        </div>
      )}

      {state.status === 'fetching-tile-index' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2.5 text-white/30 text-[12px]">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-white/10 border-t-accent animate-spin" />
            Finding 3D tile…
          </div>
        </div>
      )}

      {state.status === 'downloading-tile' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2.5 text-white/30 text-[12px]">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-white/10 border-t-accent animate-spin" />
            Downloading 3D data…
          </div>
        </div>
      )}

      {state.status === 'no-tile' && (
        <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
          <p className="text-[12px] text-white/30 text-center">No 3D tile coverage for this location.</p>
        </div>
      )}

      {state.status === 'empty' && (
        <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
          <p className="text-[12px] text-white/30 text-center">
            No 3D geometry found for this parcel's buildings in downloaded tiles.
          </p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
          <p className="text-[12px] text-red-400/60 text-center">Failed to load 3D data.</p>
        </div>
      )}

      {state.status === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
          <p className="text-[12px] text-white/15 text-center">Select a parcel to view 3D geometry.</p>
        </div>
      )}

      {hoveredInfo && (
        <div
          className="absolute z-20 pointer-events-none select-none"
          style={{ left: hoveredInfo.x + 14, top: hoveredInfo.y - 10 }}
        >
          <div className="bg-black/80 backdrop-blur-sm rounded border border-white/10 px-2.5 py-1.5 space-y-0.5">
            {hoveredInfo.address && (
              <p className="text-[11px] text-white/80 leading-tight">{hoveredInfo.address}</p>
            )}
            <p className="text-[10px] text-white/40 font-mono leading-tight">
              EGID {hoveredInfo.egid}
              {hoveredInfo.egrid && <> · EGRID {hoveredInfo.egrid}</>}
            </p>
          </div>
        </div>
      )}

      {/* Compass + coordinate readout — lower-right corner */}
      {state.status === 'ready' && (
        <div className="absolute bottom-4 right-4 z-10 pointer-events-none select-none flex flex-col items-end gap-2">
          <div ref={compassRef} className="w-20 h-20">
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <circle cx="20" cy="20" r="19" fill="rgba(0,0,0,0.62)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
              {/* Cardinal dots E / S / W */}
              <circle cx="37" cy="20" r="1.1" fill="rgba(255,255,255,0.2)"/>
              <circle cx="20" cy="37" r="1.1" fill="rgba(255,255,255,0.2)"/>
              <circle cx="3"  cy="20" r="1.1" fill="rgba(255,255,255,0.2)"/>
              {/* North needle (red) */}
              <path d="M20 7 L17 20 L23 20 Z" fill="rgba(210,55,55,0.9)"/>
              {/* South needle (dim) */}
              <path d="M20 33 L17 20 L23 20 Z" fill="rgba(255,255,255,0.18)"/>
              {/* Center cap */}
              <circle cx="20" cy="20" r="2.5" fill="rgba(255,255,255,0.5)"/>
              {/* N label */}
              <text x="20" y="6" textAnchor="middle" fontSize="5" fontWeight="700"
                    fill="rgba(210,55,55,0.9)" fontFamily="system-ui, sans-serif">N</text>
            </svg>
          </div>

          {cursorInfo && (
            <div className="bg-black/60 backdrop-blur-sm rounded border border-white/[0.08] px-2.5 py-1.5 space-y-px">
              <p className="text-[10px] text-white/45 font-mono leading-tight">E {fmtLV95(cursorInfo.e)}</p>
              <p className="text-[10px] text-white/45 font-mono leading-tight">N {fmtLV95(cursorInfo.n)}</p>
              <p className="text-[10px] text-white/28 font-mono leading-tight">{cursorInfo.elevation.toFixed(1)} m ü.M.</p>
            </div>
          )}
        </div>
      )}

      {/* View toolbar — extensible: add more toggle rows inside the panel body */}
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
                  aria-checked={showNeighbors}
                  onClick={() => setShowNeighbors(v => !v)}
                  className={`relative w-7 h-[14px] rounded-full transition-colors shrink-0 ${
                    showNeighbors ? 'bg-accent' : 'bg-white/15 group-hover:bg-white/20'
                  }`}
                >
                  <span className={`absolute top-[2px] w-[10px] h-[10px] rounded-full bg-white shadow transition-all ${
                    showNeighbors ? 'left-[14px]' : 'left-[2px]'
                  }`} />
                </button>
                <span className="text-[11px] text-white/40 group-hover:text-white/60 transition-colors select-none leading-none">
                  Neighbouring buildings
                </span>
                {neighborLoading && (
                  <span className="w-2.5 h-2.5 rounded-full border border-white/[0.2] border-t-white/50 animate-spin shrink-0" />
                )}
              </label>
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

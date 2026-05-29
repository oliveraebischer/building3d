import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useMapStore } from '../store/mapStore'
import { fetchBuildings, type BuildingFeatureCollection } from '../api/buildings'
import { fetchTerrain, type TerrainGrid } from '../api/terrain'

type ViewerState =
  | { status: 'idle' }
  | { status: 'no-tile' }
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'ready'; data: BuildingFeatureCollection; terrain: TerrainGrid | null }

export default function BuildingViewer3D() {
  const { selectedParcel, selectedGWR, downloadedTileIds } = useMapStore()
  const [state, setState] = useState<ViewerState>({ status: 'idle' })
  const canvasRef = useRef<HTMLDivElement>(null)

  // Fetch building geometry + terrain when parcel/buildings change
  useEffect(() => {
    if (!selectedParcel) { setState({ status: 'idle' }); return }
    if (downloadedTileIds.size === 0) { setState({ status: 'no-tile' }); return }

    const egids = selectedGWR.map(b => b.egid).filter(e => e !== '—')
    if (egids.length === 0) { setState({ status: 'empty' }); return }

    const coords = (selectedParcel.geometry.coordinates as [number, number][][]).flat()
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    const bbox: [number, number, number, number] = [
      Math.min(...lngs), Math.min(...lats),
      Math.max(...lngs), Math.max(...lats),
    ]

    let cancelled = false
    setState({ status: 'loading' })

    Promise.all([
      fetchBuildings(egids, bbox),
      fetchTerrain(bbox).catch(() => null),
    ]).then(([data, terrain]) => {
      if (cancelled) return
      setState(data.features.length > 0
        ? { status: 'ready', data, terrain }
        : { status: 'empty' })
    }).catch(() => { if (!cancelled) setState({ status: 'error' }) })

    return () => { cancelled = true }
  }, [selectedParcel?.egrid, selectedGWR, downloadedTileIds.size]) // eslint-disable-line react-hooks/exhaustive-deps

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
    container.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dir = new THREE.DirectionalLight(0xffffff, 1.0)
    dir.position.set(1, 2, 1)
    scene.add(dir)

    // Collect all building coords to compute scene centre
    const allLngs: number[] = [], allLats: number[] = [], allZs: number[] = []
    for (const feat of state.data.features) {
      for (const poly of feat.geometry.coordinates)
        for (const ring of poly)
          for (const [lng, lat, z] of ring) {
            allLngs.push(lng); allLats.push(lat); allZs.push(z)
          }
    }
    const cx = (Math.min(...allLngs) + Math.max(...allLngs)) / 2
    const cy = (Math.min(...allLats) + Math.max(...allLats)) / 2
    const buildingMinZ = Math.min(...allZs)
    // Terrain is at or below buildings; use terrain min as scene floor
    const minZ = state.terrain
      ? Math.min(buildingMinZ, state.terrain.min_elevation)
      : buildingMinZ
    const cosLat = Math.cos(cy * Math.PI / 180)
    const toLocal = (lng: number, lat: number, z: number): [number, number, number] => [
      (lng - cx) * cosLat * 111320,
      z - minZ,
      -(lat - cy) * 111320,
    ]

    // Buildings
    const material = new THREE.MeshPhongMaterial({
      color: 0x2a6099,
      side: THREE.DoubleSide,
      flatShading: true,
    })
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
      group.add(new THREE.Mesh(geo, material))
    }
    scene.add(group)

    // Terrain mesh
    // LV95 is metric: E-centerE→X, elev-minZ→Y, -(N-centerN)→Z
    let terrainMesh: THREE.Mesh | null = null
    let terrainMat: THREE.MeshLambertMaterial | null = null

    if (state.terrain) {
      const N = state.terrain.grid_size
      const [exp_minE, exp_minN, exp_maxE, exp_maxN] = state.terrain.bbox_lv95
      const centerE = (exp_minE + exp_maxE) / 2
      const centerN = (exp_minN + exp_maxN) / 2
      const fallbackElev = state.terrain.min_elevation

      const vertAt = (col: number, row: number): [number, number, number] => {
        const E = exp_minE + col * (exp_maxE - exp_minE) / (N - 1)
        const Nv = exp_minN + row * (exp_maxN - exp_minN) / (N - 1)
        const elev = state.terrain!.elevations[row][col] ?? fallbackElev
        return [E - centerE, elev - minZ, -(Nv - centerN)]
      }

      const tPositions: number[] = []
      for (let row = 0; row < N - 1; row++) {
        for (let col = 0; col < N - 1; col++) {
          const v00 = vertAt(col,     row)
          const v10 = vertAt(col + 1, row)
          const v01 = vertAt(col,     row + 1)
          const v11 = vertAt(col + 1, row + 1)
          tPositions.push(...v00, ...v10, ...v01, ...v10, ...v11, ...v01)
        }
      }

      const terrainGeo = new THREE.BufferGeometry()
      terrainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tPositions), 3))
      terrainGeo.computeVertexNormals()
      terrainMat = new THREE.MeshLambertMaterial({ color: 0x4a6b3a, side: THREE.FrontSide })
      terrainMesh = new THREE.Mesh(terrainGeo, terrainMat)
      scene.add(terrainMesh)
    }

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
    controls.dampingFactor = 0.08
    controls.update()

    // Camera floor constraint — can't go below terrain surface
    const terrainHeightAt = (sceneX: number, sceneZ: number): number => {
      if (!state.terrain) return 0
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
      const el = state.terrain.elevations
      const fb = state.terrain.min_elevation
      const e00 = el[v0][u0] ?? fb,       e10 = el[v0][u0 + 1] ?? fb
      const e01 = el[v0 + 1][u0] ?? fb,   e11 = el[v0 + 1][u0 + 1] ?? fb
      return (e00 * (1 - fu) * (1 - fv) + e10 * fu * (1 - fv) +
              e01 * (1 - fu) * fv        + e11 * fu * fv) - minZ
    }

    const onControlsChange = () => {
      const floorY = terrainHeightAt(camera.position.x, camera.position.z)
      const minY = floorY + 1.5
      if (camera.position.y < minY) {
        camera.position.y = minY
        if (controls.target.y < minY - 0.5) controls.target.y = minY - 0.5
      }
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

    let animId: number
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      controls.removeEventListener('change', onControlsChange)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      for (const child of group.children) {
        if (child instanceof THREE.Mesh) child.geometry.dispose()
      }
      material.dispose()
      if (terrainMesh) { terrainMesh.geometry.dispose(); terrainMat?.dispose() }
    }
  }, [state])

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

      {state.status === 'no-tile' && (
        <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
          <div className="text-center space-y-1">
            <p className="text-[12px] text-white/30">No tile downloaded for this area.</p>
            <p className="text-[11px] text-white/20">Open Data mode to download the tile first.</p>
          </div>
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
    </div>
  )
}

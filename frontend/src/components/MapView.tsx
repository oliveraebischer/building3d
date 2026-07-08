import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMapStore, BASE_LAYERS } from '../store/mapStore'
import type { PortfolioEntry } from '../store/mapStore'
import type { Project } from '../types/project'
import { PHASE_CONFIG, TYPE_LABELS } from './ProjectsPanel'
import { identifyParcel, findBuildingsByEGRID } from '../api/geoAdmin'

const SWITZERLAND_CENTER: [number, number] = [8.2275, 46.8182]
const INITIAL_ZOOM = 8
const CADASTRAL_MIN_ZOOM = 14

const CADASTRAL_WMS = [
  'https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap',
  '&LAYERS=ch.kantone.cadastralwebmap-farbe',
  '&FORMAT=image/png&TRANSPARENT=true',
  '&CRS=EPSG:3857&WIDTH=256&HEIGHT=256',
  '&BBOX={bbox-epsg-3857}&STYLES=',
].join('')

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapReadyRef = useRef(false)
  const { activeBaseLayerId, dataMode, tileGrid, downloadedTileIds,
          setMapInstance, setLookupParcel,
          setParcelLoading, setParcelResult, clearParcel,
          highlightedTileId } = useMapStore()
  const portfolio = useMapStore(s => s.portfolio)
  const projects = useMapStore(s => s.projects)
  const portfolioHoveredBuildingEgid = useMapStore(s => s.portfolioHoveredBuildingEgid)
  const ingestedLayer = useMapStore(s => s.ingestedLayer)
  const prevHoveredBuildingRef = useRef<string | null>(null)
  const prevHighlightedRef = useRef<string | null>(null)
  const activeLayerRef = useRef<string>('swisstopo-base')
  const pendingSwapRef = useRef<{ cancel: () => void } | null>(null)

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const initialLayer = BASE_LAYERS.find((l) => l.id === 'pixelkarte')!

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'swisstopo-base': {
            type: 'raster',
            tiles: [initialLayer.url],
            tileSize: 256,
            attribution: initialLayer.attribution,
          },
        },
        layers: [{ id: 'swisstopo-base', type: 'raster', source: 'swisstopo-base' }],
      },
      center: SWITZERLAND_CENTER,
      zoom: INITIAL_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      mapReadyRef.current = true
      // Dark background — shows during tile-loading gaps instead of white canvas
      map.addLayer({ id: 'bg', type: 'background', paint: { 'background-color': '#0d0d0d' } })

      // Cadastral overlay — always on, 50% opacity, zoom ≥ 14
      map.addSource('cadastral', {
        type: 'raster',
        tiles: [CADASTRAL_WMS],
        tileSize: 256,
        attribution: '© swisstopo / cantons',
      })
      map.addLayer({
        id: 'cadastral',
        type: 'raster',
        source: 'cadastral',
        minzoom: CADASTRAL_MIN_ZOOM,
        paint: { 'raster-opacity': 0.5 },
      })

      // Parcel highlight source
      map.addSource('parcel-highlight', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'parcel-highlight-fill',
        type: 'fill',
        source: 'parcel-highlight',
        paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.2 },
      })
      map.addLayer({
        id: 'parcel-highlight-outline',
        type: 'line',
        source: 'parcel-highlight',
        paint: { 'line-color': '#00E5FF', 'line-width': 2 },
      })

      // Building hover highlight source
      map.addSource('building-highlight', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'building-highlight-circle',
        type: 'circle',
        source: 'building-highlight',
        paint: {
          'circle-radius': 12,
          'circle-color': '#00E5FF',
          'circle-opacity': 0.4,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#00E5FF',
          'circle-stroke-opacity': 0.9,
        },
      })

      // Tile grid source (populated when data mode is entered)
      map.addSource('tile-grid', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'id',
      })
      map.addLayer({
        id: 'tile-grid-fill',
        type: 'fill',
        source: 'tile-grid',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': ['case', ['feature-state', 'downloaded'], '#00E5FF', 'rgba(255,255,255,0.04)'],
          'fill-opacity': ['case',
            ['all', ['feature-state', 'downloaded'], ['feature-state', 'highlighted']], 0.3,
            ['feature-state', 'downloaded'], 0.15,
            1,
          ],
        },
      }, 'parcel-highlight-fill')
      map.addLayer({
        id: 'tile-grid-outline',
        type: 'line',
        source: 'tile-grid',
        layout: { visibility: 'none' },
        paint: {
          'line-color': [
            'case',
            ['feature-state', 'downloaded'], '#00E5FF',
            ['any', ['feature-state', 'hovered'], ['feature-state', 'highlighted']], 'rgba(255,255,255,0.55)',
            'rgba(255,255,255,0.18)',
          ],
          'line-width': [
            'case',
            ['all', ['feature-state', 'downloaded'], ['feature-state', 'highlighted']], 2.5,
            ['feature-state', 'downloaded'], 1.5,
            ['any', ['feature-state', 'hovered'], ['feature-state', 'highlighted']], 1.5,
            0.7,
          ],
        },
      }, 'parcel-highlight-fill')

      // Ingested data layer (hidden until file is uploaded)
      map.addSource('ingest-data', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'ingest-fill',
        type: 'fill',
        source: 'ingest-data',
        layout: { visibility: 'none' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]] as any,
        paint: { 'fill-color': '#FF6B35', 'fill-opacity': 0.25 },
      })
      map.addLayer({
        id: 'ingest-outline',
        type: 'line',
        source: 'ingest-data',
        layout: { visibility: 'none' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']]] as any,
        paint: { 'line-color': '#FF6B35', 'line-width': 1.5 },
      })
      map.addLayer({
        id: 'ingest-circle',
        type: 'circle',
        source: 'ingest-data',
        layout: { visibility: 'none' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]] as any,
        paint: {
          'circle-radius': 5,
          'circle-color': '#FF6B35',
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#FF4500',
        },
      })

      // Portfolio pins + parcel fills — always visible, color-coded by status
      // Solid colors for the circle pins; transparent for parcel fills/outlines
      const statusColorSolidExpr = [
        'match', ['get', 'status'],
        'watch',           '#C0C0C0',
        'due-diligence',   '#FBD34D',
        'active',          '#34D399',
        'on-hold',         '#FB923C',
        'divested',        '#8A8A8A',
        '#C0C0C0',
      ]
      const statusColorAlphaExpr = [
        'match', ['get', 'status'],
        'watch',           'rgba(200,200,200,0.55)',
        'due-diligence',   'rgba(251,191,36,0.70)',
        'active',          'rgba(52,211,153,0.70)',
        'on-hold',         'rgba(251,146,60,0.70)',
        'divested',        'rgba(150,150,150,0.35)',
        'rgba(200,200,200,0.55)',
      ]

      map.addSource('portfolio-pins', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addSource('portfolio-parcels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'portfolio-parcels-fill',
        type: 'fill',
        source: 'portfolio-parcels',
        minzoom: 14,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        paint: { 'fill-color': statusColorAlphaExpr as any, 'fill-opacity': 0.13 },
      }, 'parcel-highlight-fill')

      map.addLayer({
        id: 'portfolio-parcels-outline',
        type: 'line',
        source: 'portfolio-parcels',
        minzoom: 14,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        paint: { 'line-color': statusColorAlphaExpr as any, 'line-width': 1.5, 'line-opacity': 0.55 },
      }, 'parcel-highlight-fill')

      // Parcel-level pin — visible at low zoom only (fades out when building pins take over)
      map.addLayer({
        id: 'portfolio-pins-circle',
        type: 'circle',
        source: 'portfolio-pins',
        maxzoom: 14,
        paint: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 10] as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'circle-color': statusColorSolidExpr as any,
          'circle-opacity': 1,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.9,
        },
      }, 'building-highlight-circle')

      // Building-level pins — one per GWR building, visible when zoomed in (zoom ≥ 14)
      map.addSource('portfolio-building-pins', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'egid',
      })
      map.addLayer({
        id: 'portfolio-building-pins-circle',
        type: 'circle',
        source: 'portfolio-building-pins',
        minzoom: 14,
        paint: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 5, 18, 9] as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'circle-color': statusColorSolidExpr as any,
          'circle-opacity': 1,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hovered'], false], 3.5, 2] as any,
          'circle-stroke-color': '#ffffff',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 1, 0.8] as any,
        },
      }, 'building-highlight-circle')

      // Dark tooltip style for portfolio pin hover
      const portfolioPopupStyle = document.createElement('style')
      portfolioPopupStyle.textContent = `
        .portfolio-pin-popup .maplibregl-popup-content {
          background: #141414;
          color: #fff;
          padding: 7px 11px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 4px 20px rgba(0,0,0,0.55);
          font-size: 11px;
          font-family: -apple-system, system-ui, sans-serif;
          pointer-events: none;
        }
        .portfolio-pin-popup .maplibregl-popup-tip { display: none; }
      `
      document.head.appendChild(portfolioPopupStyle)

      const portfolioTooltip = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'portfolio-pin-popup',
        offset: [0, -16],
        maxWidth: 'none',
      })

      const PIN_STATUS_LABELS: Record<string, string> = {
        'watch': 'Watch', 'due-diligence': 'Due Diligence',
        'active': 'Active', 'on-hold': 'On Hold', 'divested': 'Divested',
      }

      map.on('mouseenter', 'portfolio-pins-circle', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const feat = e.features?.[0]
        if (!feat) return
        const { label, egrid, status } = feat.properties as { label: string; egrid: string; status: string }
        const displayLabel = label || egrid
        const statusLabel = PIN_STATUS_LABELS[status] ?? status
        portfolioTooltip
          .setLngLat((feat.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(`<div style="font-weight:600;margin-bottom:3px">${displayLabel}</div><div style="color:rgba(255,255,255,0.4);font-size:9px;letter-spacing:0.06em;text-transform:uppercase">${statusLabel}</div>`)
          .addTo(map)
      })

      map.on('mouseleave', 'portfolio-pins-circle', () => {
        map.getCanvas().style.cursor = ''
        portfolioTooltip.remove()
      })

      map.on('click', 'portfolio-pins-circle', (e) => {
        const egrid = e.features?.[0]?.properties?.egrid as string | undefined
        if (!egrid) return
        portfolioTooltip.remove()
        useMapStore.getState().setPortfolioPinClickedEgrid(egrid)
      })

      const portfolioCentroid = (poly: GeoJSON.Polygon): [number, number] => {
        const pts = poly.coordinates.flat() as [number, number][]
        return [pts.reduce((s, c) => s + c[0], 0) / pts.length, pts.reduce((s, c) => s + c[1], 0) / pts.length]
      }

      const updatePortfolioPins = (entries: PortfolioEntry[]) => {
        try {
          const pinsSource = map.getSource('portfolio-pins') as maplibregl.GeoJSONSource | undefined
          const parcelsSource = map.getSource('portfolio-parcels') as maplibregl.GeoJSONSource | undefined
          const buildingPinsSource = map.getSource('portfolio-building-pins') as maplibregl.GeoJSONSource | undefined
          if (!pinsSource || !parcelsSource || !buildingPinsSource) return
          pinsSource.setData({
            type: 'FeatureCollection',
            features: entries.map(e => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: portfolioCentroid(e.parcel.geometry) },
              properties: { egrid: e.parcel.egrid, status: e.status ?? 'watch', label: e.label ?? '' },
            })),
          })
          parcelsSource.setData({
            type: 'FeatureCollection',
            features: entries.map(e => ({
              type: 'Feature' as const,
              geometry: e.parcel.geometry,
              properties: { egrid: e.parcel.egrid, status: e.status ?? 'watch', label: e.label ?? '' },
            })),
          })
          buildingPinsSource.setData({
            type: 'FeatureCollection',
            features: entries.flatMap(e =>
              e.buildings
                .filter(b => b.geometry !== null && b.egid !== '—')
                .map(b => ({
                  type: 'Feature' as const,
                  geometry: b.geometry as GeoJSON.Point,
                  properties: {
                    egid: b.egid,
                    egrid: e.parcel.egrid,
                    status: e.status ?? 'watch',
                    address: b.address !== '—' ? b.address : '',
                    label: e.label ?? '',
                  },
                }))
            ),
          })
        } catch { /* map may be destroyed during HMR */ }
      }

      // Building pin interactions (tooltip + hover state + click)
      map.on('mouseenter', 'portfolio-building-pins-circle', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const feat = e.features?.[0]
        if (!feat) return
        const { address, label, egrid, status, egid } = feat.properties as Record<string, string>
        const displayLabel = address || label || egrid
        const statusLabel = PIN_STATUS_LABELS[status] ?? status
        portfolioTooltip
          .setLngLat((feat.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(`<div style="font-weight:600;margin-bottom:3px">${displayLabel}</div><div style="color:rgba(255,255,255,0.4);font-size:9px;letter-spacing:0.06em;text-transform:uppercase">${statusLabel}</div>`)
          .addTo(map)
        if (egid) useMapStore.getState().setPortfolioHoveredBuildingEgid(egid)
      })

      map.on('mouseleave', 'portfolio-building-pins-circle', () => {
        map.getCanvas().style.cursor = ''
        portfolioTooltip.remove()
        useMapStore.getState().setPortfolioHoveredBuildingEgid(null)
      })

      map.on('click', 'portfolio-building-pins-circle', (e) => {
        const props = e.features?.[0]?.properties as Record<string, string> | undefined
        if (!props?.egrid) return
        portfolioTooltip.remove()
        useMapStore.getState().setPortfolioPinClickedEgrid(props.egrid)
      })

      useMapStore.getState().setPortfolioPinsFn(updatePortfolioPins)
      updatePortfolioPins(useMapStore.getState().portfolio)
      // Stored for cleanup
      ;(map as unknown as Record<string, unknown>)._portfolioPopupStyle = portfolioPopupStyle

      // ── Projects: diamond markers (zoomed out) + dashed construction perimeters (zoomed in) ──
      const makeDiamondIcon = (hex: string): ImageData => {
        const size = 28
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')!
        ctx.translate(size / 2, size / 2)
        ctx.rotate(Math.PI / 4)
        const half = (size / 2 - 2.5) / Math.SQRT2
        ctx.fillStyle = hex
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.rect(-half, -half, half * 2, half * 2)
        ctx.fill()
        ctx.stroke()
        return ctx.getImageData(0, 0, size, size)
      }
      for (const [phase, cfg] of Object.entries(PHASE_CONFIG)) {
        const imgId = `project-marker-${phase}`
        if (!map.hasImage(imgId)) map.addImage(imgId, makeDiamondIcon(cfg.hex))
      }

      const phaseColorExpr = [
        'match', ['get', 'phase'],
        ...Object.entries(PHASE_CONFIG).flatMap(([p, c]) => [p, c.hex]),
        '#C0C0C0',
      ]

      map.addSource('project-areas', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addSource('project-markers', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'project-areas-fill',
        type: 'fill',
        source: 'project-areas',
        minzoom: 14,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        paint: { 'fill-color': phaseColorExpr as any, 'fill-opacity': 0.10 },
      }, 'parcel-highlight-fill')

      map.addLayer({
        id: 'project-areas-outline',
        type: 'line',
        source: 'project-areas',
        minzoom: 14,
        paint: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'line-color': phaseColorExpr as any,
          'line-width': 2,
          'line-opacity': 0.85,
          'line-dasharray': [2, 1.5],
        },
      }, 'parcel-highlight-fill')

      map.addLayer({
        id: 'project-markers-symbol',
        type: 'symbol',
        source: 'project-markers',
        maxzoom: 14,
        layout: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'icon-image': ['concat', 'project-marker-', ['get', 'phase']] as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 14, 1] as any,
          'icon-allow-overlap': true,
        },
      }, 'building-highlight-circle')

      const updateProjectLayers = (projectList: Project[]) => {
        try {
          const markersSource = map.getSource('project-markers') as maplibregl.GeoJSONSource | undefined
          const areasSource = map.getSource('project-areas') as maplibregl.GeoJSONSource | undefined
          if (!markersSource || !areasSource) return
          const withMembers = projectList.filter(p => p.members.length > 0)
          markersSource.setData({
            type: 'FeatureCollection',
            features: withMembers.map(p => {
              const centroids = p.members.map(m => portfolioCentroid(m.parcel.geometry))
              const center: [number, number] = [
                centroids.reduce((s, c) => s + c[0], 0) / centroids.length,
                centroids.reduce((s, c) => s + c[1], 0) / centroids.length,
              ]
              return {
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: center },
                properties: {
                  id: p.id, name: p.name, phase: p.phase,
                  projectType: p.projectType, memberCount: p.members.length,
                },
              }
            }),
          })
          areasSource.setData({
            type: 'FeatureCollection',
            features: withMembers.flatMap(p => p.members.map(m => ({
              type: 'Feature' as const,
              geometry: m.parcel.geometry,
              properties: {
                id: p.id, name: p.name, phase: p.phase,
                projectType: p.projectType, memberCount: p.members.length,
              },
            }))),
          })
        } catch { /* map may be destroyed during HMR */ }
      }

      const projectTooltipHtml = (props: Record<string, unknown>) => {
        const phaseLabel = PHASE_CONFIG[props.phase as keyof typeof PHASE_CONFIG]?.label ?? props.phase
        const typeLabel = TYPE_LABELS[props.projectType as keyof typeof TYPE_LABELS] ?? props.projectType
        const n = props.memberCount as number
        return `<div style="font-weight:600;margin-bottom:3px">${props.name}</div>`
          + `<div style="color:rgba(255,255,255,0.4);font-size:9px;letter-spacing:0.06em;text-transform:uppercase">`
          + `${phaseLabel} · ${typeLabel} · ${n} parcel${n !== 1 ? 's' : ''}</div>`
      }

      for (const layerId of ['project-markers-symbol', 'project-areas-fill'] as const) {
        map.on('mouseenter', layerId, (e) => {
          map.getCanvas().style.cursor = 'pointer'
          const feat = e.features?.[0]
          if (!feat) return
          const lngLat = feat.geometry.type === 'Point'
            ? (feat.geometry as GeoJSON.Point).coordinates as [number, number]
            : [e.lngLat.lng, e.lngLat.lat] as [number, number]
          portfolioTooltip
            .setLngLat(lngLat)
            .setHTML(projectTooltipHtml(feat.properties as Record<string, unknown>))
            .addTo(map)
        })
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = ''
          portfolioTooltip.remove()
        })
        map.on('click', layerId, (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined
          if (!id) return
          portfolioTooltip.remove()
          useMapStore.getState().setProjectMarkerClickedId(id)
        })
      }

      useMapStore.getState().setProjectsMapFn(updateProjectLayers)
      updateProjectLayers(useMapStore.getState().projects)

      // Tile grid interaction
      let hoveredTileId: string | null = null

      map.on('mousemove', 'tile-grid-fill', (e) => {
        if (!useMapStore.getState().dataMode) return
        const newId = (e.features?.[0]?.id as string) ?? null
        if (newId !== hoveredTileId) {
          if (hoveredTileId) map.setFeatureState({ source: 'tile-grid', id: hoveredTileId }, { hovered: false })
          hoveredTileId = newId
          if (newId) map.setFeatureState({ source: 'tile-grid', id: newId }, { hovered: true })
        }
        const { downloadedTileIds: dl, downloadingTileIds: dling } = useMapStore.getState()
        map.getCanvas().style.cursor = newId && !dl.has(newId) && !dling.has(newId) ? 'pointer' : ''
        useMapStore.getState().setHighlightedTileId(newId && dl.has(newId) ? newId : null)
      })

      map.on('mouseleave', 'tile-grid-fill', () => {
        if (hoveredTileId) map.setFeatureState({ source: 'tile-grid', id: hoveredTileId }, { hovered: false })
        hoveredTileId = null
        map.getCanvas().style.cursor = ''
        useMapStore.getState().setHighlightedTileId(null)
      })

      map.on('click', 'tile-grid-fill', (e) => {
        if (!useMapStore.getState().dataMode) return
        const tileId = e.features?.[0]?.id as string
        if (!tileId) return
        const { downloadedTileIds: dl, downloadingTileIds: dling, tileGrid: grid } = useMapStore.getState()
        if (dl.has(tileId) || dling.has(tileId)) return
        const tile = grid.find((t) => t.id === tileId)
        if (!tile) return
        useMapStore.getState().triggerTileDownload(tileId, tile.gdbHref)
      })
    })

    const highlightSource = () =>
      map.getSource('parcel-highlight') as maplibregl.GeoJSONSource | undefined

    const buildingHighlightSource = () =>
      map.getSource('building-highlight') as maplibregl.GeoJSONSource | undefined

    // Shared lookup — called by map clicks and search selection
    const doLookup = async (lng: number, lat: number, showLoading = false) => {
      const bounds = map.getBounds()
      const canvas = map.getCanvas()
      const size = { width: canvas.width, height: canvas.height }

      if (showLoading) setParcelLoading(true)

      try {
        const parcel = await identifyParcel(lng, lat, bounds, size)

        if (!parcel) {
          if (!showLoading) {
            clearParcel()
            highlightSource()?.setData({ type: 'FeatureCollection', features: [] })
          } else {
            setParcelResult(null, [])
            highlightSource()?.setData({ type: 'FeatureCollection', features: [] })
          }
          return
        }

        // Query all buildings on the parcel by EGRID (not by click point)
        const buildings = await findBuildingsByEGRID(parcel.egrid)

        setParcelResult(parcel, buildings)
        highlightSource()?.setData({ type: 'Feature', geometry: parcel.geometry, properties: {} })
      } catch {
        if (showLoading) setParcelResult(null, [], true)
      }
    }

    setLookupParcel(doLookup)

    map.on('click', (e) => {
      if (useMapStore.getState().dataMode) return
      if (map.getZoom() < CADASTRAL_MIN_ZOOM) return
      // Clicks on a project area open the project instead of a parcel lookup
      if (map.getLayer('project-areas-fill')
        && map.queryRenderedFeatures(e.point, { layers: ['project-areas-fill'] }).length > 0) return
      doLookup(e.lngLat.lng, e.lngLat.lat, false)
    })

    map.on('mouseenter', 'parcel-highlight-fill', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'parcel-highlight-fill', () => { map.getCanvas().style.cursor = '' })

    // Expose highlight-clear so the panel close button can clear it
    useMapStore.getState().setClearHighlight(() => {
      highlightSource()?.setData({ type: 'FeatureCollection', features: [] })
      buildingHighlightSource()?.setData({ type: 'FeatureCollection', features: [] })
    })

    // Register building hover highlight callback
    useMapStore.getState().setHighlightBuildingFn((geom) => {
      buildingHighlightSource()?.setData(
        geom
          ? { type: 'Feature', geometry: geom, properties: {} }
          : { type: 'FeatureCollection', features: [] }
      )
    })

    // Register parcel highlight restore callback (used when exiting data mode)
    useMapStore.getState().setParcelHighlightFn((geom) => {
      highlightSource()?.setData({ type: 'Feature', geometry: geom, properties: {} })
    })

    // Register portfolio highlight callback — shows multiple parcel polygons simultaneously
    useMapStore.getState().setPortfolioHighlightFn((geoms) => {
      highlightSource()?.setData({
        type: 'FeatureCollection',
        features: geoms.map(g => ({ type: 'Feature' as const, geometry: g, properties: {} })),
      })
    })

    mapRef.current = map
    setMapInstance(map)

    return () => {
      clearParcel()
      useMapStore.getState().setPortfolioPinsFn(null)
      useMapStore.getState().setProjectsMapFn(null)
      ;((map as unknown as Record<string, unknown>)._portfolioPopupStyle as HTMLStyleElement | undefined)?.remove()
      for (const id of ['portfolio-building-pins-circle', 'portfolio-pins-circle', 'portfolio-parcels-fill', 'portfolio-parcels-outline',
                        'project-markers-symbol', 'project-areas-fill', 'project-areas-outline']) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      for (const id of ['portfolio-building-pins', 'portfolio-pins', 'portfolio-parcels', 'project-markers', 'project-areas']) {
        if (map.getSource(id)) map.removeSource(id)
      }
      for (const id of ['ingest-fill', 'ingest-outline', 'ingest-circle']) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      if (map.getSource('ingest-data')) map.removeSource('ingest-data')
      map.remove()
      mapRef.current = null
      mapReadyRef.current = false
      setMapInstance(null)
      setLookupParcel(null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Swap base layer — crossfade: add new layer first, wait for tiles, then fade
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = BASE_LAYERS.find((l) => l.id === activeBaseLayerId)
    if (!layer) return

    const swap = () => {
      // Cancel any in-flight swap
      pendingSwapRef.current?.cancel()

      const curId = activeLayerRef.current
      const nextId = curId === 'swisstopo-base' ? 'swisstopo-next' : 'swisstopo-base'

      // Add new source + layer below cadastral, fully transparent, instant tile render
      map.addSource(nextId, { type: 'raster', tiles: [layer.url], tileSize: 256, attribution: layer.attribution })
      map.addLayer(
        { id: nextId, type: 'raster', source: nextId, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } },
        map.getLayer('cadastral') ? 'cadastral' : curId,
      )

      let cancelled = false

      const finish = () => {
        if (cancelled) return
        pendingSwapRef.current = null

        // Crossfade: new in, old out over 350 ms
        const transition = { duration: 350, delay: 0 }
        map.setPaintProperty(nextId, 'raster-opacity-transition', transition)
        map.setPaintProperty(curId,  'raster-opacity-transition', transition)
        map.setPaintProperty(nextId, 'raster-opacity', 1)
        map.setPaintProperty(curId,  'raster-opacity', 0)

        setTimeout(() => {
          if (map.getLayer(curId))  map.removeLayer(curId)
          if (map.getSource(curId)) map.removeSource(curId)
          activeLayerRef.current = nextId
        }, 360)
      }

      map.once('idle', finish)
      const fallback = setTimeout(finish, 1500)

      pendingSwapRef.current = {
        cancel: () => {
          cancelled = true
          map.off('idle', finish)
          clearTimeout(fallback)
          // Clean up the partially-added next layer/source
          if (map.getLayer(nextId))  map.removeLayer(nextId)
          if (map.getSource(nextId)) map.removeSource(nextId)
        },
      }
    }

    if (mapReadyRef.current) swap()
    else map.once('load', swap)
  }, [activeBaseLayerId])

  // Enforce cadastral visibility whenever dataMode or base layer changes.
  // The TopBar also calls setLayoutProperty directly on click (immediate),
  // but this effect is the safety net for remounts and layer-swap timing.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      if (map.getLayer('cadastral')) {
        map.setLayoutProperty('cadastral', 'visibility', dataMode ? 'none' : 'visible')
      }
    }
    if (mapReadyRef.current) apply()
    else map.once('load', apply)
  }, [dataMode, activeBaseLayerId])

  // Populate tile-grid GeoJSON source when tile data is fetched
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current || tileGrid.length === 0) return
    const src = map.getSource('tile-grid') as maplibregl.GeoJSONSource | undefined
    src?.setData({
      type: 'FeatureCollection',
      features: tileGrid.map((f) => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: { id: f.id },
      })),
    })
  }, [tileGrid])

  // Sync downloaded feature-state on the tile-grid source
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current || tileGrid.length === 0) return
    tileGrid.forEach((t) => {
      map.setFeatureState({ source: 'tile-grid', id: t.id }, { downloaded: downloadedTileIds.has(t.id) })
    })
  }, [downloadedTileIds, tileGrid])

  // Sync highlightedTileId → map 'highlighted' feature-state (panel↔map bidirectional highlight)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current) return
    if (prevHighlightedRef.current) {
      map.setFeatureState({ source: 'tile-grid', id: prevHighlightedRef.current }, { highlighted: false })
    }
    if (highlightedTileId) {
      map.setFeatureState({ source: 'tile-grid', id: highlightedTileId }, { highlighted: true })
    }
    prevHighlightedRef.current = highlightedTileId
  }, [highlightedTileId])

  // Show/hide tile grid layers with dataMode
  useEffect(() => {
    const map = mapRef.current
    const apply = () => {
      const vis = dataMode ? 'visible' : 'none'
      ;(['tile-grid-fill', 'tile-grid-outline'] as const).forEach((id) => {
        if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
      })
    }
    if (mapReadyRef.current) apply()
    else map?.once('load', apply)
  }, [dataMode])

  // Sync ingested layer to map when it changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current) return
    const src = map.getSource('ingest-data') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    src.setData(ingestedLayer ?? { type: 'FeatureCollection', features: [] })
    const vis = ingestedLayer ? 'visible' : 'none'
    ;(['ingest-fill', 'ingest-outline', 'ingest-circle'] as const).forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    })
  }, [ingestedLayer])

  // Keep portfolio pins + parcel fills in sync whenever portfolio changes
  useEffect(() => {
    useMapStore.getState().portfolioPinsFn?.(portfolio)
  }, [portfolio])

  // Keep project markers + areas in sync whenever projects change
  useEffect(() => {
    useMapStore.getState().projectsMapFn?.(projects)
  }, [projects])

  // Sync portfolio building hover → map feature state
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current) return
    if (prevHoveredBuildingRef.current) {
      try { map.setFeatureState({ source: 'portfolio-building-pins', id: prevHoveredBuildingRef.current }, { hovered: false }) } catch { /* source may not exist yet */ }
    }
    if (portfolioHoveredBuildingEgid) {
      try { map.setFeatureState({ source: 'portfolio-building-pins', id: portfolioHoveredBuildingEgid }, { hovered: true }) } catch { /* ok */ }
    }
    prevHoveredBuildingRef.current = portfolioHoveredBuildingEgid
  }, [portfolioHoveredBuildingEgid])

  return <div ref={mapContainer} className="absolute inset-0" />
}

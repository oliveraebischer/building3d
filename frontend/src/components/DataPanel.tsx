import { useState, useEffect, useRef } from 'react'
import { useMapStore } from '../store/mapStore'
import {
  fetchAllTiles, fetchDownloadedTiles, deleteTile,
  type DownloadedTile,
} from '../api/tiles'

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-white/40 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4 text-white/30 text-[11px]">
      <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-white/10 border-t-accent animate-spin" />
      Loading tile index…
    </div>
  )
}

function TileRow({
  tile, onDelete, isHighlighted, onMouseEnter, onMouseLeave,
}: {
  tile: DownloadedTile
  onDelete: (id: string) => void
  isHighlighted: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const short = tile.id.split('_').slice(-1)[0]
  const sizeMB = (tile.size_bytes / 1_000_000).toFixed(1)
  const date = tile.downloaded_at.slice(0, 10)

  return (
    <div
      className={`flex items-center justify-between px-4 py-2.5 group transition-colors ${isHighlighted ? 'bg-accent/10' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="min-w-0">
        <span className={`text-[11px] font-mono block truncate transition-colors ${isHighlighted ? 'text-accent' : 'text-white/80'}`}>{short}</span>
        <span className="text-[10px] text-white/30">{sizeMB} MB · {date}</span>
      </div>
      <button
        onClick={() => onDelete(tile.id)}
        className="ml-3 shrink-0 text-white/20 hover:text-white/70 transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Delete tile"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}
          strokeLinecap="round" viewBox="0 0 24 24">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

type IngestState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'done'; name: string; count: number; columns: string[]; truncated: boolean }
  | { status: 'error'; message: string }

function IngestPanel() {
  const { ingestedLayer, ingestedColumns, setIngestedLayer } = useMapStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<IngestState>({ status: 'idle' })

  const handleFile = async (file: File) => {
    setState({ status: 'uploading' })
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
        setState({ status: 'error', message: err.detail ?? 'Upload failed' })
        return
      }
      const data = await res.json()
      setIngestedLayer(data, data.columns ?? [])
      setState({
        status: 'done',
        name: file.name,
        count: data.feature_count,
        columns: data.columns ?? [],
        truncated: data.truncated,
      })
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleClear = () => {
    setIngestedLayer(null)
    setState({ status: 'idle' })
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="m-3 mt-0 rounded-xl border border-white/[0.08] bg-[#161616] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <p className="text-[10px] font-bold tracking-widest uppercase text-white/40">Import Data</p>
      </div>

      {state.status === 'idle' && !ingestedLayer && (
        <div
          className="mx-3 my-3 border border-dashed border-white/[0.12] rounded-lg p-4 text-center cursor-pointer hover:border-white/30 transition-colors"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
        >
          <p className="text-[11px] text-white/40">Drop file or click to browse</p>
          <p className="text-[10px] text-white/20 mt-1">CSV · XLSX · GeoJSON · SHP · GDB</p>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xls,.geojson,.json,.shp,.zip,.gdb"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>
      )}

      {state.status === 'uploading' && (
        <div className="flex items-center gap-2 px-4 py-4 text-white/40 text-[11px]">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-white/10 border-t-accent animate-spin shrink-0" />
          Parsing file…
        </div>
      )}

      {state.status === 'error' && (
        <div className="px-4 py-3 space-y-1.5">
          <p className="text-[11px] text-red-400/80">{state.message}</p>
          <button onClick={() => setState({ status: 'idle' })} className="text-[11px] text-white/40 hover:text-white/70 underline">
            Try again
          </button>
        </div>
      )}

      {(state.status === 'done' || (state.status === 'idle' && ingestedLayer)) && (
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              {state.status === 'done' && (
                <p className="text-[11px] text-white/70 truncate max-w-[160px]">{state.name}</p>
              )}
              <p className="text-[10px] text-accent">
                {state.status === 'done'
                  ? `${state.count.toLocaleString()} features${state.truncated ? ` (first ${(10000).toLocaleString()} shown)` : ''}`
                  : 'Layer active'}
              </p>
            </div>
            <button
              onClick={handleClear}
              className="text-white/30 hover:text-white/70 transition-colors"
              aria-label="Clear layer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {(state.status === 'done' ? state.columns : ingestedColumns).length > 0 && (
            <p className="text-[10px] text-white/25 leading-relaxed">
              {(state.status === 'done' ? state.columns : ingestedColumns).slice(0, 8).join(' · ')}
              {(state.status === 'done' ? state.columns : ingestedColumns).length > 8 && ' …'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function DataPanel() {
  const {
    dataMode, tileGrid, downloadedTileIds, tileGridLoading,
    setTileGrid, setDownloadedTileIds, setTileGridLoading,
    removeDownloadedTileId, highlightedTileId, setHighlightedTileId,
  } = useMapStore()

  const [open, setOpen] = useState(true)
  const [downloadedMeta, setDownloadedMeta] = useState<DownloadedTile[]>([])
  const [loadError, setLoadError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  // Fetch tile grid when entering data mode (once); downloaded list is fetched independently
  useEffect(() => {
    if (!dataMode || tileGrid.length > 0) return
    setLoadError(false)
    setTileGridLoading(true)
    fetchAllTiles()
      .then((tiles) => setTileGrid(tiles))
      .catch(() => setLoadError(true))
      .finally(() => setTileGridLoading(false))
    // Downloaded tiles are independent — a dead backend must not block the tile grid
    fetchDownloadedTiles().then((downloaded) => {
      setDownloadedMeta(downloaded)
      setDownloadedTileIds(downloaded.map((d) => d.id))
    })
  }, [dataMode, retryCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh metadata list after each download or delete
  useEffect(() => {
    if (!dataMode) return
    fetchDownloadedTiles().then(setDownloadedMeta)
  }, [downloadedTileIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string) => {
    await deleteTile(id)
    removeDownloadedTileId(id)
  }

  const handleRetry = () => {
    setLoadError(false)
    setTileGrid([])
    setRetryCount(c => c + 1)
  }

  const downloadCount = downloadedTileIds.size

  return (
    <div className="overflow-y-auto max-h-[40vh]">
      <IngestPanel />
      <div className="m-3 rounded-xl border border-white/[0.08] bg-[#161616] overflow-hidden">

        {/* Card header */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
        >
          <div className="text-left">
            <p className="text-[10px] font-bold tracking-widest uppercase text-white/40">
              SwissBUILDINGS3D 3.0
            </p>
            {!open && downloadCount > 0 && (
              <p className="text-[11px] text-accent mt-0.5">
                {downloadCount} tile{downloadCount !== 1 ? 's' : ''} downloaded
              </p>
            )}
          </div>
          <ChevronIcon open={open} />
        </button>

        {/* Card body */}
        {open && (
          <div className="border-t border-white/[0.06]">
            {tileGridLoading && <LoadingRow />}

            {!tileGridLoading && loadError && (
              <div className="px-4 py-4 space-y-1.5">
                <p className="text-[11px] text-red-400/70">Failed to load tile index.</p>
                <button
                  onClick={handleRetry}
                  className="text-[11px] text-white/50 hover:text-white/80 underline transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {!tileGridLoading && !loadError && downloadCount === 0 && (
              <p className="px-4 py-4 text-[11px] text-white/30 italic">
                Click a tile on the map to download it.
              </p>
            )}

            {!tileGridLoading && !loadError && downloadCount > 0 && (
              <div className="divide-y divide-white/[0.05]">
                {downloadedMeta.map((tile) => (
                  <TileRow
                    key={tile.id}
                    tile={tile}
                    onDelete={handleDelete}
                    isHighlighted={highlightedTileId === tile.id}
                    onMouseEnter={() => setHighlightedTileId(tile.id)}
                    onMouseLeave={() => setHighlightedTileId(null)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

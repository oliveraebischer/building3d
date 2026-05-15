import { useState, useEffect } from 'react'
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

export default function DataPanel() {
  const {
    dataMode, tileGrid, downloadedTileIds, tileGridLoading,
    setTileGrid, setDownloadedTileIds, setTileGridLoading,
    removeDownloadedTileId, highlightedTileId, setHighlightedTileId,
  } = useMapStore()

  const [open, setOpen] = useState(true)
  const [downloadedMeta, setDownloadedMeta] = useState<DownloadedTile[]>([])

  // Fetch tile grid + downloaded list when entering data mode (once)
  useEffect(() => {
    if (!dataMode || tileGrid.length > 0) return
    setTileGridLoading(true)
    Promise.all([fetchAllTiles(), fetchDownloadedTiles()])
      .then(([tiles, downloaded]) => {
        setTileGrid(tiles)
        setDownloadedMeta(downloaded)
        setDownloadedTileIds(downloaded.map((d) => d.id))
      })
      .finally(() => setTileGridLoading(false))
  }, [dataMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh metadata list after each download or delete
  useEffect(() => {
    if (!dataMode) return
    fetchDownloadedTiles().then(setDownloadedMeta)
  }, [downloadedTileIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string) => {
    await deleteTile(id)
    removeDownloadedTileId(id)
  }

  const downloadCount = downloadedTileIds.size

  return (
    <div className="h-full flex flex-col overflow-y-auto" style={{ paddingTop: 46 }}>
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

            {!tileGridLoading && downloadCount === 0 && (
              <p className="px-4 py-4 text-[11px] text-white/30 italic">
                Click a tile on the map to download it.
              </p>
            )}

            {!tileGridLoading && downloadCount > 0 && (
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

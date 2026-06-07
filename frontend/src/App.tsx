import { useEffect } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import LayerSwitcher from './components/LayerSwitcher'
import ParcelPanel from './components/ParcelPanel'
import AnalysisPanel from './components/AnalysisPanel'
import HelpPanel from './components/HelpPanel'
import { useMapStore, loadPortfolioFromStorage, clearPortfolioStorage } from './store/mapStore'
import { COLLAPSED_W, SEPARATOR_W } from './constants'
import { fetchDownloadedTiles } from './api/tiles'
import { useAutoTileDownload } from './hooks/useAutoTileDownload'
import { usePreloadBuildings } from './hooks/usePreloadBuildings'

export default function App() {
  const { analysisMode, helpMode, sidebarWidth, sidebarCollapsed, setDownloadedTileIds, setPortfolio } = useMapStore()
  const helpPanelLeft = (sidebarCollapsed ? COLLAPSED_W : sidebarWidth) + SEPARATOR_W
  const autoTileStatus = useAutoTileDownload()
  usePreloadBuildings(autoTileStatus)

  useEffect(() => {
    fetchDownloadedTiles().then((tiles) => {
      if (tiles.length > 0) setDownloadedTileIds(tiles.map((t) => t.id))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/portfolio')
      .then((r) => r.json())
      .then((entries: unknown[]) => {
        if (entries.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setPortfolio(entries as any)
        } else {
          // Migration: upload localStorage entries to backend then clear
          const local = loadPortfolioFromStorage()
          if (local.length > 0) {
            setPortfolio(local)
            Promise.all(local.map((e) => fetch('/api/portfolio', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(e),
            })))
              .then(() => clearPortfolioStorage())
              .catch(() => {})
          }
        }
      })
      .catch(() => {
        // Backend unavailable — fall back to localStorage
        setPortfolio(loadPortfolioFromStorage())
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0">
        <MapView />
      </div>
      <Sidebar />
      <LayerSwitcher />
      {!analysisMode && <ParcelPanel autoTileStatus={autoTileStatus} />}
      {analysisMode && <AnalysisPanel autoTileStatus={autoTileStatus} />}
      {helpMode && <HelpPanel left={helpPanelLeft} />}
    </div>
  )
}

import { useEffect } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import LayerSwitcher from './components/LayerSwitcher'
import ParcelPanel from './components/ParcelPanel'
import AnalysisPanel from './components/AnalysisPanel'
import { useMapStore, loadPortfolioFromStorage, clearPortfolioStorage } from './store/mapStore'
import { fetchDownloadedTiles } from './api/tiles'

export default function App() {
  const { analysisMode, setDownloadedTileIds, setPortfolio } = useMapStore()

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
      {!analysisMode && <ParcelPanel />}
      {analysisMode && <AnalysisPanel />}
    </div>
  )
}

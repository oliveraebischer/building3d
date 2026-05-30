import { useEffect } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import LayerSwitcher from './components/LayerSwitcher'
import ParcelPanel from './components/ParcelPanel'
import AnalysisPanel from './components/AnalysisPanel'
import { useMapStore } from './store/mapStore'
import { fetchDownloadedTiles } from './api/tiles'

export default function App() {
  const { analysisMode, setDownloadedTileIds } = useMapStore()

  useEffect(() => {
    fetchDownloadedTiles().then((tiles) => {
      if (tiles.length > 0) setDownloadedTileIds(tiles.map((t) => t.id))
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

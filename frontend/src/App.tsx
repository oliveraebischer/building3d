import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import LayerSwitcher from './components/LayerSwitcher'
import ParcelPanel from './components/ParcelPanel'
import AnalysisPanel from './components/AnalysisPanel'
import { useMapStore } from './store/mapStore'

export default function App() {
  const { analysisMode } = useMapStore()
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

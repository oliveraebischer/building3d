import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import LayerSwitcher from './components/LayerSwitcher'
import ParcelPanel from './components/ParcelPanel'

export default function App() {
  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0">
        <MapView />
      </div>
      <Sidebar />
      <LayerSwitcher />
      <ParcelPanel />
    </div>
  )
}

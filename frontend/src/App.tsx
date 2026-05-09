import MapView from './components/MapView'
import TopBar from './components/TopBar'
import LayerSwitcher from './components/LayerSwitcher'
import ParcelPanel from './components/ParcelPanel'

export default function App() {
  return (
    <div className="relative w-full h-full">
      <MapView />
      <TopBar />
      <LayerSwitcher />
      <ParcelPanel />
    </div>
  )
}

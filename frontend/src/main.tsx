import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles/globals.css'
import AppRoutes from './AppRoutes'

createRoot(document.getElementById('root')!).render(
  <AppRoutes />
)

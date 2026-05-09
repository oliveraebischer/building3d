import SearchBar from './SearchBar'

export default function TopBar() {
  return (
    <header className="absolute top-0 left-0 right-0 z-10 flex items-center gap-4 px-4 py-2.5 bg-surface/90 backdrop-blur-sm border-b border-white/10">
      <div className="flex items-center gap-2 shrink-0">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <rect width="28" height="28" rx="6" fill="#e94560" />
          <path
            d="M7 20 L14 8 L21 20 M10 16 H18"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-white font-semibold tracking-wide text-sm">Building3D</span>
      </div>

      <div className="flex-1 flex justify-center">
        <SearchBar />
      </div>

      <span className="text-xs text-slate-400 shrink-0">Swiss Building Data Explorer</span>
    </header>
  )
}

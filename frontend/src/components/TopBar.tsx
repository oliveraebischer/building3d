export default function TopBar() {
  return (
    <header className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3 bg-surface/90 backdrop-blur-sm border-b border-white/10">
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
      <span className="ml-auto text-xs text-slate-400">Swiss Building Data Explorer</span>
    </header>
  )
}

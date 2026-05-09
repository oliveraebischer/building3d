import SearchBar from './SearchBar'

export default function TopBar() {
  return (
    <header className="absolute top-0 left-0 right-0 z-20 flex items-center gap-4 px-4 py-2.5
                       bg-[#0d0d0d]/95 backdrop-blur-md border-b border-white/[0.07]">
      {/* Logo + name */}
      <div className="flex items-center gap-2.5 shrink-0">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
          <rect width="26" height="26" rx="5" fill="white" />
          <path d="M6 19 L13 7 L20 19 M9.5 15 H16.5"
            stroke="#0D0D0D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-white font-semibold tracking-widest text-xs uppercase">Building3D</span>
      </div>

      {/* Search — centred */}
      <div className="flex-1 flex justify-center">
        <SearchBar />
      </div>

      {/* Right label */}
      <span className="text-xs text-white/30 shrink-0 tracking-wide">Swiss Building Data</span>
    </header>
  )
}

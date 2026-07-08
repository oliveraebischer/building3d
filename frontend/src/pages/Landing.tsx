import { Link } from 'react-router-dom'

function IconWrap({ children }: { children: React.ReactNode }) {
  return (
    <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      {children}
    </svg>
  )
}

function MapIcon() {
  return (
    <IconWrap>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </IconWrap>
  )
}

function BuildingSearchIcon() {
  return (
    <IconWrap>
      <rect x="3" y="3" width="10" height="18" rx="1" />
      <line x1="7" y1="7" x2="9" y2="7" />
      <line x1="7" y1="11" x2="9" y2="11" />
      <line x1="7" y1="15" x2="9" y2="15" />
      <circle cx="18" cy="16" r="4" />
      <line x1="21" y1="19" x2="23" y2="21" />
    </IconWrap>
  )
}

function CubeIcon() {
  return (
    <IconWrap>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </IconWrap>
  )
}

function SunIcon() {
  return (
    <IconWrap>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </IconWrap>
  )
}

function BoltIcon() {
  return (
    <IconWrap>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </IconWrap>
  )
}

function HardHatIcon() {
  return (
    <IconWrap>
      <path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z" />
      <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
      <path d="M4 15v-3a6 6 0 0 1 6-6" />
      <path d="M14 6a6 6 0 0 1 6 6v3" />
    </IconWrap>
  )
}

const FEATURES = [
  {
    icon: <MapIcon />,
    title: 'Map exploration',
    description: 'Search any Swiss address or click the map to identify parcels and buildings instantly.',
  },
  {
    icon: <BuildingSearchIcon />,
    title: 'Parcel & GWR analysis',
    description: 'Pull official cadastral and building-registry (GWR) data for any parcel in one view.',
  },
  {
    icon: <CubeIcon />,
    title: '3D buildings',
    description: 'Explore real building geometry from SwissBUILDINGS3D — volume, facade, roof, footprint.',
  },
  {
    icon: <SunIcon />,
    title: 'Sun & shadow simulation',
    description: 'Simulate shadows across the year and day to assess solar access and overshadowing.',
  },
  {
    icon: <BoltIcon />,
    title: 'GEAK energy insight',
    description: 'Estimate energy performance with a SIA 380/1-based GEAK calculation per building.',
  },
  {
    icon: <HardHatIcon />,
    title: 'Portfolio & projects',
    description: 'Track parcels through due diligence, and promote them into renovation or development projects.',
  },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white/90">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-10 bg-[#0d0d0d]/80 backdrop-blur border-b border-white/[0.07]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-wide">
            Building<span className="text-accent">3D</span>
          </span>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-white/50 hover:text-white/90 transition-colors">
              Log in
            </Link>
            <Link
              to="/register"
              className="text-sm bg-accent text-black font-medium px-3.5 py-1.5 rounded-md hover:opacity-90 transition-opacity"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 overflow-hidden">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 800 400"
        >
          <g stroke="rgba(255,255,255,0.06)" strokeWidth="1">
            {Array.from({ length: 9 }).map((_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 50} x2="800" y2={i * 50} />
            ))}
            {Array.from({ length: 17 }).map((_, i) => (
              <line key={`v${i}`} x1={i * 50} y1="0" x2={i * 50} y2="400" />
            ))}
          </g>
          <g stroke="#00E5FF" strokeOpacity="0.35" strokeWidth="1.5" fill="none">
            <rect x="480" y="180" width="120" height="90" />
            <line x1="480" y1="180" x2="520" y2="140" />
            <line x1="600" y1="180" x2="640" y2="140" />
            <line x1="600" y1="270" x2="640" y2="230" />
            <line x1="520" y1="140" x2="640" y2="140" />
            <line x1="640" y1="140" x2="640" y2="230" />
          </g>
        </svg>

        <div className="relative max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-white">
            Explore Swiss buildings in 3D
          </h1>
          <p className="mt-5 text-base md:text-lg text-white/50 max-w-xl mx-auto">
            Search parcels, pull GWR building data, view real 3D geometry, simulate sun and shadow,
            and estimate energy performance — all in one map-first workspace.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              to="/register"
              className="bg-accent text-black font-medium px-5 py-2.5 rounded-md text-sm hover:opacity-90 transition-opacity"
            >
              Get Started
            </Link>
            <Link
              to="/login"
              className="border border-white/15 text-white/70 px-5 py-2.5 rounded-md text-sm hover:border-white/30 hover:text-white transition-colors"
            >
              Log in
            </Link>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="px-4 pb-24">
        <div className="max-w-5xl mx-auto grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-[#161616] border border-white/[0.07] rounded-lg p-5">
              <div className="mb-3">{f.icon}</div>
              <h3 className="text-sm font-semibold text-white/90 mb-1.5">{f.title}</h3>
              <p className="text-[13px] leading-relaxed text-white/45">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="px-4 pb-20">
        <div className="max-w-5xl mx-auto bg-[#161616] border border-white/[0.07] rounded-xl px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/60">
            Start exploring your first parcel in under a minute.
          </p>
          <Link
            to="/register"
            className="bg-accent text-black font-medium px-5 py-2.5 rounded-md text-sm hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            Get Started
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 pb-8">
        <p className="max-w-5xl mx-auto text-[12px] text-white/25">
          Building3D — Swiss building data explorer · {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  )
}

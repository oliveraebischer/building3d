import { useState } from 'react'
import { HELP_PANEL_W, SEPARATOR_W, COLLAPSED_W } from '../constants'
import { useMapStore } from '../store/mapStore'

const PAD_NONE = { top: 0, bottom: 0, left: 0, right: 0 }

interface HelpPanelProps {
  left: number
}

type FAQItem = { q: string; a: string }
type Section = { id: string; title: string; comingSoon?: boolean; faqs: FAQItem[] }

const SECTIONS: Section[] = [
  {
    id: 'search',
    title: 'Search',
    faqs: [
      {
        q: 'How do I find a parcel?',
        a: 'Type an address, municipality, or place name into the search bar at the top of the sidebar. Select a result to fly the map to that location and load the parcel information automatically.',
      },
      {
        q: 'What are recent searches?',
        a: 'The sidebar remembers your last 10 searches. Click any entry to jump back to that location without retyping.',
      },
      {
        q: 'What is a parcel (Grundstück)?',
        a: 'A parcel is a cadastral land unit identified by a unique EGRID number. Each parcel can contain one or more buildings, each with its own EGID (federal building identifier).',
      },
      {
        q: 'Why does clicking the map sometimes not load a parcel?',
        a: 'Parcel lookup queries the swisstopo GWR API in real time. If the request times out, the location has no registered parcel, or you are zoomed out too far, no panel will appear. Try zooming in and clicking again.',
      },
      {
        q: 'Can I search by EGRID or parcel number?',
        a: 'The search uses swisstopo\'s geocoding service, which covers addresses and place names. Direct EGRID lookup is not supported yet — use an address to navigate to the location and then click the parcel on the map.',
      },
    ],
  },
  {
    id: 'portfolio',
    title: 'Portfolio',
    faqs: [
      {
        q: 'How do I add a parcel to my portfolio?',
        a: 'Click a parcel on the map or search for an address, then click "Add to Portfolio" in the parcel info panel. The parcel is saved immediately and appears in the Portfolio list.',
      },
      {
        q: 'What do the status labels mean?',
        a: 'Watch — tracking without active intent. Due Diligence — actively investigating. Active — part of your current holdings or open transactions. On Hold — temporarily paused. Divested — sold or exited position.',
      },
      {
        q: 'Can I add labels and notes?',
        a: 'Yes. Open a portfolio entry and edit the label field for a short custom name, or the notes field for free-text commentary. Both are stored in the backend and persist across sessions.',
      },
      {
        q: 'What is a 3D snapshot?',
        a: 'A snapshot saves the building geometry as it exists at the time of capture. You can later compare the shape against updated SwissBUILDINGS3D data to detect changes or confirm a renovation.',
      },
      {
        q: 'How are portfolio parcels shown on the map?',
        a: 'When you open Portfolio mode, all saved parcels are highlighted and labelled with pins. Hovering a pin or a list entry highlights the corresponding parcel.',
      },
      {
        q: 'Is my data stored only locally?',
        a: 'Portfolio data is stored in the backend database (and migrated from localStorage if you used an older version). It is not shared with swisstopo or any third party.',
      },
    ],
  },
  {
    id: 'analyse',
    title: 'Analyse',
    faqs: [
      {
        q: 'How do I enter analysis mode?',
        a: 'Select a parcel on the map, then click "Analyse" in the parcel panel. The app will load 3D building geometry for the parcel (downloading it automatically if needed) and open the split view.',
      },
      {
        q: 'How do I navigate the 3D viewer?',
        a: 'Left-click drag to orbit the scene, right-click drag to pan, and scroll to zoom. The camera centres on the buildings automatically when you first enter the view.',
      },
      {
        q: 'What is the GEAK energy rating?',
        a: 'GEAK (Gebäudeenergieausweis der Kantone) is the Swiss cantonal energy certificate. Ratings run from A (best) to G (worst) across two axes: building envelope quality and overall energy consumption. The panel shows the rating if one is registered in the federal GWR for that building.',
      },
      {
        q: 'What does the sun & shadow analysis show?',
        a: 'The chart estimates direct sun exposure for each building over the course of a year, derived from the 3D geometry and surrounding terrain. Use the day-of-year and hour sliders to preview exact shadow positions at a specific moment.',
      },
      {
        q: 'What is the EGID filter?',
        a: 'On parcels with multiple buildings, the EGID filter bar lets you toggle individual buildings on and off. Deselecting a building removes it from the 3D viewer and excludes it from measurements and sun calculations.',
      },
      {
        q: 'What measurements are displayed?',
        a: 'Footprint area (m²), roof projected area (m²), estimated building volume (m³), total height (m), and eave / ridge heights where detectable from the SwissBUILDINGS3D 3.0 geometry.',
      },
      {
        q: 'Why is the 3D geometry missing or incomplete?',
        a: 'SwissBUILDINGS3D tiles are downloaded on demand. If a tile has not been downloaded yet, the app will attempt to fetch it automatically. Buildings without a matching tile show a flat footprint extrusion as a fallback.',
      },
    ],
  },
  {
    id: 'projects',
    title: 'Projects',
    comingSoon: true,
    faqs: [
      {
        q: 'What will Projects include?',
        a: 'Projects will let you group multiple parcels and buildings into named development or investment projects, track timelines, assign statuses, and generate summary reports across all parcels in a project.',
      },
    ],
  },
]

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

export default function HelpPanel({ left }: HelpPanelProps) {
  const { setHelpMode, mapInstance, sidebarWidth, sidebarCollapsed } = useMapStore()
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['search']))
  const [openFaqs, setOpenFaqs] = useState<Set<string>>(new Set())

  function handleClose() {
    setHelpMode(false)
    const w = sidebarCollapsed ? COLLAPSED_W : sidebarWidth
    mapInstance?.easeTo({ padding: { ...PAD_NONE, left: w + SEPARATOR_W }, duration: 500 })
  }

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleFaq(key: string) {
    setOpenFaqs(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div
      className="absolute top-0 bottom-0 z-20 flex flex-col bg-[#0d0d0d]/95 border-r border-white/[0.07] overflow-hidden"
      style={{ left, width: HELP_PANEL_W }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] shrink-0">
        <div>
          <div className="text-white text-sm font-semibold tracking-wide">Guide</div>
          <div className="text-white/35 text-[10px] mt-0.5">Documentation & FAQs</div>
        </div>
        <button
          onClick={handleClose}
          className="w-7 h-7 flex items-center justify-center rounded-md text-white/30 hover:text-white hover:bg-white/[0.06] transition-colors"
          aria-label="Close guide"
        >
          <XIcon />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {SECTIONS.map((section) => {
          const isOpen = openSections.has(section.id)
          return (
            <div key={section.id} className="border-b border-white/[0.05]">
              {/* Section header */}
              <button
                onClick={() => !section.comingSoon && toggleSection(section.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                  section.comingSoon
                    ? 'cursor-default'
                    : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold tracking-wide uppercase ${
                    section.comingSoon ? 'text-white/25' : 'text-white/70'
                  }`}>
                    {section.title}
                  </span>
                  {section.comingSoon && (
                    <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-white/[0.06] text-white/25">
                      Soon
                    </span>
                  )}
                </div>
                {!section.comingSoon && (
                  <span className="text-white/25">
                    <ChevronIcon open={isOpen} />
                  </span>
                )}
              </button>

              {/* FAQ items */}
              {isOpen && !section.comingSoon && (
                <div className="pb-2">
                  {section.faqs.map((faq, fi) => {
                    const faqKey = `${section.id}-${fi}`
                    const faqOpen = openFaqs.has(faqKey)
                    return (
                      <div key={fi} className="mx-3 mb-1 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleFaq(faqKey)}
                          className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors rounded-lg"
                        >
                          <span className="mt-0.5 shrink-0 text-white/20">
                            <ChevronIcon open={faqOpen} />
                          </span>
                          <span className="text-xs text-white/60 leading-relaxed">{faq.q}</span>
                        </button>
                        {faqOpen && (
                          <div className="px-3 pb-3 pt-0.5">
                            <p className="text-[11px] text-white/40 leading-relaxed pl-5">
                              {faq.a}
                            </p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Coming soon content */}
              {section.comingSoon && (
                <div className="px-4 pb-4">
                  <p className="text-[11px] text-white/25 leading-relaxed">
                    {section.faqs[0]?.a}
                  </p>
                </div>
              )}
            </div>
          )
        })}

        {/* Footer */}
        <div className="px-4 py-5 text-center">
          <p className="text-[10px] text-white/20 leading-relaxed">
            Data sourced from swisstopo GWR, SwissBUILDINGS3D 3.0 and federal registries.
          </p>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'

// Shared compact form controls used by the Analysis and Project module panels.

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-white/30 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

// Compact number input
export function NumInput({
  label, value, onChange, unit, step = 0.01, min = 0,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  unit?: string
  step?: number
  min?: number
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-white/25">{label}</span>
      <div className="flex items-baseline gap-1">
        <input
          type="number"
          step={step}
          min={min}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full text-[10px] text-white/70 bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5 outline-none focus:border-accent/40"
        />
        {unit && <span className="text-[9px] text-white/20 shrink-0">{unit}</span>}
      </div>
    </div>
  )
}

// Compact select input
export function SelInput<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: T[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-white/25">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className="text-[10px] text-white/70 bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5 outline-none focus:border-accent/40"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// Collapsible sub-section
export function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-white/[0.04]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-0 py-2 text-left"
      >
        <span className="text-[10px] text-white/40 font-medium">{title}</span>
        <ChevronIcon open={open} />
      </button>
      {open && <div className="pb-2 space-y-2">{children}</div>}
    </div>
  )
}

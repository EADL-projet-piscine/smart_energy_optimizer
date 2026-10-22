import type { KeyboardEvent } from 'react'
import { cn } from './cn'

export type TabEntry = {
  id: string
  title: string
  detail: string
}

type Props = {
  entries: TabEntry[]
  active: string
  panelId: string
  label: string
  onSelect: (id: string) => void
}

export function Tabs({ entries, active, panelId, label, onSelect }: Props) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = entries.findIndex((entry) => entry.id === active)
    if (index < 0) return
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = entries[(index + delta + entries.length) % entries.length]
    onSelect(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={handleKeyDown} className="mt-4 flex gap-2 overflow-x-auto pb-0.5">
      {entries.map((entry) => {
        const selected = entry.id === active
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`tab-${entry.id}`}
            aria-selected={selected}
            aria-controls={panelId}
            onClick={() => onSelect(entry.id)}
            className={cn(
              'flex min-w-[104px] shrink-0 flex-col rounded-xl border border-transparent px-3 pt-2 pb-[9px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien',
              selected ? 'bg-orange text-white' : 'bg-onglet text-encre',
            )}
          >
            <span className="text-[13px] font-bold tracking-[-0.01em]">{entry.title}</span>
            <span className={cn('text-xs', selected ? 'text-white/85' : 'text-discret')}>{entry.detail}</span>
          </button>
        )
      })}
    </div>
  )
}

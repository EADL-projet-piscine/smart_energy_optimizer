import type { ReactNode } from 'react'
import { cn } from './cn'

export function Liste({ children }: { children: ReactNode }) {
  return <ul className="m-0 grid list-none gap-2 p-0">{children}</ul>
}

export function Ligne({
  children,
  accent,
}: {
  children: ReactNode
  accent?: 'danger' | 'ambre'
}) {
  return (
    <li
      className={cn(
        'grid items-center gap-3 rounded-xl border border-bordure bg-inset p-3',
        accent ? 'grid-cols-1' : 'grid-cols-[auto_1fr_auto]',
        accent === 'danger' && 'shadow-[inset_3px_0_0_var(--danger)]',
        accent === 'ambre' && 'shadow-[inset_3px_0_0_var(--ambre)]',
      )}
    >
      {children}
    </li>
  )
}

export function Pastille({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-[26px] place-items-center rounded-lg bg-[rgba(255,122,26,0.16)] text-[13px] font-bold text-orange">
      {children}
    </span>
  )
}

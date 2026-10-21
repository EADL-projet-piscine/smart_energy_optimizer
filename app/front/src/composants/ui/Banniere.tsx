import type { ReactNode } from 'react'
import { IconeAttention } from '../Icones'

export function Banniere({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-banniere-bord bg-banniere px-3.5 py-3 text-[13.5px] leading-snug text-banniere-texte"
    >
      <IconeAttention className="mt-px size-[18px] shrink-0 text-ambre" />
      <p className="m-0">{children}</p>
    </div>
  )
}

import type { ReactNode } from 'react'
import { cn } from './cn'

export function List({ children }: { children: ReactNode }) {
  return <ul className="m-0 grid list-none gap-2 p-0">{children}</ul>
}

type RowProps = {
  children: ReactNode
  accent?: 'danger' | 'ambre'
  /** Disposition des enfants.
   *
   * `stacked` les empile — un titre, puis son message. `columns` les place
   * côte à côte — une puce, son texte, une valeur à droite.
   *
   * Par défaut elle suit l'accent, parce qu'une ligne accentuée est
   * historiquement une alerte. `layout` tranche quand le contenu ne suit pas
   * cette règle : une recommandation est numérotée *et* porte la couleur de
   * son alerte, et sans cette prop son numéro passait au-dessus du texte.
   */
  layout?: 'stacked' | 'columns'
}

export function Row({ children, accent, layout }: RowProps) {
  const disposition = layout ?? (accent ? 'stacked' : 'columns')
  return (
    <li
      className={cn(
        'grid items-center gap-3 rounded-xl border border-bordure bg-inset p-3',
        disposition === 'stacked' ? 'grid-cols-1' : 'grid-cols-[auto_1fr_auto]',
        accent === 'danger' && 'shadow-[inset_3px_0_0_var(--danger)]',
        accent === 'ambre' && 'shadow-[inset_3px_0_0_var(--ambre)]',
      )}
    >
      {children}
    </li>
  )
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-[26px] place-items-center rounded-lg bg-accent-doux text-[13px] font-bold text-accent">
      {children}
    </span>
  )
}

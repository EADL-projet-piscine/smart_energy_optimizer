import type { Severite } from '../../services/modele'
import { IconeAttention, IconeFermer } from '../Icones'
import { cn } from './cn'

const icones = {
  critique: 'text-danger',
  moyenne: 'text-ambre',
  info: 'text-ambre',
} as const

type Props = {
  severite: Severite
  titre: string
  message: string
  onFermer: () => void
  onDetail?: () => void
}

export function Toast({ severite, titre, message, onFermer, onDetail }: Props) {
  return (
    <aside
      role="status"
      className="absolute top-[46%] right-2 grid w-[min(320px,42%)] -translate-y-1/2 grid-cols-[auto_1fr] gap-2.5 rounded-[14px] border border-bordure-forte bg-toast py-3.5 pr-8 pl-3.5 shadow-eleve max-[980px]:static max-[980px]:my-2 max-[980px]:w-auto max-[980px]:translate-none"
    >
      <button
        type="button"
        onClick={onFermer}
        aria-label="Fermer l’alerte"
        className="absolute top-2 right-2 grid size-7 place-items-center rounded-lg border-0 bg-transparent text-discret hover:bg-onglet hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien [&_svg]:size-4"
      >
        <IconeFermer />
      </button>
      <IconeAttention className={cn('size-[18px]', icones[severite])} />
      <div>
        <p className="m-0 text-sm font-bold">{titre}</p>
        <p className="mt-1 mb-2 text-[13px] leading-snug text-secondaire">{message}</p>
        {onDetail && (
          <button
            type="button"
            onClick={onDetail}
            className="border-0 bg-transparent p-0 text-[13px] font-[650] text-lien focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien"
          >
            Voir le détail
          </button>
        )}
      </div>
    </aside>
  )
}

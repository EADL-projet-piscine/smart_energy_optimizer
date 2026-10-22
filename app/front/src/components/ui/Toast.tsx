import type { Severity } from '../../services/model'
import { IconClose, IconWarning } from '../Icons'
import { cn } from './cn'

const tones = {
  critique: 'text-danger',
  moyenne: 'text-ambre',
  info: 'text-ambre',
} as const

type Props = {
  severity: Severity
  title: string
  message: string
  onClose: () => void
  onDetail?: () => void
}

export function Toast({ severity, title, message, onClose, onDetail }: Props) {
  return (
    <aside
      role="status"
      className="absolute top-[46%] right-2 grid w-[min(320px,42%)] -translate-y-1/2 grid-cols-[auto_1fr] gap-2.5 rounded-[14px] border border-bordure-forte bg-toast py-3.5 pr-8 pl-3.5 shadow-eleve max-[980px]:static max-[980px]:my-2 max-[980px]:w-auto max-[980px]:translate-none"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer l’alerte"
        className="absolute top-2 right-2 grid size-7 place-items-center rounded-lg border-0 bg-transparent text-discret hover:bg-onglet hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien [&_svg]:size-4"
      >
        <IconClose />
      </button>
      <IconWarning className={cn('size-[18px]', tones[severity])} />
      <div>
        <p className="m-0 text-sm font-bold">{title}</p>
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

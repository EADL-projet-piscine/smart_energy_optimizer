import type { KeyboardEvent } from 'react'
import { cn } from './cn'

export type EntreeOnglet = {
  id: string
  titre: string
  detail: string
}

type Props = {
  entrees: EntreeOnglet[]
  actif: string
  panneauId: string
  libelle: string
  onChoisir: (id: string) => void
}

export function Onglets({ entrees, actif, panneauId, libelle, onChoisir }: Props) {
  function clavier(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = entrees.findIndex((entree) => entree.id === actif)
    if (index < 0) return
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const suivant = entrees[(index + delta + entrees.length) % entrees.length]
    onChoisir(suivant.id)
    document.getElementById(`onglet-${suivant.id}`)?.focus()
  }

  return (
    <div role="tablist" aria-label={libelle} onKeyDown={clavier} className="mt-4 flex gap-2 overflow-x-auto pb-0.5">
      {entrees.map((entree) => {
        const selectionne = entree.id === actif
        return (
          <button
            key={entree.id}
            type="button"
            role="tab"
            id={`onglet-${entree.id}`}
            aria-selected={selectionne}
            aria-controls={panneauId}
            onClick={() => onChoisir(entree.id)}
            className={cn(
              'flex min-w-[104px] shrink-0 flex-col rounded-xl border border-transparent px-3 pt-2 pb-[9px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien',
              selectionne ? 'bg-orange text-white' : 'bg-onglet text-encre',
            )}
          >
            <span className="text-[13px] font-bold tracking-[-0.01em]">{entree.titre}</span>
            <span className={cn('text-xs', selectionne ? 'text-white/85' : 'text-discret')}>{entree.detail}</span>
          </button>
        )
      })}
    </div>
  )
}

import type { ReactNode } from 'react'
import { cn } from './cn'
import { Chiffre, Libelle, type Ton } from './Texte'

type Props = {
  libelle: string
  valeur: string
  unite?: string
  ton?: Ton
  taille?: 'md' | 'lg'
  detail?: ReactNode
  variante?: 'surface' | 'inset'
  className?: string
}

export function Indicateur({
  libelle,
  valeur,
  unite,
  ton = 'defaut',
  taille = 'md',
  detail,
  variante = 'surface',
  className,
}: Props) {
  return (
    <article
      className={cn(
        variante === 'surface'
          ? 'min-h-[124px] rounded-2xl border border-bordure bg-carte px-[18px] pt-[18px] pb-4 shadow-[0_1px_0_rgba(255,255,255,0.02)]'
          : 'rounded-xl border border-bordure bg-inset px-3.5 pt-3.5 pb-3',
        className,
      )}
    >
      <Libelle>{libelle}</Libelle>
      <Chiffre valeur={valeur} unite={unite} ton={ton} taille={variante === 'surface' ? taille : 'md'} />
      {detail && <div className="mt-2 text-[13px] text-secondaire">{detail}</div>}
    </article>
  )
}

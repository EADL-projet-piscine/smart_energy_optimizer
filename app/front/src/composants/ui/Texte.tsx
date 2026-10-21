import type { ReactNode } from 'react'
import { cn } from './cn'

export function Libelle({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[11px] font-[650] tracking-[0.08em] text-discret uppercase">{children}</p>
}

const tons = {
  defaut: 'text-encre',
  danger: 'text-danger',
  ok: 'text-hausse',
  ambre: 'text-ambre',
} as const

export type Ton = keyof typeof tons

export function Chiffre({
  valeur,
  unite,
  ton = 'defaut',
  taille = 'md',
}: {
  valeur: string
  unite?: string
  ton?: Ton
  taille?: 'md' | 'lg'
}) {
  return (
    <p
      className={cn(
        'mt-2.5 flex items-baseline gap-1.5 font-[650] tracking-[-0.04em] tabular-nums',
        taille === 'lg' ? 'mt-3 text-[34px] max-[680px]:text-[30px]' : 'text-[26px]',
        tons[ton],
      )}
    >
      <span>{valeur}</span>
      {unite && <small className="text-[0.46em] font-medium tracking-normal text-secondaire">{unite}</small>}
    </p>
  )
}

export function Commentaire({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[13px] leading-snug text-discret">{children}</p>
}

export function SousTitre({ children }: { children: ReactNode }) {
  return <h4 className="mt-3 mb-2 text-[13px] font-[650] tracking-[0.04em] text-discret uppercase">{children}</h4>
}

export function TexteSites({ texte }: { texte: string }) {
  const morceaux = texte.split(/(SITE\d+)/g)
  return morceaux.map((morceau, index) =>
    /^SITE\d+$/.test(morceau) ? (
      <strong key={`${morceau}-${index}`} className="font-bold text-encre">
        {morceau}
      </strong>
    ) : (
      <span key={index}>{morceau}</span>
    ),
  )
}

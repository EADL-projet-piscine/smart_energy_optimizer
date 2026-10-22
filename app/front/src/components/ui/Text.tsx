import type { ReactNode } from 'react'
import { cn } from './cn'

export function Label({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[11px] font-[650] tracking-[0.08em] text-discret uppercase">{children}</p>
}

const tones = {
  defaut: 'text-encre',
  danger: 'text-danger',
  ok: 'text-hausse',
  ambre: 'text-ambre',
} as const

export type Tone = keyof typeof tones

export function Figure({
  value,
  unit,
  tone = 'defaut',
  size = 'md',
}: {
  value: string
  unit?: string
  tone?: Tone
  size?: 'md' | 'lg'
}) {
  return (
    <p
      className={cn(
        'mt-2.5 flex items-baseline gap-1.5 font-[650] tracking-[-0.04em] tabular-nums',
        size === 'lg' ? 'mt-3 text-[34px] max-[680px]:text-[30px]' : 'text-[26px]',
        tones[tone],
      )}
    >
      <span>{value}</span>
      {unit && <small className="text-[0.46em] font-medium tracking-normal text-secondaire">{unit}</small>}
    </p>
  )
}

export function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[13px] leading-snug text-discret">{children}</p>
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <h4 className="mt-3 mb-2 text-[13px] font-[650] tracking-[0.04em] text-discret uppercase">{children}</h4>
}

/** Met en gras les identifiants de site (SITE001…) trouvés dans un texte. */
export function SiteText({ text }: { text: string }) {
  const parts = text.split(/(SITE\d+)/g)
  return parts.map((part, index) =>
    /^SITE\d+$/.test(part) ? (
      <strong key={`${part}-${index}`} className="font-bold text-encre">
        {part}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  )
}

import type { ReactNode } from 'react'
import { IconWarning } from '../Icons'
import { cn } from './cn'

export type BannerTone = 'ambre' | 'danger'

/** Couleurs du bandeau : l'ambre prévient, le rouge presse.
 *
 * Les variantes claires sont explicites : sans elles, un texte pensé pour le
 * fond sombre devient illisible en thème clair.
 */
const TONES: Record<BannerTone, string> = {
  ambre: 'border-banniere-bord bg-banniere text-banniere-text',
  danger:
    'border-[rgba(255,109,70,0.4)] bg-[rgba(255,109,70,0.16)] text-[#ff8d62] light:border-[#fdba74] light:bg-[#ffedd5] light:text-[#c2410c]',
}

const ICON_TONES: Record<BannerTone, string> = {
  ambre: 'text-ambre',
  danger: 'text-[#ff8d62] light:text-[#c2410c]',
}

type Props = {
  tone?: BannerTone
  children: ReactNode
}

export function Banner({ tone = 'ambre', children }: Props) {
  return (
    <div
      role="status"
      className={cn(
        'mt-3.5 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13.5px] leading-snug',
        TONES[tone],
      )}
    >
      <IconWarning className={cn('mt-px size-[18px] shrink-0', ICON_TONES[tone])} />
      <p className="m-0">{children}</p>
    </div>
  )
}

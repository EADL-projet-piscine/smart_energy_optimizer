import type { ReactNode } from 'react'
import { cn } from './cn'
import { Figure, Label, type Tone } from './Text'

type Props = {
  label: string
  value: string
  unit?: string
  tone?: Tone
  size?: 'md' | 'lg'
  detail?: ReactNode
  variant?: 'surface' | 'inset'
  className?: string
}

export function Metric({
  label,
  value,
  unit,
  tone = 'defaut',
  size = 'md',
  detail,
  variant = 'surface',
  className,
}: Props) {
  return (
    <article
      className={cn(
        variant === 'surface'
          ? 'min-h-[124px] rounded-2xl border border-bordure bg-carte px-[18px] pt-[18px] pb-4 shadow-[0_1px_0_rgba(255,255,255,0.02)]'
          : 'rounded-xl border border-bordure bg-inset px-3.5 pt-3.5 pb-3',
        className,
      )}
    >
      <Label>{label}</Label>
      <Figure value={value} unit={unit} tone={tone} size={variant === 'surface' ? size : 'md'} />
      {detail && <div className="mt-2 text-[13px] text-secondaire">{detail}</div>}
    </article>
  )
}

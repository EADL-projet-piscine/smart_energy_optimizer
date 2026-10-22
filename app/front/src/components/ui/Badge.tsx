import { cn } from './cn'

const variants = {
  alert: 'bg-[rgba(255,109,70,0.16)] text-[#ff8d62] light:bg-[#ffedd5] light:text-[#c2410c]',
  ambre: 'bg-[rgba(245,165,36,0.16)] text-ambre',
  ok: 'bg-[rgba(61,220,151,0.14)] text-hausse',
} as const

export type BadgeTone = keyof typeof variants

export function Badge({ children, tone }: { children: string; tone: BadgeTone }) {
  return (
    <span className={cn('rounded-full px-2.5 py-1.5 text-[12.5px] font-[650] whitespace-nowrap', variants[tone])}>
      {children}
    </span>
  )
}

export function badgeTone(badge: string): BadgeTone {
  const normalized = badge.toLowerCase()
  if (normalized.includes('interrompu')) return 'ambre'
  if (normalized.includes('stable') || normalized.includes('nominal')) return 'ok'
  return 'alert'
}

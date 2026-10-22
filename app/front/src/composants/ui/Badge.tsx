import { cn } from './cn'

const variantes = {
  alert: 'bg-[rgba(255,109,70,0.16)] text-[#ff8d62] light:bg-[#ffedd5] light:text-[#c2410c]',
  ambre: 'bg-[rgba(245,165,36,0.16)] text-ambre',
  ok: 'bg-[rgba(61,220,151,0.14)] text-hausse',
} as const

export function Badge({ children, tone }: { children: string; tone: keyof typeof variantes }) {
  return (
    <span className={cn('rounded-full px-2.5 py-1.5 text-[12.5px] font-[650] whitespace-nowrap', variantes[tone])}>
      {children}
    </span>
  )
}

export function tonBadge(badge: string): keyof typeof variantes {
  const text = badge.toLowerCase()
  if (text.includes('interrompu')) return 'ambre'
  if (text.includes('stable') || text.includes('nominal')) return 'ok'
  return 'alert'
}

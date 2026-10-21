import { cn } from './cn'

const variantes = {
  alerte: 'bg-[rgba(255,109,70,0.16)] text-[#ff8d62] light:bg-[#ffedd5] light:text-[#c2410c]',
  ambre: 'bg-[rgba(245,165,36,0.16)] text-ambre',
  ok: 'bg-[rgba(61,220,151,0.14)] text-hausse',
} as const

export function Badge({ children, ton }: { children: string; ton: keyof typeof variantes }) {
  return (
    <span className={cn('rounded-full px-2.5 py-1.5 text-[12.5px] font-[650] whitespace-nowrap', variantes[ton])}>
      {children}
    </span>
  )
}

export function tonBadge(badge: string): keyof typeof variantes {
  const texte = badge.toLowerCase()
  if (texte.includes('interrompu')) return 'ambre'
  if (texte.includes('stable') || texte.includes('nominal')) return 'ok'
  return 'alerte'
}

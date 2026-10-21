import type { ComponentProps } from 'react'
import { cn } from './cn'

const surface =
  'rounded-2xl border border-bordure bg-carte px-[18px] pt-[18px] pb-4 shadow-[0_1px_0_rgba(255,255,255,0.02)]'

export function Carte({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn(surface, 'mt-3.5', className)} {...props} />
}

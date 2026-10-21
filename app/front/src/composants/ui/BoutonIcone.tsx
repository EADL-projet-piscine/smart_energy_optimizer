import type { ComponentProps } from 'react'
import { cn } from './cn'

export function BoutonIcone({ className, children, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'relative grid size-[38px] place-items-center rounded-[10px] border-0 bg-transparent text-secondaire hover:bg-onglet hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien disabled:opacity-70 [&_svg]:size-[18px]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

import { formaterNombre } from '../../format'

export function Anneau({ pourcentage }: { pourcentage: number }) {
  const rayon = 26
  const circonference = 2 * Math.PI * rayon
  const borne = Math.min(100, Math.max(0, pourcentage))
  const offset = circonference * (1 - borne / 100)

  return (
    <div className="relative size-[74px] shrink-0" aria-hidden="true">
      <svg viewBox="0 0 72 72" className="size-[74px] -rotate-90">
        <circle cx="36" cy="36" r={rayon} className="fill-none stroke-piste stroke-[7]" />
        <circle
          cx="36"
          cy="36"
          r={rayon}
          className="fill-none stroke-ambre stroke-[7] [stroke-linecap:round]"
          strokeDasharray={circonference}
          strokeDashoffset={offset}
        />
      </svg>
      <p className="absolute inset-0 m-0 flex items-center justify-center gap-px font-bold tracking-[-0.04em]">
        <strong>{formaterNombre(Math.round(borne))}</strong>
        <span className="text-xs font-semibold text-secondaire">%</span>
      </p>
    </div>
  )
}

import { formatNumber } from '../../services/format'

export function Ring({ percentage }: { percentage: number }) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(100, Math.max(0, percentage))
  const offset = circumference * (1 - clamped / 100)

  return (
    <div className="relative size-[74px] shrink-0" aria-hidden="true">
      <svg viewBox="0 0 72 72" className="size-[74px] -rotate-90" aria-hidden="true">
        <circle cx="36" cy="36" r={radius} className="fill-none stroke-piste stroke-[7]" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          className="fill-none stroke-ambre stroke-[7] [stroke-linecap:round]"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <p className="absolute inset-0 m-0 flex items-center justify-center gap-px font-bold tracking-[-0.04em]">
        <strong>{formatNumber(Math.round(clamped))}</strong>
        <span className="text-xs font-semibold text-secondaire">%</span>
      </p>
    </div>
  )
}

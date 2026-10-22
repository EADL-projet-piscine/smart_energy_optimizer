import { cn } from './cn'

const lines = {
  mesure: 'h-[3px] rounded-full bg-mesure',
  prevision: 'h-0 rounded-none border-t-2 border-dashed border-prevision',
  seuil: 'h-0 rounded-none border-t-2 border-dashed border-seuil',
} as const

export type LegendStyle = keyof typeof lines

export function Legend({ entries }: { entries: Array<{ label: string; style: LegendStyle }> }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-3.5 p-0 text-[12.5px] text-secondaire">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-[7px]">
          <span className={cn('inline-block w-[18px]', lines[entry.style])} />
          {entry.label}
        </li>
      ))}
    </ul>
  )
}

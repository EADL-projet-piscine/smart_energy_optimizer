import { useId, useState, type MouseEvent } from 'react'
import { formaterNombre } from '../format'
import type { PointSerie } from '../modele'

type Props = {
  serie: PointSerie[]
  seuilKw: number | null
  afficherValeurPointe?: boolean
  compact?: boolean
}

type Coordonnee = { heure: number; x: number; y: number; valeur: number }

function pasAgréable(maxValeur: number): { ticks: number[]; max: number } {
  const brut = Math.max(maxValeur, 1)
  const pasCible = brut / 3
  const puissance = 10 ** Math.floor(Math.log10(pasCible))
  const residu = pasCible / puissance
  const nice = residu <= 1.2 ? 1 : residu <= 2.5 ? 2 : residu <= 5 ? 5 : 10
  const pas = nice * puissance
  const ticks: number[] = []
  for (let valeur = 0; valeur <= brut + pas * 0.01; valeur += pas) {
    if (valeur > brut * 1.02 && valeur !== 0) break
    ticks.push(Math.round(valeur))
  }
  if (ticks.length === 0) ticks.push(0)
  const max = Math.max(brut * 1.16, ticks[ticks.length - 1] + pas * 0.2)
  return { ticks, max }
}

function courbe(points: Coordonnee[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  let chemin = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[Math.min(points.length - 1, index + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const bas = Math.min(p1.y, p2.y)
    const haut = Math.max(p1.y, p2.y)
    const c1y = Math.min(haut, Math.max(bas, p1.y + (p2.y - p0.y) / 6))
    const c2y = Math.min(haut, Math.max(bas, p2.y - (p3.y - p1.y) / 6))
    chemin += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return chemin
}

export function GraphiqueConsommation({ serie, seuilKw, afficherValeurPointe = false, compact = false }: Props) {
  const [survol, setSurvol] = useState<number | null>(null)
  const gradientId = useId().replace(/:/g, '')
  const largeur = 1000
  const hauteur = compact ? 230 : 320
  const marge = { gauche: 52, droite: 18, haut: compact ? 16 : 22, bas: 32 }
  const plotL = largeur - marge.gauche - marge.droite
  const plotH = hauteur - marge.haut - marge.bas

  const valeurs = serie.flatMap((point) => [point.mesureKw, point.previsionKw]).filter((valeur): valeur is number => valeur !== null)
  const maximum = Math.max(seuilKw ?? 0, ...valeurs, 1)
  const { ticks, max } = pasAgréable(maximum)

  const xDe = (heure: number) => marge.gauche + (heure / 24) * plotL
  const yDe = (valeur: number) => marge.haut + (1 - valeur / max) * plotH

  const mesures: Coordonnee[] = serie
    .filter((point): point is PointSerie & { mesureKw: number } => point.mesureKw !== null)
    .map((point) => ({ heure: point.heure, x: xDe(point.heure), y: yDe(point.mesureKw), valeur: point.mesureKw }))
  const previsions: Coordonnee[] = serie
    .filter((point): point is PointSerie & { previsionKw: number } => point.previsionKw !== null)
    .map((point) => ({
      heure: point.heure,
      x: xDe(point.heure),
      y: yDe(point.previsionKw),
      valeur: point.previsionKw,
    }))

  const cheminMesure = courbe(mesures)
  const cheminPrevision = courbe(previsions)
  const base = marge.haut + plotH
  const cheminAire =
    mesures.length > 1
      ? `${cheminMesure} L ${mesures[mesures.length - 1].x.toFixed(2)} ${base} L ${mesures[0].x.toFixed(2)} ${base} Z`
      : ''

  const pointe = previsions.reduce<Coordonnee | null>((meilleure, point) => {
    if (!meilleure || point.valeur > meilleure.valeur) return point
    return meilleure
  }, null)
  const maintenant = mesures[mesures.length - 1]
  const pointeAuDessus = pointe !== null && seuilKw !== null && pointe.valeur > seuilKw
  const pointSurvole = survol === null ? null : serie.find((point) => point.heure === survol)

  function survoler(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const relatif = ((event.clientX - rect.left) / rect.width) * largeur
    const heure = Math.round(((relatif - marge.gauche) / plotL) * 24)
    if (heure < 0 || heure > 24) {
      setSurvol(null)
      return
    }
    setSurvol(heure)
  }

  return (
    <svg
      className="mt-1.5 block h-auto w-full"
      viewBox={`0 0 ${largeur} ${hauteur}`}
      role="img"
      aria-label="Courbe de consommation mesurée et prévue"
      onMouseMove={survoler}
      onMouseLeave={() => setSurvol(null)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--mesure)" stopOpacity="0.26" />
          <stop offset="100%" stopColor="var(--mesure)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={marge.gauche}
            x2={largeur - marge.droite}
            y1={yDe(tick)}
            y2={yDe(tick)}
            className="stroke-grille"
          />
          <text x={marge.gauche - 10} y={yDe(tick)} className="fill-discret text-xs" textAnchor="end" dominantBaseline="middle">
            {formaterNombre(tick)}
          </text>
        </g>
      ))}

      {[0, 4, 8, 12, 16, 20, 24].map((heure) => (
        <text
          key={heure}
          x={xDe(heure)}
          y={hauteur - 8}
          className={maintenant?.heure === heure ? 'fill-ambre text-xs font-bold' : 'fill-discret text-xs'}
          textAnchor="middle"
        >
          {`${String(heure).padStart(2, '0')}h`}
        </text>
      ))}

      {seuilKw !== null && (
        <g>
          <line
            x1={marge.gauche}
            x2={largeur - marge.droite}
            y1={yDe(seuilKw)}
            y2={yDe(seuilKw)}
            className="fill-none stroke-seuil [stroke-dasharray:6_6] [stroke-linecap:round] [stroke-width:1.6]"
          />
          <text x={largeur - marge.droite - 4} y={yDe(seuilKw) - 8} className="fill-seuil text-[13px] font-bold" textAnchor="end">
            {formaterNombre(seuilKw)} kW
          </text>
        </g>
      )}

      {cheminAire && <path d={cheminAire} fill={`url(#${gradientId})`} />}
      {cheminMesure && (
        <path d={cheminMesure} className="fill-none stroke-mesure [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.6]" />
      )}
      {cheminPrevision && (
        <path
          d={cheminPrevision}
          className="fill-none stroke-prevision [stroke-dasharray:7_6] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.4]"
        />
      )}

      {pointe && pointeAuDessus && (
        <line
          x1={pointe.x}
          x2={pointe.x}
          y1={pointe.y}
          y2={base}
          className="fill-none stroke-seuil opacity-80 [stroke-dasharray:2_4] [stroke-linecap:round] [stroke-width:1.2]"
        />
      )}
      {maintenant && <circle cx={maintenant.x} cy={maintenant.y} r="5.5" className="fill-mesure stroke-carte stroke-2" />}
      {pointe && (
        <circle
          cx={pointe.x}
          cy={pointe.y}
          r="5.5"
          className={pointeAuDessus ? 'fill-seuil stroke-carte stroke-2' : 'fill-prevision stroke-carte stroke-2'}
        />
      )}
      {afficherValeurPointe && pointe && (
        <text x={pointe.x} y={pointe.y - 14} className="fill-seuil text-[13px] font-bold" textAnchor="middle">
          {formaterNombre(pointe.valeur)} kW
        </text>
      )}

      {pointSurvole && survol !== null && (
        <g>
          <line x1={xDe(survol)} x2={xDe(survol)} y1={marge.haut} y2={base} className="fill-none stroke-discret opacity-45 stroke-1" />
          <text x={xDe(survol)} y={marge.haut + 4} className="fill-encre text-xs font-[650]" textAnchor="middle">
            {pointSurvole.mesureKw !== null
              ? `${formaterNombre(pointSurvole.mesureKw)} kW`
              : pointSurvole.previsionKw !== null
                ? `${formaterNombre(pointSurvole.previsionKw)} kW prévus`
                : '—'}
          </text>
        </g>
      )}
    </svg>
  )
}

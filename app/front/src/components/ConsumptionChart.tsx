import { useId, useState, type MouseEvent } from 'react'
import { formatNumber } from '../services/format'
import type { SeriesPoint } from '../services/model'

type Props = {
  series: SeriesPoint[]
  thresholdKw: number | null
  showPeakValue?: boolean
  compact?: boolean
}

type Coordinate = { hour: number; x: number; y: number; value: number }

/** Graduations « rondes » (1, 2, 5 × 10ⁿ) couvrant la valeur maximale. */
function niceStep(maxValue: number): { ticks: number[]; max: number } {
  const raw = Math.max(maxValue, 1)
  const targetStep = raw / 3
  const magnitude = 10 ** Math.floor(Math.log10(targetStep))
  const residual = targetStep / magnitude
  const nice = residual <= 1.2 ? 1 : residual <= 2.5 ? 2 : residual <= 5 ? 5 : 10
  const step = nice * magnitude
  const ticks: number[] = []
  for (let value = 0; value <= raw + step * 0.01; value += step) {
    if (value > raw * 1.02 && value !== 0) break
    ticks.push(Math.round(value))
  }
  if (ticks.length === 0) ticks.push(0)
  const max = Math.max(raw * 1.16, ticks[ticks.length - 1] + step * 0.2)
  return { ticks, max }
}

/** Courbe de Catmull-Rom convertie en Bézier, bornée pour éviter les dépassements. */
function curvePath(points: Coordinate[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[Math.min(points.length - 1, index + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const low = Math.min(p1.y, p2.y)
    const high = Math.max(p1.y, p2.y)
    const c1y = Math.min(high, Math.max(low, p1.y + (p2.y - p0.y) / 6))
    const c2y = Math.min(high, Math.max(low, p2.y - (p3.y - p1.y) / 6))
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return path
}

export function ConsumptionChart({ series, thresholdKw, showPeakValue = false, compact = false }: Props) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null)
  const gradientId = useId().replace(/:/g, '')
  const width = 1000
  const height = compact ? 230 : 320
  const margin = { left: 52, right: 18, top: compact ? 16 : 22, bottom: 32 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  const values = series
    .flatMap((point) => [point.measuredKw, point.forecastKw])
    .filter((value): value is number => value !== null)
  const maxValue = Math.max(thresholdKw ?? 0, ...values, 1)
  const { ticks, max } = niceStep(maxValue)

  const xOf = (hour: number) => margin.left + (hour / 24) * plotWidth
  const yOf = (value: number) => margin.top + (1 - value / max) * plotHeight

  const measured: Coordinate[] = series
    .filter((point): point is SeriesPoint & { measuredKw: number } => point.measuredKw !== null)
    .map((point) => ({ hour: point.hour, x: xOf(point.hour), y: yOf(point.measuredKw), value: point.measuredKw }))
  const forecast: Coordinate[] = series
    .filter((point): point is SeriesPoint & { forecastKw: number } => point.forecastKw !== null)
    .map((point) => ({ hour: point.hour, x: xOf(point.hour), y: yOf(point.forecastKw), value: point.forecastKw }))

  const measuredPath = curvePath(measured)
  const forecastPath = curvePath(forecast)
  const baseline = margin.top + plotHeight
  const areaPath =
    measured.length > 1
      ? `${measuredPath} L ${measured[measured.length - 1].x.toFixed(2)} ${baseline} L ${measured[0].x.toFixed(2)} ${baseline} Z`
      : ''

  const peak = forecast.reduce<Coordinate | null>((best, point) => {
    if (!best || point.value > best.value) return point
    return best
  }, null)
  const latest = measured[measured.length - 1]
  const peakAboveThreshold = peak !== null && thresholdKw !== null && peak.value > thresholdKw
  const hoveredPoint = hoveredHour === null ? null : series.find((point) => point.hour === hoveredHour)

  function handleMouseMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const relative = ((event.clientX - rect.left) / rect.width) * width
    const hour = Math.round(((relative - margin.left) / plotWidth) * 24)
    if (hour < 0 || hour > 24) {
      setHoveredHour(null)
      return
    }
    setHoveredHour(hour)
  }

  return (
    <svg
      className="mt-1.5 block h-auto w-full"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Courbe de consommation mesurée et prévue"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredHour(null)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--mesure)" stopOpacity="0.26" />
          <stop offset="100%" stopColor="var(--mesure)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={margin.left} x2={width - margin.right} y1={yOf(tick)} y2={yOf(tick)} className="stroke-grille" />
          <text
            x={margin.left - 10}
            y={yOf(tick)}
            className="fill-discret text-xs"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {formatNumber(tick)}
          </text>
        </g>
      ))}

      {[0, 4, 8, 12, 16, 20, 24].map((hour) => (
        <text
          key={hour}
          x={xOf(hour)}
          y={height - 8}
          className={latest?.hour === hour ? 'fill-ambre text-xs font-bold' : 'fill-discret text-xs'}
          textAnchor="middle"
        >
          {`${String(hour).padStart(2, '0')}h`}
        </text>
      ))}

      {thresholdKw !== null && (
        <g>
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={yOf(thresholdKw)}
            y2={yOf(thresholdKw)}
            className="fill-none stroke-seuil [stroke-dasharray:6_6] [stroke-linecap:round] [stroke-width:1.6]"
          />
          <text
            x={width - margin.right - 4}
            y={yOf(thresholdKw) - 8}
            className="fill-seuil text-[13px] font-bold"
            textAnchor="end"
          >
            {formatNumber(thresholdKw)} kW
          </text>
        </g>
      )}

      {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
      {measuredPath && (
        <path
          d={measuredPath}
          className="fill-none stroke-mesure [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.6]"
        />
      )}
      {forecastPath && (
        <path
          d={forecastPath}
          className="fill-none stroke-prevision [stroke-dasharray:7_6] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.4]"
        />
      )}

      {peak && peakAboveThreshold && (
        <line
          x1={peak.x}
          x2={peak.x}
          y1={peak.y}
          y2={baseline}
          className="fill-none stroke-seuil opacity-80 [stroke-dasharray:2_4] [stroke-linecap:round] [stroke-width:1.2]"
        />
      )}
      {latest && <circle cx={latest.x} cy={latest.y} r="5.5" className="fill-mesure stroke-carte stroke-2" />}
      {peak && (
        <circle
          cx={peak.x}
          cy={peak.y}
          r="5.5"
          className={peakAboveThreshold ? 'fill-seuil stroke-carte stroke-2' : 'fill-prevision stroke-carte stroke-2'}
        />
      )}
      {showPeakValue && peak && (
        <text x={peak.x} y={peak.y - 14} className="fill-seuil text-[13px] font-bold" textAnchor="middle">
          {formatNumber(peak.value)} kW
        </text>
      )}

      {hoveredPoint && hoveredHour !== null && (
        <g>
          <line
            x1={xOf(hoveredHour)}
            x2={xOf(hoveredHour)}
            y1={margin.top}
            y2={baseline}
            className="fill-none stroke-discret opacity-45 stroke-1"
          />
          <text x={xOf(hoveredHour)} y={margin.top + 4} className="fill-encre text-xs font-[650]" textAnchor="middle">
            {hoveredPoint.measuredKw !== null
              ? `${formatNumber(hoveredPoint.measuredKw)} kW`
              : hoveredPoint.forecastKw !== null
                ? `${formatNumber(hoveredPoint.forecastKw)} kW prévus`
                : '—'}
          </text>
        </g>
      )}
    </svg>
  )
}

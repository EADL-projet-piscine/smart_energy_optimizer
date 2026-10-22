import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatHour, formatNumber, formatTime } from '../services/format'
import type { SeriesPoint } from '../services/model'

type Props = {
  series: SeriesPoint[]
  thresholdKw: number | null
  showPeakValue?: boolean
  compact?: boolean
}

type ChartPoint = {
  time: number
  at: string
  measuredKw: number | null
  forecastKw: number | null
}

type TooltipProps = {
  active?: boolean
  payload?: Array<{ payload: ChartPoint }>
}

function ChartTooltip({ active, payload, lastTime }: TooltipProps & { lastTime: number }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  const heure = point.time === lastTime ? formatTime(point.at) : formatHour(point.at)

  return (
    <div className="rounded-lg border border-bordure-forte bg-toast px-2.5 py-1.5 text-xs shadow-eleve">
      <p className="m-0 font-[650] text-encre">
        {heure} ·{' '}
        {point.measuredKw !== null
          ? `${formatNumber(point.measuredKw)} kW`
          : point.forecastKw !== null
            ? `${formatNumber(point.forecastKw)} kW prévus`
            : 'pas de mesure'}
      </p>
    </div>
  )
}

export function ConsumptionChart({ series, thresholdKw, showPeakValue = false, compact = false }: Props) {
  if (series.length === 0) {
    return <p className="mt-1.5 text-[13px] text-discret">Aucune mesure disponible sur la période.</p>
  }

  const data: ChartPoint[] = series.map((point) => ({
    time: new Date(point.at).getTime(),
    at: point.at,
    measuredKw: point.measuredKw,
    forecastKw: point.forecastKw,
  }))

  const lastTime = data[data.length - 1].time
  const peak = series.reduce<SeriesPoint | null>((best, point) => {
    if (point.forecastKw === null) return best
    if (!best || point.forecastKw > (best.forecastKw ?? 0)) return point
    return best
  }, null)

  return (
    <div className="mt-1.5 w-full" style={{ height: compact ? 230 : 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: compact ? 16 : 22, right: 18, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="aire-mesure" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mesure)" stopOpacity={0.26} />
              <stop offset="100%" stopColor="var(--mesure)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} className="stroke-grille" />

          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(time: number) =>
              time === lastTime ? formatTime(new Date(time).toISOString()) : formatHour(new Date(time).toISOString())
            }
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            className="fill-discret text-xs"
          />
          <YAxis
            tickFormatter={(value: number) => formatNumber(value)}
            tickLine={false}
            axisLine={false}
            width={52}
            className="fill-discret text-xs"
          />

          <Tooltip
            content={<ChartTooltip lastTime={lastTime} />}
            cursor={{ stroke: 'var(--discret)', strokeOpacity: 0.45, strokeWidth: 1 }}
          />

          {thresholdKw !== null && (
            <ReferenceLine
              y={thresholdKw}
              stroke="var(--seuil)"
              strokeDasharray="6 6"
              strokeWidth={1.6}
              label={{
                value: `${formatNumber(thresholdKw)} kW`,
                position: 'insideTopRight',
                className: 'fill-seuil text-[13px] font-bold',
              }}
            />
          )}

          {/* connectNulls reste à false : une mesure absente doit couper la courbe,
              pas être reliée par un trait qui laisserait croire à une valeur. */}
          <Area
            type="monotone"
            dataKey="measuredKw"
            connectNulls={false}
            stroke="var(--mesure)"
            strokeWidth={2.6}
            strokeLinecap="round"
            fill="url(#aire-mesure)"
            dot={false}
            activeDot={{ r: 5.5, strokeWidth: 2, className: 'fill-mesure stroke-carte' }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="forecastKw"
            connectNulls={false}
            stroke="var(--prevision)"
            strokeWidth={2.4}
            strokeDasharray="7 6"
            fill="none"
            dot={false}
            isAnimationActive={false}
          />

          {showPeakValue && peak?.forecastKw != null && (
            <ReferenceLine
              x={new Date(peak.at).getTime()}
              stroke="var(--seuil)"
              strokeDasharray="2 4"
              strokeOpacity={0.8}
              label={{
                value: `${formatNumber(peak.forecastKw)} kW`,
                position: 'top',
                className: 'fill-seuil text-[13px] font-bold',
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

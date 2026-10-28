import { fetchJson } from '../api/client'
import { toIsoUtc } from './format'
import type { History, SeriesPoint } from './model'
import { sumBySite } from './series'

type RawPoint = {
  timestamp?: unknown
  consumption_kw?: unknown
  data_quality?: unknown
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toPoint(raw: RawPoint): SeriesPoint | null {
  if (typeof raw?.timestamp !== 'string') return null
  const at = toIsoUtc(raw.timestamp)
  if (Number.isNaN(new Date(at).getTime())) return null
  // consumption_kw absent reste null : zéro serait une mesure, pas une absence.
  return { at, measuredKw: toNumber(raw.consumption_kw), forecastKw: null }
}

function toSeries(raw: unknown): SeriesPoint[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((point) => toPoint(point as RawPoint))
    .filter((point): point is SeriesPoint => point !== null)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

export async function loadHistory(signal?: AbortSignal): Promise<History> {
  const body = await fetchJson('/api/consommations/historique', signal)
  const sites = (body as { sites?: unknown })?.sites
  if (typeof sites !== 'object' || sites === null) {
    throw new Error('Forme de réponse non reconnue')
  }

  const bySite: Record<string, SeriesPoint[]> = {}
  for (const [siteId, raw] of Object.entries(sites)) {
    bySite[siteId] = toSeries(raw)
  }

  return { park: sumBySite(bySite, 'measuredKw'), bySite }
}

/** Prolonge la série jusqu'à la mesure courante.

L'historique est au pas horaire : son dernier point date de l'heure précédente,
puisque l'heure en cours n'est pas finie. La mesure temps réel comble ce trou et
fait rejoindre à la courbe le chiffre affiché en haut du dashboard. */
export function appendCurrent(
  series: SeriesPoint[],
  currentKw: number | null,
  at: string | undefined,
): SeriesPoint[] {
  if (currentKw === null || !at) return series
  const moment = toIsoUtc(at)
  const time = new Date(moment).getTime()
  if (Number.isNaN(time)) return series

  const last = series[series.length - 1]
  if (last && new Date(last.at).getTime() >= time) return series

  return [...series, { at: moment, measuredKw: currentKw, forecastKw: null }]
}

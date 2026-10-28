import { fetchJson } from '../api/client'
import { toIsoUtc } from './format'
import type { Forecasts, SeriesPoint } from './model'
import { sumBySite } from './series'

type RawPoint = {
  timestamp?: unknown
  predicted_kw?: unknown
  horizon?: unknown
  forecast_origin?: unknown
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toPoint(raw: RawPoint): SeriesPoint | null {
  if (typeof raw?.timestamp !== 'string') return null
  const at = toIsoUtc(raw.timestamp)
  if (Number.isNaN(new Date(at).getTime())) return null
  // Une prévision sans valeur n'est pas une prévision : la ligne est écartée
  // plutôt que tracée à zéro.
  const predicted = toNumber(raw.predicted_kw)
  if (predicted === null) return null
  return { at, measuredKw: null, forecastKw: predicted }
}

function toSeries(raw: unknown): SeriesPoint[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((point) => toPoint(point as RawPoint))
    .filter((point): point is SeriesPoint => point !== null)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

export async function loadForecasts(signal?: AbortSignal): Promise<Forecasts> {
  const body = await fetchJson('/api/previsions', signal)
  const sites = (body as { sites?: unknown })?.sites
  if (typeof sites !== 'object' || sites === null) {
    throw new Error('Forme de réponse non reconnue')
  }

  const bySite: Record<string, SeriesPoint[]> = {}
  for (const [siteId, raw] of Object.entries(sites)) {
    bySite[siteId] = toSeries(raw)
  }

  // La somme du parc n'additionne que les sites qui ont une prévision : un site
  // que le modèle n'a pas traité ne compte pas pour zéro.
  return { park: sumBySite(bySite, 'forecastKw'), bySite }
}

import { fetchJson } from '../api/client'
import { toIsoUtc } from './format'
import type { DetailsBySite, SiteDetail } from './model'

type RawEntry = { data?: unknown; fetched_at?: unknown; stale?: unknown }

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toReasons(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function toDetail(entry: RawEntry): SiteDetail | null {
  const data = entry?.data
  if (typeof data !== 'object' || data === null) return null
  const fields = data as Record<string, unknown>

  // L'API source date sans fuseau alors qu'il s'agit d'UTC, comme /stats/summary.
  const raw = fields.timestamp
  const at = typeof raw === 'string' ? toIsoUtc(raw) : null

  return {
    at,
    stale: entry.stale === true,
    dataQuality: typeof fields.data_quality === 'string' ? fields.data_quality : null,
    nullReasons: toReasons(fields.null_reasons),
    voltageV: toNumber(fields.voltage_v),
    currentA: toNumber(fields.current_a),
    powerFactor: toNumber(fields.power_factor),
    temperatureC: toNumber(fields.temperature_celsius),
    humidityPct: toNumber(fields.humidity_percent),
  }
}

export async function loadDetails(signal?: AbortSignal): Promise<DetailsBySite> {
  const body = await fetchJson('/api/consommations/sites', signal)
  const sites = (body as { sites?: unknown })?.sites
  if (typeof sites !== 'object' || sites === null) {
    throw new Error('Forme de réponse non reconnue')
  }

  const bySite: DetailsBySite = {}
  for (const [siteId, entry] of Object.entries(sites)) {
    const detail = toDetail(entry as RawEntry)
    if (detail) bySite[siteId] = detail
  }
  return bySite
}

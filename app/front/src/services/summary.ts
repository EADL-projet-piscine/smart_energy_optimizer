import { fetchJson } from '../api/client'
import type { ParkSummary } from './model'
import { normalizeSummary } from './normalize'

/** L'API métier renvoie `{ data, fetched_at, stale }` ; on ne garde que `data`. */
function unwrap(envelope: unknown): unknown {
  return typeof envelope === 'object' && envelope !== null && 'data' in envelope
    ? (envelope as { data: unknown }).data
    : envelope
}

export async function loadSummary(signal?: AbortSignal): Promise<ParkSummary> {
  const summary = normalizeSummary(unwrap(await fetchJson('/api/consommation/resume', signal)))
  if (!summary) throw new Error('Forme de réponse non reconnue')
  return summary
}

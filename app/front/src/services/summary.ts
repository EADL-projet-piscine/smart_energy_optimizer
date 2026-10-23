import { fetchJson } from '../api/client'
import type { ParkSummary } from './model'
import { normalizeSummary } from './normalize'

export type SummaryResponse = {
  summary: ParkSummary
  /** Heure annoncée de la prochaine mesure, pour que le client s'y cale. */
  nextAt: string | null
}

/** Enveloppe renvoyée par l'API métier autour de la mesure. */
type Envelope = { data?: unknown; next_at?: unknown }

export async function loadSummary(signal?: AbortSignal): Promise<SummaryResponse> {
  const body = (await fetchJson('/api/consommations', signal)) as Envelope
  const summary = normalizeSummary(body?.data ?? body)
  if (!summary) throw new Error('Forme de réponse non reconnue')

  return {
    summary,
    nextAt: typeof body?.next_at === 'string' ? body.next_at : null,
  }
}

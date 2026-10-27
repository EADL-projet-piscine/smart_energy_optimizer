import { fetchJson } from '../api/client'
import type { ParkSummary } from './model'
import { attachCapacityAlerts, attachLastReadings, normalizeSummary } from './normalize'

export type SummaryResponse = {
  summary: ParkSummary
  /** Heure annoncée de la prochaine mesure, pour que le client s'y cale. */
  nextAt: string | null
}

/** Enveloppe renvoyée par l'API métier autour de la mesure. */
type Envelope = { data?: unknown; next_at?: unknown; last_readings?: unknown; alertes?: unknown }

export async function loadSummary(signal?: AbortSignal): Promise<SummaryResponse> {
  const body = (await fetchJson('/api/consommations', signal)) as Envelope
  const summary = normalizeSummary(body?.data ?? body)
  if (!summary) throw new Error('Forme de réponse non reconnue')

  // Les dernières mesures connues et les alertes de capacité voyagent dans
  // l'enveloppe, pas dans le résumé : elles s'attachent après la normalisation.
  const withReadings = attachLastReadings(summary, body?.last_readings)

  return {
    summary: attachCapacityAlerts(withReadings, body?.alertes),
    nextAt: typeof body?.next_at === 'string' ? body.next_at : null,
  }
}

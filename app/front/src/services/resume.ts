import { obtenirJson } from '../api/client'
import type { ResumeParc } from './modele'
import { normaliserResume } from './normaliser'

function deballer(enveloppe: unknown): unknown {
  return typeof enveloppe === 'object' && enveloppe !== null && 'data' in enveloppe
    ? (enveloppe as { data: unknown }).data
    : enveloppe
}

export async function chargerResume(signal?: AbortSignal): Promise<ResumeParc> {
  const resume = normaliserResume(deballer(await obtenirJson('/api/consommation/resume', signal)))
  if (!resume) throw new Error('Forme de réponse non reconnue')
  return resume
}

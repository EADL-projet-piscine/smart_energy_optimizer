import { obtenirJson } from '../api/client'
import type { ResumeParc } from './modele'
import { normaliserResume } from './normaliser'

export async function chargerResume(signal?: AbortSignal): Promise<ResumeParc> {
  const corps = await obtenirJson('/api/v1/stats/summary', signal)
  const resume = normaliserResume(corps)
  if (!resume) throw new Error('Forme de réponse non reconnue')
  return resume
}

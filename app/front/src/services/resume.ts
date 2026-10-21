import { obtenirJson } from '../api/client'
import type { ResumeParc } from './modele'
import { normaliserResume } from './normaliser'

function deballer(enveloppe: unknown): unknown {
  return typeof enveloppe === 'object' && enveloppe !== null && 'data' in enveloppe
    ? (enveloppe as { data: unknown }).data
    : enveloppe
}

function construire(enveloppe: unknown): ResumeParc {
  const resume = normaliserResume(deballer(enveloppe))
  if (!resume) throw new Error('Forme de réponse non reconnue')
  return resume
}

export async function chargerResume(signal?: AbortSignal): Promise<ResumeParc> {
  return construire(await obtenirJson('/api/consommation/resume', signal))
}

export async function rafraichirResume(signal?: AbortSignal): Promise<ResumeParc> {
  return construire(
    await obtenirJson('/api/consommation/resume/rafraichir', signal, 'POST'),
  )
}

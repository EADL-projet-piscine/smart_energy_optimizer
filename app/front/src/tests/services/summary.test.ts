import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'
import { loadSummary } from '../../services/summary'

vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }))

const SUMMARY = {
  total_consumption_kw: 412.5,
  sites: [{ site_id: 'SITE001', current_consumption_kw: 412.5 }],
}

beforeEach(() => {
  vi.mocked(fetchJson).mockReset()
})

describe('loadSummary', () => {
  it('interroge la route résumé du back et déballe son enveloppe', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      data: SUMMARY,
      fetched_at: '2026-10-21T09:35:00+00:00',
      next_at: '2026-10-21T09:36:00+00:00',
    })
    const signal = new AbortController().signal

    const { summary, nextAt } = await loadSummary(signal)

    expect(fetchJson).toHaveBeenCalledWith('/api/consommations', signal)
    expect(summary).toMatchObject({ siteCount: 1, consumptionKw: 412.5 })
    expect(nextAt).toBe('2026-10-21T09:36:00+00:00')
  })

  it('rend null comme prochaine mesure quand le serveur ne l’annonce pas', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ data: SUMMARY })

    await expect(loadSummary()).resolves.toMatchObject({ nextAt: null })
  })

  it('ignore une prochaine mesure qui n’est pas une chaîne', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ data: SUMMARY, next_at: 1761037200 })

    await expect(loadSummary()).resolves.toMatchObject({ nextAt: null })
  })

  it('accepte un résumé envoyé sans enveloppe', async () => {
    vi.mocked(fetchJson).mockResolvedValue(SUMMARY)

    await expect(loadSummary()).resolves.toMatchObject({
      summary: { consumptionKw: 412.5 },
      nextAt: null,
    })
  })

  it.each([null, 'inattendu', { data: { inattendu: true } }])(
    'refuse une réponse qu’il ne sait pas lire : %j',
    async (body) => {
      vi.mocked(fetchJson).mockResolvedValue(body)

      await expect(loadSummary()).rejects.toThrow('Forme de réponse non reconnue')
    },
  )

  it('laisse remonter l’échec de l’appel réseau', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('Statut 503'))

    await expect(loadSummary()).rejects.toThrow('Statut 503')
  })
})

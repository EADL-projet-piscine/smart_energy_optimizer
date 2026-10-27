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
  it('queries the back end summary route and unwraps its envelope', async () => {
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

  it('returns null as the next reading when the server does not announce one', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ data: SUMMARY })

    await expect(loadSummary()).resolves.toMatchObject({ nextAt: null })
  })

  it('ignores a next reading that is not a string', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ data: SUMMARY, next_at: 1761037200 })

    await expect(loadSummary()).resolves.toMatchObject({ nextAt: null })
  })

  it('accepts a summary sent without an envelope', async () => {
    vi.mocked(fetchJson).mockResolvedValue(SUMMARY)

    await expect(loadSummary()).resolves.toMatchObject({
      summary: { consumptionKw: 412.5 },
      nextAt: null,
    })
  })

  it.each([null, 'unexpected', { data: { unexpected: true } }])(
    'rejects a response it cannot read: %j',
    async (body) => {
      vi.mocked(fetchJson).mockResolvedValue(body)

      await expect(loadSummary()).rejects.toThrow('Forme de réponse non reconnue')
    },
  )

  it('lets a network failure bubble up', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('Statut 503'))

    await expect(loadSummary()).rejects.toThrow('Statut 503')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'
import { appendCurrent, loadHistory } from '../../services/history'
import type { SeriesPoint } from '../../services/model'

vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }))

const reponse = {
  start: '2026-10-21T10:00:00+00:00',
  end: '2026-10-22T10:00:00+00:00',
  sites: {
    SITE001: [
      { timestamp: '2026-10-21T11:00:00Z', consumption_kw: null, data_quality: 'critical' },
      { timestamp: '2026-10-21T10:00:00Z', consumption_kw: 10, data_quality: 'good' },
    ],
    SITE002: [
      { timestamp: '2026-10-21T10:00:00Z', consumption_kw: 20, data_quality: 'good' },
      { timestamp: '2026-10-21T11:00:00Z', consumption_kw: 25, data_quality: 'partial' },
    ],
  },
}

beforeEach(() => {
  vi.mocked(fetchJson).mockResolvedValue(reponse)
})

describe('loadHistory', () => {
  it('groupe les points par site', async () => {
    const { bySite } = await loadHistory()

    expect(Object.keys(bySite).sort()).toEqual(['SITE001', 'SITE002'])
    expect(bySite.SITE001).toHaveLength(2)
  })

  it('trie chaque site dans le temps', async () => {
    const { bySite } = await loadHistory()

    expect(bySite.SITE001.map((point) => point.at)).toEqual([
      '2026-10-21T10:00:00Z',
      '2026-10-21T11:00:00Z',
    ])
  })

  it('garde les mesures absentes à null', async () => {
    // Zéro serait une mesure ; l'absence de mesure n'en est pas une.
    const { bySite } = await loadHistory()

    expect(bySite.SITE001[1].measuredKw).toBeNull()
  })

  it('somme les sites à horodatage égal', async () => {
    const { park } = await loadHistory()

    expect(park[0]).toEqual({ at: '2026-10-21T10:00:00Z', measuredKw: 30, forecastKw: null })
  })

  it('ne compte pas un site absent comme un zéro', async () => {
    // À 11h, SITE001 n'a pas de mesure : le total ne doit valoir que SITE002.
    const { park } = await loadHistory()

    expect(park[1].measuredKw).toBe(25)
  })

  it('rejette une réponse sans sites', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ autre: 'chose' })

    await expect(loadHistory()).rejects.toThrow('Forme de réponse non reconnue')
  })
})

describe('appendCurrent', () => {
  const serie: SeriesPoint[] = [
    { at: '2026-10-22T10:00:00Z', measuredKw: 100, forecastKw: null },
    { at: '2026-10-22T11:00:00Z', measuredKw: 110, forecastKw: null },
  ]

  it('prolonge la série jusqu’à la mesure courante', () => {
    const result = appendCurrent(serie, 120, '2026-10-22T11:45:00Z')

    expect(result).toHaveLength(3)
    expect(result[2]).toEqual({ at: '2026-10-22T11:45:00Z', measuredKw: 120, forecastKw: null })
  })

  it('date la mesure courante en UTC même sans fuseau', () => {
    const result = appendCurrent(serie, 120, '2026-10-22T11:45:00')

    expect(result[2].at).toBe('2026-10-22T11:45:00Z')
  })

  it('n’ajoute rien si la mesure n’est pas plus récente', () => {
    expect(appendCurrent(serie, 120, '2026-10-22T10:30:00Z')).toBe(serie)
  })

  it('n’ajoute rien sans mesure', () => {
    expect(appendCurrent(serie, null, '2026-10-22T11:45:00Z')).toBe(serie)
  })

  it('n’ajoute rien sans horodatage', () => {
    expect(appendCurrent(serie, 120, undefined)).toBe(serie)
  })

  it('fonctionne sur une série vide', () => {
    expect(appendCurrent([], 120, '2026-10-22T11:45:00Z')).toHaveLength(1)
  })
})

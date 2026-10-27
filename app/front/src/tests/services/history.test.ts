import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'
import { appendCurrent, loadHistory } from '../../services/history'
import type { SeriesPoint } from '../../services/model'

vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }))

const RESPONSE = {
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
  vi.mocked(fetchJson).mockResolvedValue(RESPONSE)
})

describe('loadHistory', () => {
  it('groups the points by site', async () => {
    const { bySite } = await loadHistory()

    expect(Object.keys(bySite).sort()).toEqual(['SITE001', 'SITE002'])
    expect(bySite.SITE001).toHaveLength(2)
  })

  it('sorts each site chronologically', async () => {
    const { bySite } = await loadHistory()

    expect(bySite.SITE001.map((point) => point.at)).toEqual(['2026-10-21T10:00:00Z', '2026-10-21T11:00:00Z'])
  })

  it('keeps missing readings at null', async () => {
    // Zero would be a measurement; the absence of a measurement is not.
    const { bySite } = await loadHistory()

    expect(bySite.SITE001[1].measuredKw).toBeNull()
  })

  it('sums sites sharing a timestamp', async () => {
    const { park } = await loadHistory()

    expect(park[0]).toEqual({ at: '2026-10-21T10:00:00Z', measuredKw: 30, forecastKw: null })
  })

  it('does not count a missing site as a zero', async () => {
    // At 11:00 SITE001 has no reading: the total must be SITE002 alone.
    const { park } = await loadHistory()

    expect(park[1].measuredKw).toBe(25)
  })

  it('rejects a response without sites', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ something: 'else' })

    await expect(loadHistory()).rejects.toThrow('Forme de réponse non reconnue')
  })
})

describe('appendCurrent', () => {
  const series: SeriesPoint[] = [
    { at: '2026-10-22T10:00:00Z', measuredKw: 100, forecastKw: null },
    { at: '2026-10-22T11:00:00Z', measuredKw: 110, forecastKw: null },
  ]

  it('extends the series up to the current reading', () => {
    const result = appendCurrent(series, 120, '2026-10-22T11:45:00Z')

    expect(result).toHaveLength(3)
    expect(result[2]).toEqual({ at: '2026-10-22T11:45:00Z', measuredKw: 120, forecastKw: null })
  })

  it('dates the current reading as UTC even without a timezone', () => {
    const result = appendCurrent(series, 120, '2026-10-22T11:45:00')

    expect(result[2].at).toBe('2026-10-22T11:45:00Z')
  })

  it('adds nothing when the reading is not more recent', () => {
    expect(appendCurrent(series, 120, '2026-10-22T10:30:00Z')).toBe(series)
  })

  it('adds nothing without a reading', () => {
    expect(appendCurrent(series, null, '2026-10-22T11:45:00Z')).toBe(series)
  })

  it('adds nothing without a timestamp', () => {
    expect(appendCurrent(series, 120, undefined)).toBe(series)
  })

  it('works on an empty series', () => {
    expect(appendCurrent([], 120, '2026-10-22T11:45:00Z')).toHaveLength(1)
  })
})

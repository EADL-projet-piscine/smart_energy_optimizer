import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'
import { loadForecasts } from '../../services/forecasts'

vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }))

const RESPONSE = {
  generated_at: '2026-10-27T13:20:27+00:00',
  horizon_hours: 24,
  sites: {
    SITE001: [
      {
        timestamp: '2026-10-27T15:00:00+00:00',
        predicted_kw: 144.058,
        horizon: 3,
        forecast_origin: '2026-10-27T12:00:00+00:00',
      },
      {
        timestamp: '2026-10-27T14:00:00+00:00',
        predicted_kw: 148.496,
        horizon: 2,
        forecast_origin: '2026-10-27T12:00:00+00:00',
      },
    ],
    SITE002: [
      {
        timestamp: '2026-10-27T14:00:00+00:00',
        predicted_kw: 500,
        horizon: 2,
        forecast_origin: '2026-10-27T12:00:00+00:00',
      },
    ],
  },
}

beforeEach(() => {
  vi.mocked(fetchJson).mockResolvedValue(RESPONSE)
})

describe('loadForecasts', () => {
  it('queries the forecast route', async () => {
    const signal = new AbortController().signal

    await loadForecasts(signal)

    expect(fetchJson).toHaveBeenCalledWith('/api/previsions', signal)
  })

  it('groups the points by site', async () => {
    const { bySite } = await loadForecasts()

    expect(Object.keys(bySite).sort()).toEqual(['SITE001', 'SITE002'])
    expect(bySite.SITE001).toHaveLength(2)
  })

  it('files the value as a forecast, never as a measurement', async () => {
    const { bySite } = await loadForecasts()

    expect(bySite.SITE001[0]).toEqual({
      at: '2026-10-27T14:00:00+00:00',
      measuredKw: null,
      forecastKw: 148.496,
    })
  })

  it('sorts each site chronologically', async () => {
    const { bySite } = await loadForecasts()

    expect(bySite.SITE001.map((point) => point.at)).toEqual([
      '2026-10-27T14:00:00+00:00',
      '2026-10-27T15:00:00+00:00',
    ])
  })

  it('sums the sites sharing a slot', async () => {
    const { park } = await loadForecasts()

    expect(park[0]).toEqual({
      at: '2026-10-27T14:00:00+00:00',
      measuredKw: null,
      forecastKw: 648.496,
    })
  })

  it('reads a bare timestamp as UTC', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      sites: { SITE001: [{ timestamp: '2026-10-27T14:00:00', predicted_kw: 100 }] },
    })

    const { bySite } = await loadForecasts()

    expect(bySite.SITE001[0].at).toBe('2026-10-27T14:00:00Z')
  })

  it('discards a point without a usable value', async () => {
    // A forecast with no figure is not a forecast: drawing it at zero would
    // invent a drop in consumption.
    vi.mocked(fetchJson).mockResolvedValue({
      sites: {
        SITE001: [
          { timestamp: '2026-10-27T14:00:00Z', predicted_kw: null },
          { timestamp: '2026-10-27T15:00:00Z', predicted_kw: 'beaucoup' },
          { timestamp: '2026-10-27T16:00:00Z', predicted_kw: 120 },
        ],
      },
    })

    const { bySite } = await loadForecasts()

    expect(bySite.SITE001).toHaveLength(1)
    expect(bySite.SITE001[0].forecastKw).toBe(120)
  })

  it('discards a point without a readable timestamp', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      sites: { SITE001: [{ timestamp: 'pas une date', predicted_kw: 120 }, 42, null] },
    })

    const { bySite } = await loadForecasts()

    expect(bySite.SITE001).toEqual([])
  })

  it('accepts a site without any forecast', async () => {
    // The model may not have run for it: an empty list, not an error.
    vi.mocked(fetchJson).mockResolvedValue({ sites: { SITE001: [] } })

    const { bySite, park } = await loadForecasts()

    expect(bySite.SITE001).toEqual([])
    expect(park).toEqual([])
  })

  it.each([null, 'unexpected', 42, {}])('rejects a response it cannot read: %j', async (body) => {
    vi.mocked(fetchJson).mockResolvedValue(body)

    await expect(loadForecasts()).rejects.toThrow('Forme de réponse non reconnue')
  })

  it('lets a network failure bubble up', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('Statut 503'))

    await expect(loadForecasts()).rejects.toThrow('Statut 503')
  })
})

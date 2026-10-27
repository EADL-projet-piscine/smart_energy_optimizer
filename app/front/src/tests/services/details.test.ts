import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'
import { loadDetails } from '../../services/details'

vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }))

/** Typical endpoint response, with a single site. */
function envelope(data: Record<string, unknown>, stale = false) {
  return {
    sites: {
      SITE001: { data, fetched_at: '2026-10-25T13:15:16+00:00', stale },
    },
  }
}

const READING = {
  timestamp: '2026-10-25T13:15:16.361330',
  site_id: 'SITE001',
  site_type: 'office',
  consumption_kw: 165.22,
  voltage_v: 405.8,
  current_a: 247.43,
  power_factor: 0.909,
  temperature_celsius: 7.8,
  humidity_percent: 39.3,
  null_reasons: [],
  data_quality: 'good',
}

beforeEach(() => {
  vi.mocked(fetchJson).mockReset()
})

describe('loadDetails', () => {
  it('queries the site detail route', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope(READING))
    const signal = new AbortController().signal

    await loadDetails(signal)

    expect(fetchJson).toHaveBeenCalledWith('/api/consommations/sites', signal)
  })

  it('normalises each site readings', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope(READING))

    const details = await loadDetails()

    expect(details.SITE001).toMatchObject({
      dataQuality: 'good',
      voltageV: 405.8,
      currentA: 247.43,
      powerFactor: 0.909,
      temperatureC: 7.8,
      humidityPct: 39.3,
      stale: false,
    })
  })

  it('reads a bare timestamp as UTC', async () => {
    // The source dates without a timezone even though it means UTC, like
    // /stats/summary. Without the fix, the browser reads it as local time.
    vi.mocked(fetchJson).mockResolvedValue(envelope(READING))

    const details = await loadDetails()

    expect(details.SITE001.at).toBe('2026-10-25T13:15:16.361330Z')
  })

  it('keeps a timestamp that already carries its timezone', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope({ ...READING, timestamp: '2026-10-25T13:15:16Z' }))

    const details = await loadDetails()

    expect(details.SITE001.at).toBe('2026-10-25T13:15:16Z')
  })

  it('relays the reasons why a reading is missing', async () => {
    // This is what the endpoint is for: the summary says a reading is missing,
    // only this one says why.
    vi.mocked(fetchJson).mockResolvedValue(
      envelope({
        ...READING,
        data_quality: 'degraded',
        null_reasons: ['voltage_sensor_failure', 'humidity_sensor_mute'],
      }),
    )

    const details = await loadDetails()

    expect(details.SITE001.dataQuality).toBe('degraded')
    expect(details.SITE001.nullReasons).toEqual(['voltage_sensor_failure', 'humidity_sensor_mute'])
  })

  it('ignores reasons that are not strings', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope({ ...READING, null_reasons: ['network', 42, null] }))

    const details = await loadDetails()

    expect(details.SITE001.nullReasons).toEqual(['network'])
  })

  it('returns an empty list when the reasons are not an array', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope({ ...READING, null_reasons: 'network' }))

    const details = await loadDetails()

    expect(details.SITE001.nullReasons).toEqual([])
  })

  it('leaves a missing reading at null rather than zero', async () => {
    // Zero volts is a measurement; the absence of a measurement is not.
    vi.mocked(fetchJson).mockResolvedValue(
      envelope({ ...READING, voltage_v: null, power_factor: 'NaN', temperature_celsius: undefined }),
    )

    const details = await loadDetails()

    expect(details.SITE001.voltageV).toBeNull()
    expect(details.SITE001.powerFactor).toBeNull()
    expect(details.SITE001.temperatureC).toBeNull()
  })

  it('keeps a real zero', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope({ ...READING, current_a: 0 }))

    const details = await loadDetails()

    expect(details.SITE001.currentA).toBe(0)
  })

  it('flags a stale reading', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope(READING, true))

    const details = await loadDetails()

    expect(details.SITE001.stale).toBe(true)
  })

  it('leaves an unknown quality as is', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope({ ...READING, data_quality: 42 }))

    const details = await loadDetails()

    expect(details.SITE001.dataQuality).toBeNull()
  })

  it('sets aside a site with no usable reading', async () => {
    // A site failing server-side must not bring the others down.
    vi.mocked(fetchJson).mockResolvedValue({
      sites: {
        SITE001: { data: READING, stale: false },
        SITE002: { data: null, stale: true },
      },
    })

    const details = await loadDetails()

    expect(Object.keys(details)).toEqual(['SITE001'])
  })

  it('leaves an unreadable timestamp at null', async () => {
    vi.mocked(fetchJson).mockResolvedValue(envelope({ ...READING, timestamp: 42 }))

    const details = await loadDetails()

    expect(details.SITE001.at).toBeNull()
  })

  it.each([null, 'unexpected', { data: [] }])('rejects a response it cannot read: %j', async (body) => {
    vi.mocked(fetchJson).mockResolvedValue(body)

    await expect(loadDetails()).rejects.toThrow('Forme de réponse non reconnue')
  })

  it('lets a network failure bubble up', async () => {
    // No silent fallback: the caller must know that nothing arrived.
    vi.mocked(fetchJson).mockRejectedValue(new Error('Statut 503'))

    await expect(loadDetails()).rejects.toThrow('Statut 503')
  })
})

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDetails } from '../../services/details'
import type { ParkSummary, Site } from '../../services/model'
import { loadSummary } from '../../services/summary'
import { useSummary } from '../../services/useSummary'

vi.mock('../../services/summary', () => ({ loadSummary: vi.fn() }))
vi.mock('../../services/details', () => ({ loadDetails: vi.fn() }))

function site(id: string, critical = false): Site {
  return {
    id,
    name: id,
    type: 'Bureau',
    readingLabel: 'relevé horaire',
    currentKw: 100,
    forecast2hKw: null,
    thresholdKw: null,
    receivedCount: null,
    expectedCount: null,
    isTransmitting: true,
    badge: null,
    series: [],
    peakAt: null,
    comment: null,
    alerts: critical ? [{ id: `${id}-a`, severity: 'critique', title: 'Urgent', message: 'message' }] : [],
    recommendations: [],
  }
}

function summary(sites: Site[] = [site('SITE001')]): ParkSummary {
  return {
    siteCount: sites.length,
    lastCollectedAt: '2026-10-25T13:00:00Z',
    consumptionKw: 2847,
    changePct: null,
    coveragePct: null,
    transmittingCount: sites.length,
    totalAlerts: 0,
    criticalAlerts: 0,
    mediumAlerts: 0,
    dailyCostEur: null,
    co2Tons: null,
    excludedSites: [],
    thresholdKw: null,
    peakKw: null,
    peakAt: null,
    series: [],
    comment: null,
    sites,
    source: 'api',
  }
}

/** ISO timestamp `seconds` from now, as the server announces it in next_at. */
function inSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

beforeEach(() => {
  // shouldAdvanceTime lets promises settle while time is simulated: without
  // it, waitFor would wait forever.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: null })
  vi.mocked(loadDetails).mockResolvedValue({})
})

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(loadSummary).mockReset()
  vi.mocked(loadDetails).mockReset()
})

describe('useSummary', () => {
  it('exposes the summary and the detail it received', async () => {
    vi.mocked(loadDetails).mockResolvedValue({
      SITE001: {
        at: '2026-10-25T13:00:00Z',
        stale: false,
        dataQuality: 'partial',
        nullReasons: [],
        voltageV: 405.8,
        currentA: null,
        powerFactor: null,
        temperatureC: null,
        humidityPct: null,
      },
    })

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.summary).not.toBeNull())
    expect(result.current.details.SITE001.dataQuality).toBe('partial')
    expect(result.current.error).toBeNull()
  })

  it('loads both within the same cycle', async () => {
    // Both endpoints describe the same instant of the fleet: separating them
    // would reopen a one-cycle gap between a figure and its explanation.
    renderHook(() => useSummary())

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))
    expect(loadDetails).toHaveBeenCalledTimes(1)
  })

  it('keeps the summary when the detail fails', async () => {
    // The detail is a complement: its absence must not empty the screen.
    vi.mocked(loadDetails).mockRejectedValue(new Error('Statut 503'))

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.summary).not.toBeNull())
    expect(result.current.details).toEqual({})
    expect(result.current.error).toBeNull()
  })

  it('reports the error when the summary fails', async () => {
    vi.mocked(loadSummary).mockRejectedValue(new Error('Statut 503'))

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.error).toBe('Statut 503'))
    expect(result.current.summary).toBeNull()
  })

  it('gives a generic message on an error without one', async () => {
    vi.mocked(loadSummary).mockRejectedValue('failure')

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.error).toBe('API injoignable'))
  })

  it('reports an error raised during processing', async () => {
    // A response outside the contract makes the processing throw, not the
    // network. allSettled never rejects: without the catch, that rejection
    // would be swallowed and the screen would stay silent.
    vi.mocked(loadSummary).mockResolvedValue(
      null as unknown as { summary: ParkSummary; nextAt: string | null },
    )

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.summary).toBeNull()
  })

  it('selects the most critical site on first load', async () => {
    vi.mocked(loadSummary).mockResolvedValue({
      summary: summary([site('SITE001'), site('SITE002', true)]),
      nextAt: null,
    })

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.siteId).toBe('SITE002'))
  })

  it('falls back to the first site when none is critical', async () => {
    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.siteId).toBe('SITE001'))
  })

  it('keeps the selected site as long as it exists', async () => {
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: inSeconds(10) })

    const { result } = renderHook(() => useSummary())
    await waitFor(() => expect(result.current.siteId).toBe('SITE001'))

    await vi.advanceTimersByTimeAsync(13_000)

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
    expect(result.current.siteId).toBe('SITE001')
  })

  it('paces itself on the time announced by the server', async () => {
    // The server says when its next reading lands: the client asks right
    // after, instead of polling blindly.
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: inSeconds(10) })

    renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(8_000)
    expect(loadSummary).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('falls back to one minute when the server announces nothing', async () => {
    renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(61_000)

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('honours a minimum delay when the announced time has already passed', async () => {
    // A safeguard against a burst of calls if the clocks drift apart.
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: inSeconds(-300) })

    renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3_000)
    expect(loadSummary).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3_000)
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('falls back to one minute when the announced time is unreadable', async () => {
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: 'not a date' })

    renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(61_000)

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('retries after a failure', async () => {
    vi.mocked(loadSummary).mockRejectedValue(new Error('Statut 503'))

    const { result } = renderHook(() => useSummary())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    await vi.advanceTimersByTimeAsync(61_000)

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('calls nothing more after unmount', async () => {
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: inSeconds(10) })

    const { unmount } = renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(loadSummary).toHaveBeenCalledTimes(1)
  })
})

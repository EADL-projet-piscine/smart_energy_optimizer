import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadForecasts } from '../../services/forecasts'
import type { Forecasts } from '../../services/model'
import { useForecasts } from '../../services/useForecasts'

vi.mock('../../services/forecasts', () => ({ loadForecasts: vi.fn() }))

const FORECASTS: Forecasts = {
  park: [{ at: '2026-10-27T14:00:00Z', measuredKw: null, forecastKw: 648.5 }],
  bySite: {
    SITE001: [{ at: '2026-10-27T14:00:00Z', measuredKw: null, forecastKw: 148.5 }],
  },
}

/** Same cadence as the history: five minutes, in milliseconds. */
const REFRESH_MS = 300_000

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.mocked(loadForecasts).mockResolvedValue(FORECASTS)
})

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(loadForecasts).mockReset()
})

describe('useForecasts', () => {
  it('exposes the forecasts it received', async () => {
    const { result } = renderHook(() => useForecasts())

    await waitFor(() => expect(result.current.forecasts).toEqual(FORECASTS))
    expect(result.current.error).toBeNull()
  })

  it('reports an error without inventing a curve', async () => {
    vi.mocked(loadForecasts).mockRejectedValue(new Error('Statut 503'))

    const { result } = renderHook(() => useForecasts())

    await waitFor(() => expect(result.current.error).toBe('Statut 503'))
    expect(result.current.forecasts).toBeNull()
  })

  it('gives a generic message on an error without one', async () => {
    vi.mocked(loadForecasts).mockRejectedValue('failure')

    const { result } = renderHook(() => useForecasts())

    await waitFor(() => expect(result.current.error).toBe('Prévisions indisponibles'))
  })

  it('refreshes every five minutes', async () => {
    renderHook(() => useForecasts())
    await waitFor(() => expect(loadForecasts).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(REFRESH_MS)

    await waitFor(() => expect(loadForecasts).toHaveBeenCalledTimes(2))
  })

  it('does not refresh before it is due', async () => {
    // Same cadence as the history: a faster one would show a forecast more
    // recent than the measurement it extends.
    renderHook(() => useForecasts())
    await waitFor(() => expect(loadForecasts).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1_000)

    expect(loadForecasts).toHaveBeenCalledTimes(1)
  })

  it('forgets a past error once the next call succeeds', async () => {
    vi.mocked(loadForecasts).mockRejectedValueOnce(new Error('Statut 503'))

    const { result } = renderHook(() => useForecasts())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    await vi.advanceTimersByTimeAsync(REFRESH_MS)

    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.forecasts).toEqual(FORECASTS)
  })

  it('calls nothing more after unmount', async () => {
    const { unmount } = renderHook(() => useForecasts())
    await waitFor(() => expect(loadForecasts).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2)

    expect(loadForecasts).toHaveBeenCalledTimes(1)
  })
})

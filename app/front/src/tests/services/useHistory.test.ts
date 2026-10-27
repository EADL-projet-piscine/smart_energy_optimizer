import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHistory } from '../../services/history'
import type { History } from '../../services/model'
import { useHistory } from '../../services/useHistory'

vi.mock('../../services/history', () => ({ loadHistory: vi.fn() }))

const HISTORY: History = {
  park: [{ at: '2026-10-25T12:00:00Z', measuredKw: 2847, forecastKw: null }],
  bySite: {
    SITE001: [{ at: '2026-10-25T12:00:00Z', measuredKw: 165, forecastKw: null }],
  },
}

/** History cadence, in milliseconds. The source steps hourly, so refreshing
 * more often would show nothing new. */
const REFRESH_MS = 300_000

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.mocked(loadHistory).mockResolvedValue(HISTORY)
})

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(loadHistory).mockReset()
})

describe('useHistory', () => {
  it('exposes the history it received', async () => {
    const { result } = renderHook(() => useHistory())

    await waitFor(() => expect(result.current.history).toEqual(HISTORY))
    expect(result.current.error).toBeNull()
  })

  it('reports an error without inventing a curve', async () => {
    // An empty chart is honest, a reconstructed one is not.
    vi.mocked(loadHistory).mockRejectedValue(new Error('Statut 502'))

    const { result } = renderHook(() => useHistory())

    await waitFor(() => expect(result.current.error).toBe('Statut 502'))
    expect(result.current.history).toBeNull()
  })

  it('gives a generic message on an error without one', async () => {
    vi.mocked(loadHistory).mockRejectedValue('failure')

    const { result } = renderHook(() => useHistory())

    await waitFor(() => expect(result.current.error).toBe('Historique indisponible'))
  })

  it('refreshes every five minutes', async () => {
    renderHook(() => useHistory())
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(REFRESH_MS)

    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2))
  })

  it('does not refresh before it is due', async () => {
    renderHook(() => useHistory())
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1_000)

    expect(loadHistory).toHaveBeenCalledTimes(1)
  })

  it('forgets a past error once the next call succeeds', async () => {
    vi.mocked(loadHistory).mockRejectedValueOnce(new Error('Statut 502'))

    const { result } = renderHook(() => useHistory())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    await vi.advanceTimersByTimeAsync(REFRESH_MS)

    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.history).toEqual(HISTORY)
  })

  it('calls nothing more after unmount', async () => {
    const { unmount } = renderHook(() => useHistory())
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2)

    expect(loadHistory).toHaveBeenCalledTimes(1)
  })
})

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

/** Cadence de l'historique, en millisecondes. Le pas de la source étant
 * horaire, rafraîchir plus souvent ne montrerait rien de neuf. */
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
  it('expose l’historique reçu', async () => {
    const { result } = renderHook(() => useHistory())

    await waitFor(() => expect(result.current.history).toEqual(HISTORY))
    expect(result.current.error).toBeNull()
  })

  it('signale une erreur sans inventer de courbe', async () => {
    // Un graphique vide est honnête, un graphique reconstitué ne l'est pas.
    vi.mocked(loadHistory).mockRejectedValue(new Error('Statut 502'))

    const { result } = renderHook(() => useHistory())

    await waitFor(() => expect(result.current.error).toBe('Statut 502'))
    expect(result.current.history).toBeNull()
  })

  it('donne un message générique sur une erreur sans message', async () => {
    vi.mocked(loadHistory).mockRejectedValue('panne')

    const { result } = renderHook(() => useHistory())

    await waitFor(() => expect(result.current.error).toBe('Historique indisponible'))
  })

  it('rafraîchit toutes les cinq minutes', async () => {
    renderHook(() => useHistory())
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(REFRESH_MS)

    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2))
  })

  it('ne rafraîchit pas avant l’échéance', async () => {
    renderHook(() => useHistory())
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1_000)

    expect(loadHistory).toHaveBeenCalledTimes(1)
  })

  it('oublie une erreur passée quand l’appel suivant réussit', async () => {
    vi.mocked(loadHistory).mockRejectedValueOnce(new Error('Statut 502'))

    const { result } = renderHook(() => useHistory())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    await vi.advanceTimersByTimeAsync(REFRESH_MS)

    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.history).toEqual(HISTORY)
  })

  it('n’appelle plus rien après le démontage', async () => {
    const { unmount } = renderHook(() => useHistory())
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2)

    expect(loadHistory).toHaveBeenCalledTimes(1)
  })
})

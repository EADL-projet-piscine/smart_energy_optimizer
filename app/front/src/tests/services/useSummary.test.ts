import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDetails } from '../../services/details'
import type { ParkSummary, Site } from '../../services/model'
import { loadSummary } from '../../services/summary'
import { useSummary } from '../../services/useSummary'

vi.mock('../../services/summary', () => ({ loadSummary: vi.fn() }))
vi.mock('../../services/details', () => ({ loadDetails: vi.fn() }))

function site(id: string, critique = false): Site {
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
    alerts: critique ? [{ id: `${id}-a`, severity: 'critique', title: 'Urgent', message: 'message' }] : [],
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

/** Horodatage ISO à `seconds` d'ici, comme le serveur l'annonce dans next_at. */
function inSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

beforeEach(() => {
  // shouldAdvanceTime laisse les promesses se résoudre pendant que le temps
  // est simulé : sans lui, waitFor attendrait indéfiniment.
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
  it('expose le résumé et le détail reçus', async () => {
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

  it('charge les deux dans le même cycle', async () => {
    // Les deux endpoints décrivent le même instant du parc : les séparer
    // rouvrirait un décalage d'un cycle entre un chiffre et son explication.
    renderHook(() => useSummary())

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))
    expect(loadDetails).toHaveBeenCalledTimes(1)
  })

  it('garde le résumé quand le détail échoue', async () => {
    // Le détail est un complément : son absence ne doit pas vider l'écran.
    vi.mocked(loadDetails).mockRejectedValue(new Error('Statut 503'))

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.summary).not.toBeNull())
    expect(result.current.details).toEqual({})
    expect(result.current.error).toBeNull()
  })

  it('signale l’erreur quand le résumé échoue', async () => {
    vi.mocked(loadSummary).mockRejectedValue(new Error('Statut 503'))

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.error).toBe('Statut 503'))
    expect(result.current.summary).toBeNull()
  })

  it('donne un message générique sur une erreur sans message', async () => {
    vi.mocked(loadSummary).mockRejectedValue('panne')

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.error).toBe('API injoignable'))
  })

  it('sélectionne le site le plus critique au premier chargement', async () => {
    vi.mocked(loadSummary).mockResolvedValue({
      summary: summary([site('SITE001'), site('SITE002', true)]),
      nextAt: null,
    })

    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.siteId).toBe('SITE002'))
  })

  it('retombe sur le premier site faute de critique', async () => {
    const { result } = renderHook(() => useSummary())

    await waitFor(() => expect(result.current.siteId).toBe('SITE001'))
  })

  it('garde le site sélectionné tant qu’il existe', async () => {
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: inSeconds(10) })

    const { result } = renderHook(() => useSummary())
    await waitFor(() => expect(result.current.siteId).toBe('SITE001'))

    await vi.advanceTimersByTimeAsync(13_000)

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
    expect(result.current.siteId).toBe('SITE001')
  })

  it('se cale sur l’heure annoncée par le serveur', async () => {
    // Le serveur dit quand sa prochaine mesure arrive : le client la demande
    // juste après, au lieu de sonder à l'aveugle.
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: inSeconds(10) })

    renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(8_000)
    expect(loadSummary).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('retombe sur une minute quand le serveur n’annonce rien', async () => {
    renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(61_000)

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('respecte un délai minimum quand l’heure annoncée est déjà passée', async () => {
    // Garde-fou contre une rafale d'appels si les horloges divergent.
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: inSeconds(-300) })

    renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3_000)
    expect(loadSummary).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3_000)
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('retombe sur une minute quand l’heure annoncée est illisible', async () => {
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: 'pas une date' })

    renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(61_000)

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('réessaie après un échec', async () => {
    vi.mocked(loadSummary).mockRejectedValue(new Error('Statut 503'))

    const { result } = renderHook(() => useSummary())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    await vi.advanceTimersByTimeAsync(61_000)

    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('n’appelle plus rien après le démontage', async () => {
    vi.mocked(loadSummary).mockResolvedValue({ summary: summary(), nextAt: inSeconds(10) })

    const { unmount } = renderHook(() => useSummary())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(loadSummary).toHaveBeenCalledTimes(1)
  })
})

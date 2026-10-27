import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../../screens/Dashboard'
import type { DetailsBySite, ParkSummary } from '../../services/model'
import { useHistory } from '../../services/useHistory'
import { useSummary } from '../../services/useSummary'

vi.mock('../../services/useSummary', () => ({ useSummary: vi.fn() }))
vi.mock('../../services/useHistory', () => ({ useHistory: vi.fn() }))

const SUMMARY: ParkSummary = {
  siteCount: 7,
  lastCollectedAt: '2026-10-22T09:00:00Z',
  consumptionKw: 2847,
  changePct: 12,
  coveragePct: 100,
  transmittingCount: 7,
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
  sites: [],
  source: 'api',
}

function mockHooks(summary: ParkSummary | null, error: string | null, details: DetailsBySite = {}) {
  vi.mocked(useSummary).mockReturnValue({
    summary,
    details,
    error,
    loading: false,
    siteId: null,
    setSiteId: vi.fn(),
  })
  vi.mocked(useHistory).mockReturnValue({ history: null, error: null })
}

beforeEach(() => {
  mockHooks(SUMMARY, null)
})

describe('Dashboard', () => {
  it('displays the consumption it received', () => {
    render(<Dashboard />)

    expect(screen.getByText('2 847')).toBeInTheDocument()
  })

  it('announces loading as long as nothing has arrived', () => {
    mockHooks(null, null)

    render(<Dashboard />)

    expect(screen.getByText(/Lecture du résumé/)).toBeInTheDocument()
  })

  it('displays no figure when the API does not answer', () => {
    // Project rule: never invented data. A dashboard that looks like it works
    // while nothing runs behind it is worse than an error.
    mockHooks(null, 'Statut 503')

    render(<Dashboard />)

    expect(screen.getByText(/l’API métier ne répond pas/)).toBeInTheDocument()
    expect(screen.queryByText('2 847')).not.toBeInTheDocument()
  })

  it('reports that the data is no longer being refreshed', () => {
    // The API is down but the last summary stays on screen: it has to be said,
    // otherwise frozen figures pass for current ones.
    mockHooks(SUMMARY, 'Statut 503')

    render(<Dashboard />)

    expect(screen.getByText(/ne sont plus\s+rafraîchies/)).toBeInTheDocument()
    expect(screen.getByText('2 847')).toBeInTheDocument()
  })

  it('warns when the history is unavailable', () => {
    vi.mocked(useHistory).mockReturnValue({ history: null, error: 'Statut 502' })

    render(<Dashboard />)

    expect(screen.getByText(/Historique indisponible/)).toBeInTheDocument()
  })

  it('displays the fleet even without the site details', () => {
    // The detail is a complement: the summary must render without it.
    mockHooks(SUMMARY, null, {})

    render(<Dashboard />)

    expect(screen.getByText('2 847')).toBeInTheDocument()
  })
})

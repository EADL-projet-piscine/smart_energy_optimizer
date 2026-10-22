import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../../screens/Dashboard'
import type { ParkSummary } from '../../services/model'
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

function mockHooks(summary: ParkSummary | null, error: string | null) {
  vi.mocked(useSummary).mockReturnValue({
    summary,
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
  it('affiche la consommation reçue', () => {
    render(<Dashboard />)

    expect(screen.getByText('2 847')).toBeInTheDocument()
  })

  it('annonce le chargement tant que rien n’est arrivé', () => {
    mockHooks(null, null)

    render(<Dashboard />)

    expect(screen.getByText(/Lecture du résumé/)).toBeInTheDocument()
  })

  it('n’affiche aucun chiffre quand l’API ne répond pas', () => {
    // Règle du projet : jamais de données inventées. Un dashboard qui a l'air
    // de fonctionner alors que rien ne tourne derrière est pire qu'une erreur.
    mockHooks(null, 'Statut 503')

    render(<Dashboard />)

    expect(screen.getByText(/l’API métier ne répond pas/)).toBeInTheDocument()
    expect(screen.queryByText('2 847')).not.toBeInTheDocument()
  })

  it('signale que les données ne sont plus rafraîchies', () => {
    // L'API est tombée mais le dernier résumé reste affiché : il faut le dire,
    // sinon des chiffres figés passent pour des chiffres à jour.
    mockHooks(SUMMARY, 'Statut 503')

    render(<Dashboard />)

    expect(screen.getByText(/ne sont plus\s+rafraîchies/)).toBeInTheDocument()
    expect(screen.getByText('2 847')).toBeInTheDocument()
  })

  it('prévient quand l’historique est indisponible', () => {
    vi.mocked(useHistory).mockReturnValue({ history: null, error: 'Statut 502' })

    render(<Dashboard />)

    expect(screen.getByText(/Historique indisponible/)).toBeInTheDocument()
  })
})

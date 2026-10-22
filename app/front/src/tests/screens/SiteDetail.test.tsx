import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SiteDetail } from '../../screens/SiteDetail'
import type { Alert, Site } from '../../services/model'

// Le graphique est du ressort de Recharts : le remplacer isole ce qu'on teste
// et évite les avertissements de dimensions nulles sous jsdom.
vi.mock('../../components/ConsumptionChart', () => ({
  ConsumptionChart: () => <div data-testid="graphique" />,
}))

function alert(severity: Alert['severity'], title: string): Alert {
  return { id: title, severity, title, message: `message de ${title}` }
}

function site(partiel: Partial<Site> = {}): Site {
  return {
    id: 'SITE001',
    name: 'Bureau Paris',
    type: 'Bureau',
    readingLabel: 'relevé horaire',
    currentKw: 100,
    forecast2hKw: null,
    thresholdKw: null,
    receivedCount: 24,
    expectedCount: 24,
    isTransmitting: true,
    badge: null,
    series: [],
    peakAt: null,
    comment: null,
    alerts: [],
    recommendations: [],
    ...partiel,
  }
}

function afficher(sites: Site[], siteId = sites[0]?.id ?? '') {
  const onSelect = vi.fn()
  render(<SiteDetail sites={sites} siteId={siteId} onSelect={onSelect} seriesBySite={{}} />)
  return onSelect
}

describe('SiteDetail', () => {
  it('affiche le site demandé', () => {
    afficher([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'B')

    expect(screen.getByRole('heading', { name: 'Usine Lyon' })).toBeInTheDocument()
  })

  it('retombe sur le premier site quand l’identifiant est inconnu', () => {
    afficher([site({ id: 'A', name: 'Bureau Paris' })], 'INEXISTANT')

    expect(screen.getByRole('heading', { name: 'Bureau Paris' })).toBeInTheDocument()
  })

  it('prévient quand le résumé ne contient aucun site', () => {
    afficher([])

    expect(screen.getByText(/Aucun site n’est disponible/)).toBeInTheDocument()
  })

  it('affiche le badge du site', () => {
    afficher([site({ badge: 'Dépassement prévu' })])

    expect(screen.getByText('Dépassement prévu')).toBeInTheDocument()
  })

  it('met un tiret sur les valeurs absentes', () => {
    // Jamais de zéro : zéro est une mesure, l'absence de mesure n'en est pas une.
    afficher([site({ currentKw: null, forecast2hKw: null, thresholdKw: null })])

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('affiche le compte de mesures reçues', () => {
    afficher([site({ receivedCount: 14, expectedCount: 24 })])

    expect(screen.getByText('14/24')).toBeInTheDocument()
  })

  it('met un tiret quand le compte est inconnu', () => {
    afficher([site({ receivedCount: null, expectedCount: null })])

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})

describe('SiteDetail — alertes', () => {
  it('met l’alerte critique en avant dans le toast', () => {
    // La plus grave passe devant, quel que soit l'ordre d'arrivée.
    afficher([site({ alerts: [alert('moyenne', 'Tiède'), alert('critique', 'Urgent')] })])

    expect(screen.getByRole('status')).toHaveTextContent('Urgent')
  })

  it('retient la première alerte faute de critique', () => {
    afficher([site({ alerts: [alert('moyenne', 'Tiède'), alert('info', 'Pour info')] })])

    expect(screen.getByRole('status')).toHaveTextContent('Tiède')
  })

  it('liste les autres alertes sous le graphique', () => {
    afficher([site({ alerts: [alert('critique', 'Urgent'), alert('moyenne', 'Tiède')] })])

    expect(screen.getByRole('status')).toHaveTextContent('Urgent')
    expect(screen.getByText('Tiède')).toBeInTheDocument()
  })

  it('remet l’alerte dans la liste quand on ferme le toast', () => {
    // Fermer le toast ne doit pas faire disparaître l'information.
    afficher([site({ alerts: [alert('critique', 'Urgent')] })])

    fireEvent.click(screen.getByRole('button', { name: /Fermer/ }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Urgent')).toBeInTheDocument()
  })

  it('n’affiche aucun toast sans alerte', () => {
    afficher([site()])

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('SiteDetail — recommandations', () => {
  it('affiche les recommandations numérotées avec leur gain', () => {
    afficher([
      site({
        recommendations: [
          { id: 'r1', title: 'Décaler le four', detail: 'Après 21 h', saving: '−180 €' },
        ],
      }),
    ])

    expect(screen.getByText('Décaler le four')).toBeInTheDocument()
    expect(screen.getByText('−180 €')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('omet le gain quand il n’y en a pas', () => {
    afficher([
      site({ recommendations: [{ id: 'r1', title: 'Vérifier', detail: 'La passerelle', saving: null }] }),
    ])

    expect(screen.getByText('Vérifier')).toBeInTheDocument()
  })

  it('le dit quand il n’y en a aucune', () => {
    afficher([site()])

    expect(screen.getByText('Aucune recommandation pour ce site.')).toBeInTheDocument()
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SiteDetail } from '../../screens/SiteDetail'
import type { Alert, SiteDetail as Detail, DetailsBySite, Site } from '../../services/model'

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

function detail(partiel: Partial<Detail> = {}): Detail {
  return {
    at: '2026-10-25T13:15:16Z',
    stale: false,
    dataQuality: 'good',
    nullReasons: [],
    voltageV: 405.8,
    currentA: 247.4,
    powerFactor: 0.909,
    temperatureC: 7.8,
    humidityPct: 39.3,
    ...partiel,
  }
}

function afficher(sites: Site[], siteId = sites[0]?.id ?? '', details: DetailsBySite = {}) {
  const onSelect = vi.fn()
  render(<SiteDetail sites={sites} siteId={siteId} onSelect={onSelect} seriesBySite={{}} details={details} />)
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

describe('SiteDetail — diagnostic', () => {
  it('affiche l’état de l’installation', () => {
    afficher([site()], 'SITE001', { SITE001: detail() })

    expect(screen.getByText('405,8')).toBeInTheDocument()
    expect(screen.getByText('247,4')).toBeInTheDocument()
    expect(screen.getByText('0,909')).toBeInTheDocument()
    expect(screen.getByText('7,8')).toBeInTheDocument()
  })

  it('signale un facteur de puissance sous le seuil de facturation', () => {
    // Sous 0,9, le fournisseur facture la puissance réactive : c'est la seule
    // grandeur de ce bloc qui appelle une action.
    afficher([site()], 'SITE001', { SITE001: detail({ powerFactor: 0.82 }) })

    expect(screen.getByText(/puissance réactive facturée/)).toBeInTheDocument()
  })

  it('ne signale rien quand le facteur de puissance est correct', () => {
    afficher([site()], 'SITE001', { SITE001: detail({ powerFactor: 0.95 }) })

    expect(screen.queryByText(/puissance réactive facturée/)).not.toBeInTheDocument()
  })

  it('explique pourquoi des mesures manquent', () => {
    // C'est l'objet du ticket : le résumé dit qu'il en manque, le détail dit
    // pourquoi. Sans ça, l'écran affiche « 22/24 » et rien d'autre.
    afficher([site({ receivedCount: 22, expectedCount: 24 })], 'SITE001', {
      SITE001: detail({ dataQuality: 'partial' }),
    })

    expect(screen.getAllByText('Un capteur secondaire en panne').length).toBeGreaterThanOrEqual(1)
  })

  it('affiche un badge quand la qualité est dégradée', () => {
    afficher([site()], 'SITE001', { SITE001: detail({ dataQuality: 'critical' }) })

    expect(screen.getAllByText('Perte réseau : aucune mesure').length).toBeGreaterThanOrEqual(1)
  })

  it('n’affiche aucun badge quand tout va bien', () => {
    // Inutile d'annoncer que tout fonctionne : le badge ne sert qu'à signaler.
    afficher([site()], 'SITE001', { SITE001: detail({ dataQuality: 'good' }) })

    expect(screen.queryByText('Toutes les mesures sont disponibles')).not.toBeInTheDocument()
  })

  it('liste les capteurs indisponibles', () => {
    afficher([site()], 'SITE001', {
      SITE001: detail({ dataQuality: 'degraded', nullReasons: ['sonde de tension HS'] }),
    })

    expect(screen.getByText('sonde de tension HS')).toBeInTheDocument()
  })

  it('met un tiret sur une grandeur absente', () => {
    afficher([site()], 'SITE001', { SITE001: detail({ voltageV: null, powerFactor: null }) })

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('n’affiche pas le bloc quand le détail manque', () => {
    // Le détail vient d'un autre endpoint : son absence ne doit rien casser.
    afficher([site()], 'SITE001', {})

    expect(screen.queryByText('État de l’installation')).not.toBeInTheDocument()
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
        recommendations: [{ id: 'r1', title: 'Décaler le four', detail: 'Après 21 h', saving: '−180 €' }],
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

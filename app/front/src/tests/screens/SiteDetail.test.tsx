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

/** La ligne dépliable d'un site, repérée par son nom. */
function ligne(nom: string) {
  return screen.getByRole('button', { name: new RegExp(nom) })
}

describe('SiteDetail', () => {
  it('déplie le site demandé et laisse les autres fermés', () => {
    afficher([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'B')

    expect(ligne('Usine Lyon')).toHaveAttribute('aria-expanded', 'true')
    expect(ligne('Bureau Paris')).toHaveAttribute('aria-expanded', 'false')
  })

  it('liste tous les sites, y compris ceux qui sont repliés', () => {
    // C'est la raison d'être du panneau dépliant : le nom de chaque site est
    // lisible sans avoir à l'ouvrir.
    afficher([
      site({ id: 'A', name: 'Bureau Paris' }),
      site({ id: 'B', name: 'Usine Lyon' }),
      site({ id: 'C', name: 'Data Center Marseille' }),
    ])

    expect(ligne('Bureau Paris')).toBeInTheDocument()
    expect(ligne('Usine Lyon')).toBeInTheDocument()
    expect(ligne('Data Center Marseille')).toBeInTheDocument()
  })

  it('ouvre le premier site quand l’identifiant demandé n’existe pas', () => {
    afficher([site({ id: 'A', name: 'Bureau Paris' })], 'INEXISTANT')

    expect(ligne('Bureau Paris')).toHaveAttribute('aria-expanded', 'true')
  })

  it('prévient quand on choisit un autre site', () => {
    const onSelect = afficher(
      [site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })],
      'A',
    )

    fireEvent.click(ligne('Usine Lyon'))

    expect(onSelect).toHaveBeenCalledWith('B')
  })

  it('garde les panneaux déjà ouverts quand on en ouvre un autre', () => {
    // On compare souvent deux installations : refermer la première rendrait
    // la comparaison impossible.
    afficher([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'A')

    fireEvent.click(ligne('Usine Lyon'))

    expect(ligne('Bureau Paris')).toHaveAttribute('aria-expanded', 'true')
    expect(ligne('Usine Lyon')).toHaveAttribute('aria-expanded', 'true')
  })

  it('replie le site ouvert quand on reclique dessus', () => {
    afficher([site({ id: 'A', name: 'Bureau Paris' })], 'A')

    fireEvent.click(ligne('Bureau Paris'))

    expect(ligne('Bureau Paris')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Aucune recommandation pour ce site.')).not.toBeInTheDocument()
  })

  it('montre le détail de chaque panneau ouvert, pas celui du dernier', () => {
    // Le bug qu'on évite : un panneau qui afficherait les données du site
    // sélectionné au lieu des siennes.
    afficher([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'A', {
      A: detail({ voltageV: 405.8 }),
      B: detail({ voltageV: 231.4 }),
    })

    fireEvent.click(ligne('Usine Lyon'))

    expect(screen.getByText('405,8')).toBeInTheDocument()
    expect(screen.getByText('231,4')).toBeInTheDocument()
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

describe('SiteDetail — bout de ligne', () => {
  it('affiche la mesure quand tout va bien', () => {
    afficher([site({ currentKw: 165 })], 'SITE001', { SITE001: detail() })

    expect(ligne('Bureau Paris')).toHaveTextContent('165 kW')
  })

  it('remplace la mesure par l’anomalie', () => {
    // Un problème passe devant un chiffre : la liste sert d'abord à repérer
    // le site qui demande une attention.
    afficher([site()], 'SITE001', { SITE001: detail({ dataQuality: 'partial' }) })

    expect(ligne('Bureau Paris')).toHaveTextContent('capteur en panne')
    expect(ligne('Bureau Paris')).not.toHaveTextContent('100 kW')
  })

  it('signale un site qui ne transmet plus', () => {
    afficher([site({ isTransmitting: false })])

    expect(ligne('Bureau Paris')).toHaveTextContent('relevé interrompu')
  })

  it('met un tiret quand la mesure manque sans anomalie connue', () => {
    afficher([site({ currentKw: null })])

    expect(ligne('Bureau Paris')).toHaveTextContent('—')
  })

  it('affiche l’état de chaque ligne, même repliée', () => {
    // L'intérêt de la liste : repérer le site en panne sans l'ouvrir.
    afficher([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'A', {
      B: detail({ dataQuality: 'critical' }),
    })

    expect(ligne('Usine Lyon')).toHaveAttribute('aria-expanded', 'false')
    expect(ligne('Usine Lyon')).toHaveTextContent('perte réseau')
  })
})

describe('SiteDetail — diagnostic', () => {
  it('affiche l’état de l’installation', () => {
    afficher([site()], 'SITE001', { SITE001: detail() })

    expect(screen.getByText('405,8')).toBeInTheDocument()
    expect(screen.getByText('247,4')).toBeInTheDocument()
    expect(screen.getByText('7,8')).toBeInTheDocument()
  })

  it('n’affiche pas le facteur de puissance', () => {
    // Retiré volontairement : sans seuil contractuel connu, le chiffre nu
    // n'apprend rien à qui lit l'écran.
    afficher([site()], 'SITE001', { SITE001: detail({ powerFactor: 0.82 }) })

    expect(screen.queryByText('Facteur de puissance')).not.toBeInTheDocument()
    expect(screen.queryByText('0,820')).not.toBeInTheDocument()
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

  it('liste les capteurs indisponibles en clair', () => {
    // L'API renvoie des codes : les afficher tels quels donnerait des noms de
    // variables à un lecteur métier.
    afficher([site()], 'SITE001', {
      SITE001: detail({ dataQuality: 'degraded', nullReasons: ['humidity_sensor_failure'] }),
    })

    expect(screen.getByText('Sonde d’humidité en panne')).toBeInTheDocument()
  })

  it('affiche un code de panne inconnu plutôt que rien', () => {
    afficher([site()], 'SITE001', {
      SITE001: detail({ dataQuality: 'degraded', nullReasons: ['code_inedit'] }),
    })

    expect(screen.getByText('code_inedit')).toBeInTheDocument()
  })

  it('met un tiret sur une grandeur absente', () => {
    afficher([site()], 'SITE001', { SITE001: detail({ voltageV: null, currentA: null }) })

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('n’affiche pas le bloc quand le détail manque', () => {
    // Le détail vient d'un autre endpoint : son absence ne doit rien casser.
    afficher([site()], 'SITE001', {})

    expect(screen.queryByText('État de l’installation')).not.toBeInTheDocument()
  })

  it('ne montre pas le détail d’un site replié', () => {
    afficher([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'A', {
      A: detail(),
      B: detail({ voltageV: 231.4 }),
    })

    expect(screen.getByText('405,8')).toBeInTheDocument()
    expect(screen.queryByText('231,4')).not.toBeInTheDocument()
  })
})

describe('SiteDetail — consommation périmée', () => {
  // La consommation vient du résumé, la qualité du détail. Quand les deux se
  // contredisent, le chiffre doit dire qu'il n'est plus mesuré.

  it('signale une consommation qui n’est plus mesurée', () => {
    afficher([site({ currentKw: 794 })], 'SITE001', { SITE001: detail({ dataQuality: 'critical' }) })

    expect(screen.getByText('Dernière valeur connue')).toBeInTheDocument()
  })

  it('signale aussi la panne du compteur de consommation', () => {
    // La qualité peut rester « dégradée » alors que c'est précisément le
    // compteur de consommation qui est tombé.
    afficher([site({ currentKw: 167 })], 'SITE001', {
      SITE001: detail({ dataQuality: 'degraded', nullReasons: ['consumption_sensor_failure'] }),
    })

    expect(screen.getByText('Dernière valeur connue')).toBeInTheDocument()
  })

  it('date aussi le chiffre que le résumé porte encore', () => {
    // Même situation que ci-dessus, mais la mémoire sait de quand il date :
    // « dernière valeur connue » sans heure ne dit pas si on peut s'y fier.
    afficher(
      [site({ currentKw: 844, lastKnownKw: 844, lastKnownAt: '2026-10-26T11:54:00+00:00' })],
      'SITE001',
      { SITE001: detail({ dataQuality: 'degraded', nullReasons: ['consumption_sensor_failure'] }) },
    )

    expect(screen.getByText('Relevé de 12h54')).toBeInTheDocument()
  })

  it('n’ajoute rien quand la consommation est mesurée', () => {
    afficher([site({ currentKw: 138 })], 'SITE001', { SITE001: detail() })

    expect(screen.queryByText('Dernière valeur connue')).not.toBeInTheDocument()
  })

  it('ressort la dernière valeur mémorisée quand le site s’est tu', () => {
    // Sans elle, l'écran n'a plus aucun chiffre à montrer alors que le site
    // consommait deux heures plus tôt.
    afficher(
      [site({ currentKw: null, lastKnownKw: 470.4, lastKnownAt: '2026-10-26T11:54:00+00:00' })],
      'SITE001',
      { SITE001: detail({ dataQuality: 'critical' }) },
    )

    expect(screen.getByText('470')).toBeInTheDocument()
    // Le 26 octobre, la France est repassée à l'heure d'hiver : 11:54 UTC
    // vaut 12h54, pas 13h54.
    expect(screen.getByText('Relevé de 12h54')).toBeInTheDocument()
  })

  it('se passe de l’heure quand la mémoire n’en porte pas', () => {
    afficher([site({ currentKw: null, lastKnownKw: 470.4, lastKnownAt: null })], 'SITE001', {})

    expect(screen.getByText('Dernière valeur connue')).toBeInTheDocument()
  })

  it('n’annonce pas de dernière valeur quand il n’y en a aucune', () => {
    // « — » suivi de « dernière valeur connue » ne veut rien dire.
    afficher([site({ currentKw: null })], 'SITE001', { SITE001: detail({ dataQuality: 'critical' }) })

    expect(screen.queryByText('Dernière valeur connue')).not.toBeInTheDocument()
    expect(screen.queryByText(/Relevé de/)).not.toBeInTheDocument()
  })

  it('préfère la mesure de l’instant à la mémoire', () => {
    // La mémoire ne sert qu'en l'absence de mesure : un site qui transmet
    // affiche ce qu'il transmet.
    afficher([site({ currentKw: 138, lastKnownKw: 999 })], 'SITE001', { SITE001: detail() })

    expect(screen.getByText('138')).toBeInTheDocument()
    expect(screen.queryByText('999')).not.toBeInTheDocument()
  })

  it('n’ajoute rien quand le détail manque', () => {
    afficher([site({ currentKw: 138 })], 'SITE001', {})

    expect(screen.queryByText('Dernière valeur connue')).not.toBeInTheDocument()
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

  it('garde le toast de chaque site indépendant', () => {
    // Chaque ligne porte son propre état : fermer l'un ne ferme pas l'autre.
    afficher(
      [
        site({ id: 'A', name: 'Bureau Paris', alerts: [alert('critique', 'Urgent A')] }),
        site({ id: 'B', name: 'Usine Lyon', alerts: [alert('critique', 'Urgent B')] }),
      ],
      'A',
    )
    fireEvent.click(ligne('Usine Lyon'))

    fireEvent.click(screen.getAllByRole('button', { name: /Fermer/ })[0])

    expect(screen.getByRole('status')).toHaveTextContent('Urgent B')
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

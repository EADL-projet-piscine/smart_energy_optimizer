import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SiteDetail } from '../../screens/SiteDetail'
import type { Alert, SiteDetail as Detail, DetailsBySite, Site } from '../../services/model'

// The chart belongs to Recharts: replacing it isolates what we test and
// avoids the zero-dimension warnings under jsdom.
vi.mock('../../components/ConsumptionChart', () => ({
  ConsumptionChart: () => <div data-testid="chart" />,
}))

function alert(severity: Alert['severity'], title: string): Alert {
  return { id: title, severity, title, message: `message de ${title}` }
}

function site(overrides: Partial<Site> = {}): Site {
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
    ...overrides,
  }
}

function detail(overrides: Partial<Detail> = {}): Detail {
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
    ...overrides,
  }
}

function renderDetail(sites: Site[], siteId = sites[0]?.id ?? '', details: DetailsBySite = {}) {
  const onSelect = vi.fn()
  render(<SiteDetail sites={sites} siteId={siteId} onSelect={onSelect} seriesBySite={{}} details={details} />)
  return onSelect
}

/** The expandable row of a site, located by its name. */
function row(name: string) {
  return screen.getByRole('button', { name: new RegExp(name) })
}

describe('SiteDetail', () => {
  it('expands the requested site and leaves the others closed', () => {
    renderDetail([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'B')

    expect(row('Usine Lyon')).toHaveAttribute('aria-expanded', 'true')
    expect(row('Bureau Paris')).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists every site, including the collapsed ones', () => {
    // This is what the expandable panel is for: each site name is readable
    // without having to open it.
    renderDetail([
      site({ id: 'A', name: 'Bureau Paris' }),
      site({ id: 'B', name: 'Usine Lyon' }),
      site({ id: 'C', name: 'Data Center Marseille' }),
    ])

    expect(row('Bureau Paris')).toBeInTheDocument()
    expect(row('Usine Lyon')).toBeInTheDocument()
    expect(row('Data Center Marseille')).toBeInTheDocument()
  })

  it('opens the first site when the requested identifier does not exist', () => {
    renderDetail([site({ id: 'A', name: 'Bureau Paris' })], 'INEXISTANT')

    expect(row('Bureau Paris')).toHaveAttribute('aria-expanded', 'true')
  })

  it('notifies when another site is chosen', () => {
    const onSelect = renderDetail(
      [site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })],
      'A',
    )

    fireEvent.click(row('Usine Lyon'))

    expect(onSelect).toHaveBeenCalledWith('B')
  })

  it('keeps the already open panels when another one is opened', () => {
    // Two installations often get compared: closing the first would make the
    // comparison impossible.
    renderDetail([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'A')

    fireEvent.click(row('Usine Lyon'))

    expect(row('Bureau Paris')).toHaveAttribute('aria-expanded', 'true')
    expect(row('Usine Lyon')).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses the open site when it is clicked again', () => {
    renderDetail([site({ id: 'A', name: 'Bureau Paris' })], 'A')

    fireEvent.click(row('Bureau Paris'))

    expect(row('Bureau Paris')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Aucune recommandation pour ce site.')).not.toBeInTheDocument()
  })

  it('shows each open panel its own detail, not the last one', () => {
    // The bug this avoids: a panel showing the data of the selected site
    // instead of its own.
    renderDetail([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'A', {
      A: detail({ voltageV: 405.8 }),
      B: detail({ voltageV: 231.4 }),
    })

    fireEvent.click(row('Usine Lyon'))

    expect(screen.getByText('405,8')).toBeInTheDocument()
    expect(screen.getByText('231,4')).toBeInTheDocument()
  })

  it('warns when the summary contains no site', () => {
    renderDetail([])

    expect(screen.getByText(/Aucun site n’est disponible/)).toBeInTheDocument()
  })

  it('displays the site badge', () => {
    renderDetail([site({ badge: 'Dépassement prévu' })])

    expect(screen.getByText('Dépassement prévu')).toBeInTheDocument()
  })

  it('puts a dash on missing values', () => {
    // Never a zero: zero is a measurement, the absence of one is not.
    renderDetail([site({ currentKw: null, forecast2hKw: null, thresholdKw: null })])

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('displays the capacity and the share in use', () => {
    // Capacity alone says nothing: what informs is its ratio to consumption,
    // and that is what the alerts trigger on.
    renderDetail([site({ currentKw: 190, capacityKw: 200 })])

    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('95,0 % utilisés')).toBeInTheDocument()
  })

  it('announces no share in use without a capacity', () => {
    renderDetail([site({ currentKw: 190, capacityKw: null })])

    expect(screen.queryByText(/% utilisés/)).not.toBeInTheDocument()
  })

  it('announces no share in use without a consumption', () => {
    renderDetail([site({ currentKw: null, capacityKw: 200 })])

    expect(screen.queryByText(/% utilisés/)).not.toBeInTheDocument()
  })

  it('displays the count of readings received', () => {
    renderDetail([site({ receivedCount: 14, expectedCount: 24 })])

    expect(screen.getByText('14/24')).toBeInTheDocument()
  })

  it('puts a dash when the count is unknown', () => {
    renderDetail([site({ receivedCount: null, expectedCount: null })])

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})

describe('SiteDetail — end of row', () => {
  it('displays the reading when all is well', () => {
    renderDetail([site({ currentKw: 165 })], 'SITE001', { SITE001: detail() })

    expect(row('Bureau Paris')).toHaveTextContent('165 kW')
  })

  it('replaces the reading with the anomaly', () => {
    // A problem comes before a figure: the list is there first of all to spot
    // the site that needs attention.
    renderDetail([site()], 'SITE001', { SITE001: detail({ dataQuality: 'partial' }) })

    expect(row('Bureau Paris')).toHaveTextContent('capteur en panne')
    expect(row('Bureau Paris')).not.toHaveTextContent('100 kW')
  })

  it('reports a site that no longer transmits', () => {
    renderDetail([site({ isTransmitting: false })])

    expect(row('Bureau Paris')).toHaveTextContent('relevé interrompu')
  })

  it('puts a dash when the reading is missing with no known anomaly', () => {
    renderDetail([site({ currentKw: null })])

    expect(row('Bureau Paris')).toHaveTextContent('—')
  })

  it('shows the state of every row, even collapsed', () => {
    // The point of the list: spotting the failing site without opening it.
    renderDetail([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'A', {
      B: detail({ dataQuality: 'critical' }),
    })

    expect(row('Usine Lyon')).toHaveAttribute('aria-expanded', 'false')
    expect(row('Usine Lyon')).toHaveTextContent('perte réseau')
  })
})

describe('SiteDetail — diagnosis', () => {
  it('displays the state of the installation', () => {
    renderDetail([site()], 'SITE001', { SITE001: detail() })

    expect(screen.getByText('405,8')).toBeInTheDocument()
    expect(screen.getByText('247,4')).toBeInTheDocument()
    expect(screen.getByText('7,8')).toBeInTheDocument()
  })

  it('does not display the power factor', () => {
    // Removed deliberately: with no known contractual threshold, the bare
    // figure teaches the reader nothing.
    renderDetail([site()], 'SITE001', { SITE001: detail({ powerFactor: 0.82 }) })

    expect(screen.queryByText('Facteur de puissance')).not.toBeInTheDocument()
    expect(screen.queryByText('0,820')).not.toBeInTheDocument()
  })

  it('explains why readings are missing', () => {
    // This is what the ticket is about: the summary says some are missing, the
    // detail says why. Without it the screen shows "22/24" and nothing else.
    renderDetail([site({ receivedCount: 22, expectedCount: 24 })], 'SITE001', {
      SITE001: detail({ dataQuality: 'partial' }),
    })

    expect(screen.getAllByText('Un capteur secondaire en panne').length).toBeGreaterThanOrEqual(1)
  })

  it('displays a badge when the quality is degraded', () => {
    renderDetail([site()], 'SITE001', { SITE001: detail({ dataQuality: 'critical' }) })

    expect(screen.getAllByText('Perte réseau : aucune mesure').length).toBeGreaterThanOrEqual(1)
  })

  it('displays no badge when all is well', () => {
    // No need to announce that everything works: the badge is only there to
    // flag something.
    renderDetail([site()], 'SITE001', { SITE001: detail({ dataQuality: 'good' }) })

    expect(screen.queryByText('Toutes les mesures sont disponibles')).not.toBeInTheDocument()
  })

  it('lists the unavailable sensors in plain words', () => {
    // The API returns codes: showing them as is would hand variable names to
    // a business reader.
    renderDetail([site()], 'SITE001', {
      SITE001: detail({ dataQuality: 'degraded', nullReasons: ['humidity_sensor_failure'] }),
    })

    expect(screen.getByText('Sonde d’humidité en panne')).toBeInTheDocument()
  })

  it('displays an unknown failure code rather than nothing', () => {
    renderDetail([site()], 'SITE001', {
      SITE001: detail({ dataQuality: 'degraded', nullReasons: ['unknown_code'] }),
    })

    expect(screen.getByText('unknown_code')).toBeInTheDocument()
  })

  it('puts a dash on a missing reading', () => {
    renderDetail([site()], 'SITE001', { SITE001: detail({ voltageV: null, currentA: null }) })

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('does not display the block when the detail is missing', () => {
    // The detail comes from another endpoint: its absence must break nothing.
    renderDetail([site()], 'SITE001', {})

    expect(screen.queryByText('État de l’installation')).not.toBeInTheDocument()
  })

  it('does not show the detail of a collapsed site', () => {
    renderDetail([site({ id: 'A', name: 'Bureau Paris' }), site({ id: 'B', name: 'Usine Lyon' })], 'A', {
      A: detail(),
      B: detail({ voltageV: 231.4 }),
    })

    expect(screen.getByText('405,8')).toBeInTheDocument()
    expect(screen.queryByText('231,4')).not.toBeInTheDocument()
  })
})

describe('SiteDetail — last known value', () => {
  // The figure is only marked as dated once it comes out of the back end's
  // memory. Sensor state expires nothing: the detail and the summary are two
  // uncorrelated endpoints.

  it('brings back the last remembered value when the site has gone silent', () => {
    // Without it the screen has no figure left to show, even though the site
    // was consuming two hours earlier.
    renderDetail(
      [site({ currentKw: null, lastKnownKw: 470.4, lastKnownAt: '2026-10-26T11:54:00+00:00' })],
      'SITE001',
      { SITE001: detail({ dataQuality: 'critical' }) },
    )

    expect(screen.getByText('470')).toBeInTheDocument()
    // On 26 October France went back to winter time: 11:54 UTC is 12h54,
    // not 13h54.
    expect(screen.getByText('Dernier relevé datant de 12h54')).toBeInTheDocument()
  })

  it('does without the time when the memory carries none', () => {
    renderDetail([site({ currentKw: null, lastKnownKw: 470.4, lastKnownAt: null })], 'SITE001', {})

    expect(screen.getByText('Dernière valeur connue')).toBeInTheDocument()
  })

  it('announces no last value when there is none', () => {
    // "—" followed by "last known value" means nothing.
    renderDetail([site({ currentKw: null })], 'SITE001', { SITE001: detail({ dataQuality: 'critical' }) })

    expect(screen.queryByText('Dernière valeur connue')).not.toBeInTheDocument()
    expect(screen.queryByText(/Dernier relevé/)).not.toBeInTheDocument()
  })

  it('prefers the reading of the moment over the memory', () => {
    // The memory only serves in the absence of a reading: a site that
    // transmits displays what it transmits.
    renderDetail([site({ currentKw: 138, lastKnownKw: 999 })], 'SITE001', { SITE001: detail() })

    expect(screen.getByText('138')).toBeInTheDocument()
    expect(screen.queryByText('999')).not.toBeInTheDocument()
  })

  it('does not expire a figure of the current cycle on the strength of the sensors', () => {
    // The trap this avoids: announcing "reading from 14h43" when the
    // collection itself dates from 14h43. The meter is reported as failing by
    // the detail, but the summary did provide a figure for this cycle.
    renderDetail(
      [site({ currentKw: 904, lastKnownKw: 904, lastKnownAt: '2026-10-26T11:54:00+00:00' })],
      'SITE001',
      { SITE001: detail({ dataQuality: 'degraded', nullReasons: ['consumption_sensor_failure'] }) },
    )

    expect(screen.getByText('904')).toBeInTheDocument()
    expect(screen.queryByText(/Dernier relevé/)).not.toBeInTheDocument()
    expect(screen.queryByText('Dernière valeur connue')).not.toBeInTheDocument()
  })
})

describe('SiteDetail — alerts', () => {
  it('puts the most severe alert in the banner', () => {
    // The most severe comes first, whatever the order of arrival.
    renderDetail([site({ alerts: [alert('moyenne', 'Tiède'), alert('critique', 'Urgent')] })])

    expect(screen.getByRole('status')).toHaveTextContent('Urgent')
  })

  it('keeps the first alert when none is critical', () => {
    renderDetail([site({ alerts: [alert('moyenne', 'Tiède'), alert('info', 'Pour info')] })])

    expect(screen.getByRole('status')).toHaveTextContent('Tiède')
  })

  it('lists the other alerts below the chart', () => {
    renderDetail([site({ alerts: [alert('critique', 'Urgent'), alert('moyenne', 'Tiède')] })])

    expect(screen.getByRole('status')).toHaveTextContent('Urgent')
    expect(screen.getByText('Tiède')).toBeInTheDocument()
  })

  it('displays no banner without an alert', () => {
    renderDetail([site()])

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('gives each open panel its own banner', () => {
    // Every row carries its own data: two open panels each show their own
    // alert, not the same one twice.
    renderDetail(
      [
        site({ id: 'A', name: 'Bureau Paris', alerts: [alert('critique', 'Urgent A')] }),
        site({ id: 'B', name: 'Usine Lyon', alerts: [alert('critique', 'Urgent B')] }),
      ],
      'A',
    )

    fireEvent.click(row('Usine Lyon'))

    const banners = screen.getAllByRole('status')
    expect(banners).toHaveLength(2)
    expect(banners[0]).toHaveTextContent('Urgent A')
    expect(banners[1]).toHaveTextContent('Urgent B')
  })
})

describe('SiteDetail — recommendations', () => {
  it('displays the numbered recommendations with their saving', () => {
    renderDetail([
      site({
        recommendations: [{ id: 'r1', title: 'Décaler le four', detail: 'Après 21 h', saving: '−180 €' }],
      }),
    ])

    expect(screen.getByText('Décaler le four')).toBeInTheDocument()
    expect(screen.getByText('−180 €')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('omits the saving when there is none', () => {
    renderDetail([
      site({ recommendations: [{ id: 'r1', title: 'Vérifier', detail: 'La passerelle', saving: null }] }),
    ])

    expect(screen.getByText('Vérifier')).toBeInTheDocument()
  })

  it('says so when there is none at all', () => {
    renderDetail([site()])

    expect(screen.getByText('Aucune recommandation pour ce site.')).toBeInTheDocument()
  })
})

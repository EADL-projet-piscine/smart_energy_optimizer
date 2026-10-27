import { describe, expect, it } from 'vitest'
import { attachCapacityAlerts, attachLastReadings, normalizeSummary } from '../../services/normalize'

// Same shape as a real /api/v1/stats/summary response from the EnerVision API.
const ENERVISION_SUMMARY = {
  timestamp: '2026-10-21T09:34:44.744410',
  total_sites: 2,
  total_consumption_kw: 1178.84,
  sites: [
    {
      site_id: 'SITE001',
      site_name: 'Bureaux témoins',
      current_consumption_kw: 412.5,
      capacity_kw: 600,
      load_percent: 68.8,
      data_quality: 'good',
    },
    {
      site_id: 'SITE003',
      site_name: 'Data Center Marseille',
      current_consumption_kw: 766.34,
      capacity_kw: 800,
      load_percent: 95.8,
      data_quality: 'partial',
    },
  ],
}

describe('normalizeSummary — response shape', () => {
  it('reads a summary from the EnerVision API', () => {
    const result = normalizeSummary(ENERVISION_SUMMARY)

    expect(result).toMatchObject({
      siteCount: 2,
      consumptionKw: 1178.84,
      lastCollectedAt: '2026-10-21T09:34:44.744410',
      transmittingCount: 2,
      coveragePct: 100,
      excludedSites: [],
      source: 'api',
    })
    expect(result?.sites.map((site) => [site.id, site.name, site.currentKw])).toEqual([
      ['SITE001', 'Bureaux témoins', 412.5],
      ['SITE003', 'Data Center Marseille', 766.34],
    ])
  })

  it('unwraps the envelope sent by the back end', () => {
    const envelope = { data: ENERVISION_SUMMARY, fetched_at: '2026-10-21T09:35:00+00:00', stale: false }

    expect(normalizeSummary(envelope)).toEqual(normalizeSummary(ENERVISION_SUMMARY))
  })

  it.each([null, 'unexpected', 42, {}, [], { data: {} }])('returns null on an unknown body: %j', (body) => {
    expect(normalizeSummary(body)).toBeNull()
  })

  it('accepts sites indexed by identifier', () => {
    const result = normalizeSummary({
      sites: { SITE001: 120, SITE002: { name: 'Usine Lyon', current_kw: 80 } },
    })

    expect(result?.sites.map((site) => [site.id, site.name, site.currentKw])).toEqual([
      ['SITE001', 'SITE001', 120],
      ['SITE002', 'Usine Lyon', 80],
    ])
  })

  it('ignores entries that are not sites', () => {
    const result = normalizeSummary({ sites: [null, 'text', { site_id: 'SITE001', current_kw: 10 }] })

    expect(result?.sites.map((site) => site.id)).toEqual(['SITE001'])
  })

  it('gives a default identifier to an anonymous site', () => {
    const result = normalizeSummary({ sites: [{ current_kw: 10 }, { current_kw: 20 }] })

    expect(result?.sites.map((site) => site.id)).toEqual(['SITE001', 'SITE002'])
  })
})

describe('normalizeSummary — values', () => {
  it('reads French-formatted numbers and spelled-out booleans', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', current_consumption_kw: '1 234,5', online: 'offline' }],
    })

    expect(result?.sites[0]).toMatchObject({
      currentKw: 1234.5,
      isTransmitting: false,
      badge: 'Relevé interrompu',
    })
    expect(result).toMatchObject({ excludedSites: ['SITE001'], coveragePct: 0 })
  })

  it('infers that a site transmits when it has a reading, even without a flag', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', current_kw: 10 }, { site_id: 'SITE002' }],
    })

    expect(result?.sites.map((site) => site.isTransmitting)).toEqual([true, false])
  })

  it('recognises the status labels of the API', () => {
    const result = normalizeSummary({
      sites: [
        { site_id: 'A', current_kw: 1, status: 'forecast_exceedance' },
        { site_id: 'B', current_kw: 1, status: 'stale' },
        { site_id: 'C', current_kw: 1, status: 'nominal' },
        { site_id: 'D', current_kw: 1, status: 'Maintenance prévue' },
      ],
    })

    expect(result?.sites.map((site) => site.badge)).toEqual([
      'Dépassement prévu',
      'Relevé interrompu',
      null,
      'Maintenance prévue',
    ])
  })

  it('reads the exclusion list as identifiers or as objects', () => {
    const result = normalizeSummary({
      total_consumption_kw: 100,
      excluded_sites: ['SITE004', { site_id: 'SITE005' }, 42],
    })

    expect(result?.excludedSites).toEqual(['SITE004', 'SITE005'])
  })

  it('reads the fleet indicators provided by the API', () => {
    const result = normalizeSummary({
      total_consumption_kw: 100,
      daily_cost_eur: 4200,
      co2_equivalent_t: 1.8,
      threshold_kw: 900,
      forecast_peak_kw: 950,
      forecast_peak_at: '2026-10-21T11:00:00Z',
      alerts_critical: 2,
      alerts_medium: 3,
      alerts_open: 5,
    })

    expect(result).toMatchObject({
      dailyCostEur: 4200,
      co2Tons: 1.8,
      thresholdKw: 900,
      peakKw: 950,
      peakAt: '2026-10-21T11:00:00Z',
      criticalAlerts: 2,
      mediumAlerts: 3,
      totalAlerts: 5,
    })
  })
})

describe('normalizeSummary — alerts and recommendations', () => {
  it('translates severities and attaches a fleet alert to its site, only once', () => {
    const result = normalizeSummary({
      sites: [
        {
          site_id: 'SITE001',
          current_kw: 300,
          alerts: [{ id: 'A1', severity: 'warning', message: 'Charge élevée' }],
        },
      ],
      alerts: [
        { id: 'A1', site_id: 'SITE001', severity: 'warning', message: 'Charge élevée' },
        { id: 'A2', site_id: 'SITE001', severity: 'critical', title: 'Pointe', message: 'Pointe imminente' },
        { id: 'A3', site_id: 'SITE999', severity: 'critical', message: 'Site inconnu' },
      ],
    })

    expect(result?.sites[0].alerts.map((alert) => [alert.id, alert.severity])).toEqual([
      ['A1', 'moyenne'],
      ['A2', 'critique'],
    ])
    expect(result?.sites[0].badge).toBe('Alerte critique')
    expect(result).toMatchObject({ totalAlerts: 2, criticalAlerts: 1, mediumAlerts: 1 })
  })

  it('files an unknown severity as plain information', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', current_kw: 1, alerts: [{ message: 'À noter', severity: 'odd' }] }],
    })

    expect(result?.sites[0].alerts[0]).toMatchObject({ severity: 'info', id: 'alerte-0', title: 'Alerte' })
  })

  it('discards an alert with neither title nor message', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', current_kw: 1, alerts: [{ severity: 'critical' }, null] }],
    })

    expect(result?.sites[0].alerts).toEqual([])
  })

  it('formats the saving of a recommendation in euros', () => {
    const result = normalizeSummary({
      sites: [
        {
          site_id: 'SITE001',
          current_kw: 300,
          recommendations: [
            {
              title: 'Décaler le préchauffage',
              description: 'Lancer le chauffage à 6 h.',
              estimated_savings_eur: 350,
            },
            { title: 'Éteindre les enseignes', economie: '−120 €/mois' },
            { id: 'vide' },
          ],
        },
      ],
    })

    expect(result?.sites[0].recommendations).toEqual([
      {
        id: 'reco-0',
        title: 'Décaler le préchauffage',
        detail: 'Lancer le chauffage à 6 h.',
        saving: '−350 €',
      },
      { id: 'reco-1', title: 'Éteindre les enseignes', detail: '', saving: '−120 €/mois' },
    ])
  })
})

describe('normalizeSummary — dated series', () => {
  it('sorts the points chronologically', () => {
    const result = normalizeSummary({
      sites: [
        {
          site_id: 'SITE001',
          series: [
            { timestamp: '2026-10-21T11:00:00Z', measured_kw: 12 },
            { timestamp: '2026-10-21T09:00:00Z', measured_kw: 10 },
            { timestamp: '2026-10-21T10:00:00Z', measured_kw: 11, forecast_kw: 13 },
          ],
        },
      ],
    })

    expect(result?.sites[0].series).toEqual([
      { at: '2026-10-21T09:00:00Z', measuredKw: 10, forecastKw: null },
      { at: '2026-10-21T10:00:00Z', measuredKw: 11, forecastKw: 13 },
      { at: '2026-10-21T11:00:00Z', measuredKw: 12, forecastKw: null },
    ])
  })

  it('discards a point without a readable timestamp', () => {
    const result = normalizeSummary({
      sites: [
        {
          site_id: 'SITE001',
          series: [{ measured_kw: 10 }, { timestamp: 'not a date', measured_kw: 11 }, 42, null],
        },
      ],
    })

    expect(result?.sites[0].series).toEqual([])
  })

  it('keeps a dated point without a value: a missing reading stays visible', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', series: [{ timestamp: '2026-10-21T09:00:00Z' }] }],
    })

    expect(result?.sites[0].series).toEqual([
      { at: '2026-10-21T09:00:00Z', measuredKw: null, forecastKw: null },
    ])
  })

  it('reads the fleet series when the API provides one', () => {
    const result = normalizeSummary({
      total_consumption_kw: 100,
      series: [{ timestamp: '2026-10-21T09:00:00Z', measured_kw: 100 }],
    })

    expect(result?.series).toEqual([{ at: '2026-10-21T09:00:00Z', measuredKw: 100, forecastKw: null }])
  })
})

// ─────────────────────────── Business API envelope ───────────────────────────

// These two functions run after normalisation: the last known readings and the
// capacity alerts travel in the envelope set by the business API, next to the
// summary rather than inside it.

/** Minimal two-site summary, one of which has gone silent. */
function baseSummary() {
  const summary = normalizeSummary({
    sites: [
      { site_id: 'SITE001', current_consumption_kw: null },
      { site_id: 'SITE007', current_consumption_kw: 907, capacity_kw: 950 },
    ],
  })
  if (!summary) throw new Error('summary not recognised')
  return summary
}

describe('attachLastReadings', () => {
  it('attaches the last known reading to the right site', () => {
    const result = attachLastReadings(baseSummary(), {
      SITE001: { consumption_kw: 176.4, at: '2026-10-26T11:54:00+00:00' },
    })

    expect(result.sites[0].lastKnownKw).toBe(176.4)
    expect(result.sites[0].lastKnownAt).toBe('2026-10-26T11:54:00+00:00')
    expect(result.sites[1].lastKnownKw).toBeUndefined()
  })

  it('accepts an envelope that carries none', () => {
    // A back end predating this ticket does not provide the key: the screen
    // must keep working.
    expect(attachLastReadings(baseSummary(), undefined).sites[0].lastKnownKw).toBeUndefined()
  })

  it('ignores an unreadable entry', () => {
    const result = attachLastReadings(baseSummary(), { SITE001: 'not an object' })

    expect(result.sites[0].lastKnownKw).toBeUndefined()
  })

  it('ignores an identifier that matches no site', () => {
    const result = attachLastReadings(baseSummary(), { SITE999: { consumption_kw: 1 } })

    expect(result.sites.every((site) => site.lastKnownKw === undefined)).toBe(true)
  })
})

describe('attachCapacityAlerts', () => {
  const ALERT = {
    site_id: 'SITE007',
    severity: 'moyenne',
    message: 'Le site approche de sa capacité',
    raised_at: '2026-10-26T13:50:01+00:00',
    load_percent: 95.5,
    capacity_kw: 950,
  }

  it('attaches the alert to the right site', () => {
    const result = attachCapacityAlerts(baseSummary(), [ALERT])

    expect(result.sites[0].alerts).toHaveLength(0)
    expect(result.sites[1].alerts).toHaveLength(1)
    expect(result.sites[1].alerts[0].title).toBe('Capacité bientôt atteinte')
  })

  it('titles a critical alert differently', () => {
    const result = attachCapacityAlerts(baseSummary(), [{ ...ALERT, severity: 'critique' }])

    expect(result.sites[1].alerts[0].title).toBe('Capacité dépassée')
  })

  it('falls back to a neutral title for an unexpected severity', () => {
    const result = attachCapacityAlerts(baseSummary(), [{ ...ALERT, severity: 'odd' }])

    expect(result.sites[1].alerts[0].title).toBe('Capacité')
  })

  it('explains what justifies the alert', () => {
    const result = attachCapacityAlerts(baseSummary(), [ALERT])

    expect(result.sites[1].alerts[0].message).toContain('95,5 % de 950 kW')
    expect(result.sites[1].alerts[0].message).toContain('alerte levée à 14h50')
  })

  it('does without the capacity when it is missing', () => {
    const result = attachCapacityAlerts(baseSummary(), [{ ...ALERT, capacity_kw: null }])

    expect(result.sites[1].alerts[0].message).toContain('95,5 % de charge')
  })

  it('keeps the server message when there are no figures', () => {
    const result = attachCapacityAlerts(baseSummary(), [
      { site_id: 'SITE007', severity: 'moyenne', message: 'Le site approche de sa capacité' },
    ])

    expect(result.sites[1].alerts[0].message).toBe('Le site approche de sa capacité')
  })

  it('updates the banner counters', () => {
    // They are derived from the site alerts: without going back through
    // buildSummary, the banner would keep announcing zero.
    const result = attachCapacityAlerts(baseSummary(), [ALERT])

    expect(result.totalAlerts).toBe(1)
    expect(result.mediumAlerts).toBe(1)
  })

  it('never adds the same alert twice', () => {
    // The identifier carries the time it was raised: two successive cycles on
    // the same alert must not duplicate it.
    const result = attachCapacityAlerts(attachCapacityAlerts(baseSummary(), [ALERT]), [ALERT])

    expect(result.sites[1].alerts).toHaveLength(1)
  })

  it('accepts an envelope without any alert', () => {
    expect(attachCapacityAlerts(baseSummary(), []).sites[1].alerts).toHaveLength(0)
    expect(attachCapacityAlerts(baseSummary(), undefined).sites[1].alerts).toHaveLength(0)
  })

  it('ignores an unreadable entry or one without a site', () => {
    const result = attachCapacityAlerts(baseSummary(), ['x', { message: 'no site' }])

    expect(result.sites.every((site) => site.alerts.length === 0)).toBe(true)
  })

  it('ignores an identifier that matches no site', () => {
    const result = attachCapacityAlerts(baseSummary(), [{ ...ALERT, site_id: 'SITE999' }])

    expect(result.sites.every((site) => site.alerts.length === 0)).toBe(true)
  })
})

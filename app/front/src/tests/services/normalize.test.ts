import { describe, expect, it } from 'vitest'
import { normalizeSummary } from '../../services/normalize'

// Même forme qu'une vraie réponse de /api/v1/stats/summary de l'API EnerVision.
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

describe('normalizeSummary — forme de la réponse', () => {
  it('lit un résumé de l’API EnerVision', () => {
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

  it('déballe l’enveloppe envoyée par le back', () => {
    const envelope = { data: ENERVISION_SUMMARY, fetched_at: '2026-10-21T09:35:00+00:00', stale: false }

    expect(normalizeSummary(envelope)).toEqual(normalizeSummary(ENERVISION_SUMMARY))
  })

  it.each([null, 'inattendu', 42, {}, [], { data: {} }])('rend null sur un corps inconnu : %j', (body) => {
    expect(normalizeSummary(body)).toBeNull()
  })

  it('accepte des sites indexés par identifiant', () => {
    const result = normalizeSummary({
      sites: { SITE001: 120, SITE002: { name: 'Usine Lyon', current_kw: 80 } },
    })

    expect(result?.sites.map((site) => [site.id, site.name, site.currentKw])).toEqual([
      ['SITE001', 'SITE001', 120],
      ['SITE002', 'Usine Lyon', 80],
    ])
  })

  it('ignore les entrées qui ne sont pas des sites', () => {
    const result = normalizeSummary({ sites: [null, 'texte', { site_id: 'SITE001', current_kw: 10 }] })

    expect(result?.sites.map((site) => site.id)).toEqual(['SITE001'])
  })

  it('attribue un identifiant par défaut à un site anonyme', () => {
    const result = normalizeSummary({ sites: [{ current_kw: 10 }, { current_kw: 20 }] })

    expect(result?.sites.map((site) => site.id)).toEqual(['SITE001', 'SITE002'])
  })
})

describe('normalizeSummary — valeurs', () => {
  it('lit les nombres à la française et les booléens écrits en toutes lettres', () => {
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

  it('déduit qu’un site transmet quand il a une mesure, même sans indicateur', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', current_kw: 10 }, { site_id: 'SITE002' }],
    })

    expect(result?.sites.map((site) => site.isTransmitting)).toEqual([true, false])
  })

  it('reconnaît les libellés d’état de l’API', () => {
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

  it('lit la liste d’exclusion sous forme d’identifiants ou d’objets', () => {
    const result = normalizeSummary({
      total_consumption_kw: 100,
      excluded_sites: ['SITE004', { site_id: 'SITE005' }, 42],
    })

    expect(result?.excludedSites).toEqual(['SITE004', 'SITE005'])
  })

  it('lit les indicateurs du parc fournis par l’API', () => {
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

describe('normalizeSummary — alertes et recommandations', () => {
  it('traduit les gravités et rattache une alerte du parc à son site, une seule fois', () => {
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

  it('range une gravité inconnue en simple information', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', current_kw: 1, alerts: [{ message: 'À noter', severity: 'bizarre' }] }],
    })

    expect(result?.sites[0].alerts[0]).toMatchObject({ severity: 'info', id: 'alerte-0', title: 'Alerte' })
  })

  it('écarte une alerte sans titre ni message', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', current_kw: 1, alerts: [{ severity: 'critical' }, null] }],
    })

    expect(result?.sites[0].alerts).toEqual([])
  })

  it('formate l’économie d’une recommandation en euros', () => {
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

describe('normalizeSummary — séries datées', () => {
  it('trie les points dans le temps', () => {
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

  it('écarte un point sans horodatage lisible', () => {
    const result = normalizeSummary({
      sites: [
        {
          site_id: 'SITE001',
          series: [{ measured_kw: 10 }, { timestamp: 'pas une date', measured_kw: 11 }, 42, null],
        },
      ],
    })

    expect(result?.sites[0].series).toEqual([])
  })

  it('garde un point daté sans valeur : l’absence de mesure reste visible', () => {
    const result = normalizeSummary({
      sites: [{ site_id: 'SITE001', series: [{ timestamp: '2026-10-21T09:00:00Z' }] }],
    })

    expect(result?.sites[0].series).toEqual([
      { at: '2026-10-21T09:00:00Z', measuredKw: null, forecastKw: null },
    ])
  })

  it('lit la série du parc quand l’API la fournit', () => {
    const result = normalizeSummary({
      total_consumption_kw: 100,
      series: [{ timestamp: '2026-10-21T09:00:00Z', measured_kw: 100 }],
    })

    expect(result?.series).toEqual([{ at: '2026-10-21T09:00:00Z', measuredKw: 100, forecastKw: null }])
  })
})

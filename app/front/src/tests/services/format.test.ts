import { describe, expect, it } from 'vitest'
import {
  alertsLabel,
  buildSummary,
  completeSite,
  forecastPeak,
  formatCollectedAt,
  formatHour,
  formatKw,
  formatNumber,
  formatTime,
  hourOf,
  lastMeasuredIndex,
  sitesLabel,
  toIsoUtc,
} from '../../services/format'
import type { ParkSummary, SeriesPoint, Site } from '../../services/model'

// Ces tests supposent TZ=Europe/Paris, fixé par le script npm : sans cela, ils
// passeraient sur une machine française et échoueraient en CI, qui tourne en UTC.

/** fr-FR sépare les milliers par une espace insécable étroite selon la version d'ICU. */
function normaliser(valeur: string): string {
  return valeur.replace(/[  ]/g, ' ')
}

function point(heure: number, measuredKw: number | null, forecastKw: number | null = null): SeriesPoint {
  return { at: `2026-10-22T${String(heure).padStart(2, '0')}:00:00Z`, measuredKw, forecastKw }
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

function summary(partiel: Partial<ParkSummary> = {}): ParkSummary {
  return {
    siteCount: 0,
    lastCollectedAt: '',
    consumptionKw: null,
    changePct: null,
    coveragePct: null,
    transmittingCount: 0,
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
    ...partiel,
  }
}

// ─────────────────────────────── Fuseaux et heures ───────────────────────────

describe('toIsoUtc', () => {
  it('ajoute le fuseau manquant', () => {
    // /stats/summary date sans fuseau alors qu'il s'agit d'UTC.
    expect(toIsoUtc('2026-10-22T07:05:19.904319')).toBe('2026-10-22T07:05:19.904319Z')
  })

  it('laisse intact un horodatage déjà daté', () => {
    expect(toIsoUtc('2026-10-22T07:05:19Z')).toBe('2026-10-22T07:05:19Z')
    expect(toIsoUtc('2026-10-22T09:05:19+02:00')).toBe('2026-10-22T09:05:19+02:00')
  })
})

describe('formatCollectedAt', () => {
  it('lit un horodatage nu comme de l’UTC', () => {
    // Sans toIsoUtc, JavaScript l'interpréterait comme de l'heure locale et
    // afficherait 07:05 au lieu de 09:05 : deux heures d'écart silencieuses.
    expect(formatCollectedAt('2026-10-22T07:05:19')).toBe('09:05')
  })

  it('laisse passer une heure déjà formatée', () => {
    expect(formatCollectedAt('21:00')).toBe('21:00')
  })

  it('rend la valeur brute quand elle n’est pas une date', () => {
    expect(formatCollectedAt('bientôt')).toBe('bientôt')
  })
})

describe('formatHour', () => {
  it('rend l’heure entamée, sans arrondir', () => {
    // Les points de l'historique tombent à 09h32, 10h32… c'est « le relevé
    // de 9h », pas celui de 10h.
    expect(formatHour('2026-10-22T07:32:00Z')).toBe('09h00')
    expect(formatHour('2026-10-22T07:57:00Z')).toBe('09h00')
  })

  it('ne fait jamais paraître une mesure plus récente qu’elle n’est', () => {
    expect(formatHour('2026-10-22T07:01:00Z')).toBe('09h00')
    expect(formatHour('2026-10-22T07:59:00Z')).toBe('09h00')
  })
})

describe('formatTime', () => {
  it('garde la minute exacte', () => {
    expect(formatTime('2026-10-22T11:04:00Z')).toBe('13h04')
  })

  it('n’arrondit pas', () => {
    expect(formatTime('2026-10-22T11:57:00Z')).toBe('13h57')
  })
})

describe('hourOf', () => {
  it('rend l’heure locale', () => {
    expect(hourOf('2026-10-22T07:32:00Z')).toBe(9)
  })

  it('rend 0 sur une valeur illisible', () => {
    expect(hourOf('pas une date')).toBe(0)
  })
})

// ─────────────────────────────── Formatage ───────────────────────────────────

describe('formatNumber', () => {
  it('sépare les milliers à la française', () => {
    expect(normaliser(formatNumber(2847))).toBe('2 847')
  })

  it('respecte le nombre de décimales demandé', () => {
    expect(formatNumber(1.84, 1)).toBe('1,8')
    expect(formatNumber(1.84)).toBe('2')
  })
})

describe('formatKw', () => {
  it('rend un tiret sur une valeur absente', () => {
    // Zéro serait une mesure ; l'absence de mesure n'en est pas une.
    expect(formatKw(null)).toBe('—')
    expect(formatKw(0)).toBe('0')
  })
})

describe('sitesLabel', () => {
  it('écrit les petits effectifs en toutes lettres', () => {
    expect(sitesLabel(0)).toBe('Aucun site')
    expect(sitesLabel(7)).toBe('Sept sites')
  })

  it('repasse aux chiffres au-delà de dix', () => {
    expect(sitesLabel(12)).toBe('12 sites')
  })
})

describe('alertsLabel', () => {
  it('accorde le pluriel', () => {
    expect(alertsLabel(1, 2)).toBe('1 critique · 2 moyennes')
    expect(alertsLabel(2, 1)).toBe('2 critiques · 1 moyenne')
  })
})

// ─────────────────────────────── Séries ──────────────────────────────────────

describe('lastMeasuredIndex', () => {
  it('trouve le dernier point mesuré', () => {
    expect(lastMeasuredIndex([point(8, 10), point(9, 20), point(10, null)])).toBe(1)
  })

  it('rend -1 sans aucune mesure', () => {
    expect(lastMeasuredIndex([point(8, null)])).toBe(-1)
    expect(lastMeasuredIndex([])).toBe(-1)
  })
})

describe('forecastPeak', () => {
  it('trouve la prévision la plus haute', () => {
    const serie = [point(8, null, 100), point(9, null, 300), point(10, null, 200)]

    expect(forecastPeak(serie)?.value).toBe(300)
  })

  it('ignore les points déjà mesurés', () => {
    // Une pointe passée n'intéresse personne : on veut celle à venir.
    const serie = [point(8, 10, 900), point(9, null, 300), point(10, null, 200)]

    expect(forecastPeak(serie, 0)?.value).toBe(300)
  })

  it('rend null sans aucune prévision', () => {
    expect(forecastPeak([point(8, 10)])).toBeNull()
  })
})

// ─────────────────────────────── Sites ───────────────────────────────────────

describe('completeSite — badge', () => {
  it('signale un relevé interrompu avant tout le reste', () => {
    // Un site muet ne peut pas annoncer de dépassement : la panne prime.
    const resultat = completeSite(
      site({
        isTransmitting: false,
        thresholdKw: 100,
        forecast2hKw: 500,
        alerts: [{ id: 'a', severity: 'critique', title: 'x', message: 'y' }],
      }),
    )

    expect(resultat.badge).toBe('Relevé interrompu')
  })

  it('annonce un dépassement prévu', () => {
    expect(completeSite(site({ thresholdKw: 100, forecast2hKw: 150 })).badge).toBe('Dépassement prévu')
  })

  it('ne crie pas au dépassement sous le seuil', () => {
    expect(completeSite(site({ thresholdKw: 100, forecast2hKw: 90 })).badge).toBeNull()
  })

  it('remonte une alerte critique faute de dépassement', () => {
    const resultat = completeSite(
      site({ alerts: [{ id: 'a', severity: 'critique', title: 'x', message: 'y' }] }),
    )

    expect(resultat.badge).toBe('Alerte critique')
  })

  it('ignore une alerte moyenne', () => {
    const resultat = completeSite(
      site({ alerts: [{ id: 'a', severity: 'moyenne', title: 'x', message: 'y' }] }),
    )

    expect(resultat.badge).toBeNull()
  })

  it('respecte un badge déjà fourni par l’API', () => {
    expect(completeSite(site({ badge: 'Maintenance', isTransmitting: false })).badge).toBe('Maintenance')
  })
})

describe('completeSite — commentaire', () => {
  it('explique l’exclusion d’un site muet', () => {
    const resultat = completeSite(site({ id: 'SITE004', isTransmitting: false }))

    expect(resultat.comment).toContain('SITE004')
    expect(resultat.comment).toContain('exclu du total du parc')
  })

  it('annonce le franchissement du seuil avec son heure', () => {
    const resultat = completeSite(
      site({ thresholdKw: 500, series: [point(8, 100), point(9, null, 900)] }),
    )

    expect(resultat.comment).toContain('franchi')
    expect(resultat.comment).toContain('900')
  })

  it('rassure quand la pointe reste sous le seuil', () => {
    const resultat = completeSite(
      site({ thresholdKw: 500, series: [point(8, 100), point(9, null, 300)] }),
    )

    expect(resultat.comment).toContain('reste sous le seuil')
  })

  it('respecte un commentaire déjà fourni', () => {
    expect(completeSite(site({ comment: 'Déjà dit', isTransmitting: false })).comment).toBe('Déjà dit')
  })
})

describe('completeSite — prévision à deux heures', () => {
  it('prend le point situé deux pas après la dernière mesure', () => {
    const serie = [point(8, 100), point(9, null, 200), point(10, null, 300)]

    expect(completeSite(site({ series: serie })).forecast2hKw).toBe(300)
  })

  it('respecte la valeur fournie par l’API', () => {
    const serie = [point(8, 100), point(9, null, 200), point(10, null, 300)]

    expect(completeSite(site({ series: serie, forecast2hKw: 42 })).forecast2hKw).toBe(42)
  })

  it('reste null quand la série est trop courte', () => {
    expect(completeSite(site({ series: [point(8, 100)] })).forecast2hKw).toBeNull()
  })
})

// ─────────────────────────────── Parc ────────────────────────────────────────

describe('buildSummary', () => {
  const troisSites = [site({ id: 'A' }), site({ id: 'B' }), site({ id: 'C', isTransmitting: false })]

  it('compte les sites qui transmettent', () => {
    const resultat = buildSummary(summary({ sites: troisSites }))

    expect(resultat.siteCount).toBe(3)
    expect(resultat.transmittingCount).toBe(2)
  })

  it('déduit la couverture', () => {
    expect(buildSummary(summary({ sites: troisSites })).coveragePct).toBe(67)
  })

  it('respecte une couverture fournie par l’API', () => {
    expect(buildSummary(summary({ coveragePct: 42, sites: [site()] })).coveragePct).toBe(42)
  })

  it('exclut les sites muets du total', () => {
    expect(buildSummary(summary({ sites: troisSites })).excludedSites).toEqual(['C'])
  })

  it('respecte une liste d’exclusion fournie par l’API', () => {
    const resultat = buildSummary(summary({ excludedSites: ['Z'], sites: troisSites }))

    expect(resultat.excludedSites).toEqual(['Z'])
  })

  it('agrège les alertes des sites par sévérité', () => {
    const resultat = buildSummary(
      summary({
        sites: [
          site({
            id: 'A',
            alerts: [
              { id: '1', severity: 'critique', title: 'x', message: 'y' },
              { id: '2', severity: 'moyenne', title: 'x', message: 'y' },
            ],
          }),
          site({ id: 'B', alerts: [{ id: '3', severity: 'moyenne', title: 'x', message: 'y' }] }),
        ],
      }),
    )

    expect(resultat.totalAlerts).toBe(3)
    expect(resultat.criticalAlerts).toBe(1)
    expect(resultat.mediumAlerts).toBe(2)
  })

  it('garde les compteurs de l’API quand aucun site ne porte d’alerte', () => {
    const resultat = buildSummary(summary({ totalAlerts: 5, criticalAlerts: 2, sites: [site()] }))

    expect(resultat.totalAlerts).toBe(5)
    expect(resultat.criticalAlerts).toBe(2)
  })

  it('désigne le principal contributeur d’un dépassement', () => {
    const resultat = buildSummary(
      summary({
        thresholdKw: 500,
        series: [point(8, 100), point(9, null, 900)],
        sites: [
          site({ id: 'SITE002', alerts: [{ id: '1', severity: 'critique', title: 'x', message: 'y' }] }),
        ],
      }),
    )

    expect(resultat.comment).toContain('SITE002')
    expect(resultat.comment).toContain('principal contributeur')
  })

  it('ne désigne personne quand le seuil est respecté', () => {
    const resultat = buildSummary(
      summary({
        thresholdKw: 500,
        series: [point(8, 100), point(9, null, 300)],
        sites: [
          site({ id: 'SITE002', alerts: [{ id: '1', severity: 'critique', title: 'x', message: 'y' }] }),
        ],
      }),
    )

    expect(resultat.comment).not.toContain('principal contributeur')
  })

  it('n’invente rien sur un parc vide', () => {
    const resultat = buildSummary(summary())

    expect(resultat.sites).toEqual([])
    expect(resultat.coveragePct).toBeNull()
    expect(resultat.comment).toBeNull()
  })
})

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
  sensorLabel,
  sitesLabel,
  toIsoUtc,
} from '../../services/format'
import type { Alert, ParkSummary, SeriesPoint, Site } from '../../services/model'

// These tests assume TZ=Europe/Paris, set by the npm script: without it they
// would pass on a French machine and fail in CI, which runs in UTC.

/** fr-FR separates thousands with a no-break space whose code point depends on
 * the ICU version: U+00A0 on some, the narrow U+202F on others. Spelling them
 * out keeps this readable — as literals they are two invisible characters. */
function normalize(value: string): string {
  return value.replace(/[  ]/g, ' ')
}

function point(hour: number, measuredKw: number | null, forecastKw: number | null = null): SeriesPoint {
  return { at: `2026-10-22T${String(hour).padStart(2, '0')}:00:00Z`, measuredKw, forecastKw }
}

/** A bare alert: these tests only ever look at its severity. */
function alert(severity: Alert['severity'], id = 'a'): Alert {
  return { id, severity, title: 'x', message: 'y', recommendations: [] }
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
    ...overrides,
  }
}

function summary(overrides: Partial<ParkSummary> = {}): ParkSummary {
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
    ...overrides,
  }
}

// ─────────────────────────────── Timezones and hours ─────────────────────────

describe('toIsoUtc', () => {
  it('adds the missing timezone', () => {
    // /stats/summary dates without a timezone even though it means UTC.
    expect(toIsoUtc('2026-10-22T07:05:19.904319')).toBe('2026-10-22T07:05:19.904319Z')
  })

  it('leaves an already dated timestamp untouched', () => {
    expect(toIsoUtc('2026-10-22T07:05:19Z')).toBe('2026-10-22T07:05:19Z')
    expect(toIsoUtc('2026-10-22T09:05:19+02:00')).toBe('2026-10-22T09:05:19+02:00')
  })
})

describe('formatCollectedAt', () => {
  it('reads a bare timestamp as UTC', () => {
    // Without toIsoUtc, JavaScript would read it as local time and display
    // 07:05 instead of 09:05: a silent two-hour gap.
    expect(formatCollectedAt('2026-10-22T07:05:19')).toBe('09:05')
  })

  it('lets an already formatted time through', () => {
    expect(formatCollectedAt('21:00')).toBe('21:00')
  })

  it('returns the raw value when it is not a date', () => {
    expect(formatCollectedAt('soon')).toBe('soon')
  })
})

describe('formatHour', () => {
  it('returns the hour under way, without rounding', () => {
    // History points land at 09:32, 10:32… that is "the 9 o'clock reading",
    // not the 10 o'clock one.
    expect(formatHour('2026-10-22T07:32:00Z')).toBe('09h00')
    expect(formatHour('2026-10-22T07:57:00Z')).toBe('09h00')
  })

  it('never makes a reading look more recent than it is', () => {
    expect(formatHour('2026-10-22T07:01:00Z')).toBe('09h00')
    expect(formatHour('2026-10-22T07:59:00Z')).toBe('09h00')
  })
})

describe('formatTime', () => {
  it('keeps the exact minute', () => {
    expect(formatTime('2026-10-22T11:04:00Z')).toBe('13h04')
  })

  it('does not round', () => {
    expect(formatTime('2026-10-22T11:57:00Z')).toBe('13h57')
  })
})

describe('hourOf', () => {
  it('returns the local hour', () => {
    expect(hourOf('2026-10-22T07:32:00Z')).toBe(9)
  })

  it('returns 0 on an unreadable value', () => {
    expect(hourOf('not a date')).toBe(0)
  })
})

// ─────────────────────────────── Formatting ──────────────────────────────────

describe('formatNumber', () => {
  it('separates thousands the French way', () => {
    expect(normalize(formatNumber(2847))).toBe('2 847')
  })

  it('honours the requested number of decimals', () => {
    expect(formatNumber(1.84, 1)).toBe('1,8')
    expect(formatNumber(1.84)).toBe('2')
  })
})

describe('formatKw', () => {
  it('returns a dash on a missing value', () => {
    // Zero would be a measurement; the absence of a measurement is not.
    expect(formatKw(null)).toBe('—')
    expect(formatKw(0)).toBe('0')
  })
})

describe('sitesLabel', () => {
  it('spells out small counts', () => {
    expect(sitesLabel(0)).toBe('Aucun site')
    expect(sitesLabel(7)).toBe('Sept sites')
  })

  it('switches back to digits beyond ten', () => {
    expect(sitesLabel(12)).toBe('12 sites')
  })
})

describe('alertsLabel', () => {
  it('agrees the plural', () => {
    expect(alertsLabel(1, 2)).toBe('1 critique · 2 moyennes')
    expect(alertsLabel(2, 1)).toBe('2 critiques · 1 moyenne')
  })
})

// ─────────────────────────────── Series ──────────────────────────────────────

describe('lastMeasuredIndex', () => {
  it('finds the last measured point', () => {
    expect(lastMeasuredIndex([point(8, 10), point(9, 20), point(10, null)])).toBe(1)
  })

  it('returns -1 when nothing was measured', () => {
    expect(lastMeasuredIndex([point(8, null)])).toBe(-1)
    expect(lastMeasuredIndex([])).toBe(-1)
  })
})

describe('forecastPeak', () => {
  it('finds the highest forecast', () => {
    const series = [point(8, null, 100), point(9, null, 300), point(10, null, 200)]

    expect(forecastPeak(series)?.value).toBe(300)
  })

  it('ignores points already measured', () => {
    // A past peak interests nobody: what matters is the one still ahead.
    const series = [point(8, 10, 900), point(9, null, 300), point(10, null, 200)]

    expect(forecastPeak(series, 0)?.value).toBe(300)
  })

  it('returns null when there is no forecast at all', () => {
    expect(forecastPeak([point(8, 10)])).toBeNull()
  })
})

// ─────────────────────────────── Sites ───────────────────────────────────────

describe('completeSite — badge', () => {
  it('reports an interrupted reading before anything else', () => {
    // A silent site cannot announce an overload: the outage comes first.
    const result = completeSite(
      site({
        isTransmitting: false,
        thresholdKw: 100,
        forecast2hKw: 500,
        alerts: [alert('critique')],
      }),
    )

    expect(result.badge).toBe('Relevé interrompu')
  })

  it('announces a forecast overload', () => {
    expect(completeSite(site({ thresholdKw: 100, forecast2hKw: 150 })).badge).toBe('Dépassement prévu')
  })

  it('does not cry overload below the threshold', () => {
    expect(completeSite(site({ thresholdKw: 100, forecast2hKw: 90 })).badge).toBeNull()
  })

  it('surfaces a critical alert when there is no overload', () => {
    const result = completeSite(site({ alerts: [alert('critique')] }))

    expect(result.badge).toBe('Alerte critique')
  })

  it('ignores a medium alert', () => {
    const result = completeSite(site({ alerts: [alert('moyenne')] }))

    expect(result.badge).toBeNull()
  })

  it('honours a badge already provided by the API', () => {
    expect(completeSite(site({ badge: 'Maintenance', isTransmitting: false })).badge).toBe('Maintenance')
  })
})

describe('completeSite — comment', () => {
  it('explains why a silent site is excluded', () => {
    const result = completeSite(site({ id: 'SITE004', isTransmitting: false }))

    expect(result.comment).toContain('SITE004')
    expect(result.comment).toContain('exclu du total du parc')
  })

  it('announces the threshold crossing with its time', () => {
    const result = completeSite(site({ thresholdKw: 500, series: [point(8, 100), point(9, null, 900)] }))

    expect(result.comment).toContain('franchi')
    expect(result.comment).toContain('900')
  })

  it('reassures when the peak stays below the threshold', () => {
    const result = completeSite(site({ thresholdKw: 500, series: [point(8, 100), point(9, null, 300)] }))

    expect(result.comment).toContain('reste sous le seuil')
  })

  it('honours a comment already provided', () => {
    expect(completeSite(site({ comment: 'Déjà dit', isTransmitting: false })).comment).toBe('Déjà dit')
  })
})

describe('completeSite — two-hour forecast', () => {
  it('takes the point two steps after the last reading', () => {
    const series = [point(8, 100), point(9, null, 200), point(10, null, 300)]

    expect(completeSite(site({ series })).forecast2hKw).toBe(300)
  })

  it('honours the value provided by the API', () => {
    const series = [point(8, 100), point(9, null, 200), point(10, null, 300)]

    expect(completeSite(site({ series, forecast2hKw: 42 })).forecast2hKw).toBe(42)
  })

  it('stays null when the series is too short', () => {
    expect(completeSite(site({ series: [point(8, 100)] })).forecast2hKw).toBeNull()
  })
})

// ─────────────────────────────── Fleet ───────────────────────────────────────

describe('buildSummary', () => {
  const threeSites = [site({ id: 'A' }), site({ id: 'B' }), site({ id: 'C', isTransmitting: false })]

  it('counts the transmitting sites', () => {
    const result = buildSummary(summary({ sites: threeSites }))

    expect(result.siteCount).toBe(3)
    expect(result.transmittingCount).toBe(2)
  })

  it('derives the coverage', () => {
    expect(buildSummary(summary({ sites: threeSites })).coveragePct).toBe(67)
  })

  it('honours a coverage provided by the API', () => {
    expect(buildSummary(summary({ coveragePct: 42, sites: [site()] })).coveragePct).toBe(42)
  })

  it('excludes silent sites from the total', () => {
    expect(buildSummary(summary({ sites: threeSites })).excludedSites).toEqual(['C'])
  })

  it('honours an exclusion list provided by the API', () => {
    const result = buildSummary(summary({ excludedSites: ['Z'], sites: threeSites }))

    expect(result.excludedSites).toEqual(['Z'])
  })

  it('aggregates site alerts by severity', () => {
    const result = buildSummary(
      summary({
        sites: [
          site({ id: 'A', alerts: [alert('critique', '1'), alert('moyenne', '2')] }),
          site({ id: 'B', alerts: [alert('moyenne', '3')] }),
        ],
      }),
    )

    expect(result.totalAlerts).toBe(3)
    expect(result.criticalAlerts).toBe(1)
    expect(result.mediumAlerts).toBe(2)
  })

  it('keeps the API counters when no site carries an alert', () => {
    const result = buildSummary(summary({ totalAlerts: 5, criticalAlerts: 2, sites: [site()] }))

    expect(result.totalAlerts).toBe(5)
    expect(result.criticalAlerts).toBe(2)
  })

  it('names the main contributor to an overload', () => {
    const result = buildSummary(
      summary({
        thresholdKw: 500,
        series: [point(8, 100), point(9, null, 900)],
        sites: [site({ id: 'SITE002', alerts: [alert('critique', '1')] })],
      }),
    )

    expect(result.comment).toContain('SITE002')
    expect(result.comment).toContain('principal contributeur')
  })

  it('names nobody when the threshold is respected', () => {
    const result = buildSummary(
      summary({
        thresholdKw: 500,
        series: [point(8, 100), point(9, null, 300)],
        sites: [site({ id: 'SITE002', alerts: [alert('critique', '1')] })],
      }),
    )

    expect(result.comment).not.toContain('principal contributeur')
  })

  it('invents nothing on an empty fleet', () => {
    const result = buildSummary(summary())

    expect(result.sites).toEqual([])
    expect(result.coveragePct).toBeNull()
    expect(result.comment).toBeNull()
  })
})

// ─────────────────────────────── Sensors ─────────────────────────────────────

describe('sensorLabel', () => {
  it('translates the codes observed on the source API', () => {
    expect(sensorLabel('network_loss')).toBe('Lien réseau interrompu')
    expect(sensorLabel('consumption_sensor_failure')).toBe('Compteur de consommation en panne')
  })

  it('returns the raw code when it is unknown', () => {
    // The list is not a contract: an unseen code must stay readable for
    // diagnosis rather than make the line disappear.
    expect(sensorLabel('unknown_code')).toBe('unknown_code')
  })
})

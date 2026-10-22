import type { ParkSummary, SeriesPoint, Site } from './model'

/** Libellés en toutes lettres pour les petits effectifs. */
const SITE_COUNT_LABELS = [
  'Aucun site',
  'Un site',
  'Deux sites',
  'Trois sites',
  'Quatre sites',
  'Cinq sites',
  'Six sites',
  'Sept sites',
  'Huit sites',
  'Neuf sites',
  'Dix sites',
]

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatKw(value: number | null): string {
  if (value === null) return '—'
  return formatNumber(value)
}

export function sitesLabel(count: number): string {
  return SITE_COUNT_LABELS[count] ?? `${count} sites`
}

export function formatCollectedAt(value: string): string {
  if (/^\d{1,2}:\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function alertsLabel(critical: number, medium: number): string {
  const criticalPart = `${critical} critique${critical > 1 ? 's' : ''}`
  const mediumPart = `${medium} moyenne${medium > 1 ? 's' : ''}`
  return `${criticalPart} · ${mediumPart}`
}

/** Dernière heure pour laquelle une mesure réelle existe. */
export function lastMeasuredHour(series: SeriesPoint[]): number | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index].measuredKw !== null) return series[index].hour
  }
  return null
}

/** Pointe prévue, éventuellement restreinte aux heures postérieures à `afterHour`. */
export function forecastPeak(
  series: SeriesPoint[],
  afterHour?: number,
): { hour: number; value: number } | null {
  let best: { hour: number; value: number } | null = null
  for (const point of series) {
    if (point.forecastKw === null) continue
    if (afterHour !== undefined && point.hour <= afterHour) continue
    if (!best || point.forecastKw > best.value) {
      best = { hour: point.hour, value: point.forecastKw }
    }
  }
  if (best || afterHour === undefined) return best
  return forecastPeak(series)
}

export function forecastAt(series: SeriesPoint[], hour: number): number | null {
  return series.find((point) => point.hour === hour)?.forecastKw ?? null
}

function peakSentence(threshold: number, peak: number, hour: number, scope: 'parc' | 'site'): string {
  if (peak > threshold && scope === 'parc') {
    return `Le seuil contractuel serait dépassé vers ${hour} h avec une pointe prévue à ${formatNumber(peak)} kW.`
  }
  if (peak > threshold) {
    return `Le seuil contractuel de ${formatNumber(threshold)} kW serait franchi vers ${hour} h, avec une pointe prévue à ${formatNumber(peak)} kW.`
  }
  if (scope === 'parc') {
    return `Le seuil contractuel de ${formatNumber(threshold)} kW reste respecté. Pointe prévue à ${formatNumber(peak)} kW vers ${hour} h.`
  }
  return `La consommation prévue reste sous le seuil de ${formatNumber(threshold)} kW, avec une pointe à ${formatNumber(peak)} kW vers ${hour} h.`
}

/** Complète un site : prévision à +2 h, heure de pointe, badge et commentaire déduits. */
export function completeSite(site: Site): Site {
  const measuredHour = lastMeasuredHour(site.series)
  const peak = forecastPeak(site.series, measuredHour ?? undefined)
  const forecast2hKw =
    site.forecast2hKw ?? (measuredHour === null ? null : forecastAt(site.series, measuredHour + 2))
  const peakHour = site.peakHour ?? peak?.hour ?? null
  const peakKw = peak?.value ?? null

  let badge = site.badge
  if (!badge) {
    if (!site.isTransmitting) badge = 'Relevé interrompu'
    else if (site.thresholdKw !== null && forecast2hKw !== null && forecast2hKw > site.thresholdKw) {
      badge = 'Dépassement prévu'
    } else if (site.alerts.some((alert) => alert.severity === 'critique')) badge = 'Alerte critique'
  }

  let comment = site.comment
  if (!comment) {
    if (!site.isTransmitting) {
      comment = `Aucun relevé exploitable depuis plus de deux heures. ${site.id} est exclu du total du parc.`
    } else if (site.thresholdKw !== null && peakKw !== null && peakHour !== null) {
      comment = peakSentence(site.thresholdKw, peakKw, peakHour, 'site')
    }
  }

  return {
    ...site,
    forecast2hKw,
    peakHour,
    badge: badge ?? null,
    comment: comment ?? null,
  }
}

/** Complète le résumé du parc à partir des sites, en respectant les valeurs déjà fournies par l'API. */
export function buildSummary(summary: ParkSummary): ParkSummary {
  const sites = summary.sites.map(completeSite)
  const alerts = sites.flatMap((site) => site.alerts)
  const excluded =
    summary.excludedSites.length > 0
      ? summary.excludedSites
      : sites.filter((site) => !site.isTransmitting).map((site) => site.id)
  const transmitting =
    sites.length > 0 ? sites.filter((site) => site.isTransmitting).length : summary.transmittingCount
  const siteCount = sites.length > 0 ? sites.length : summary.siteCount
  const peak = forecastPeak(summary.series, lastMeasuredHour(summary.series) ?? undefined)
  const peakHour = summary.peakHour ?? peak?.hour ?? null
  const peakKw = summary.peakKw ?? peak?.value ?? null
  const coveragePct =
    summary.coveragePct ?? (siteCount > 0 ? Math.round((transmitting / siteCount) * 100) : null)

  const contributor = sites.find((site) => site.alerts.some((alert) => alert.severity === 'critique'))
  let comment = summary.comment
  if (!comment && summary.thresholdKw !== null && peakKw !== null && peakHour !== null) {
    comment = peakSentence(summary.thresholdKw, peakKw, peakHour, 'parc')
    if (peakKw > summary.thresholdKw && contributor) {
      comment += ` Une alerte a été levée sur ${contributor.id}, principal contributeur.`
    }
  }

  return {
    ...summary,
    sites,
    excludedSites: excluded,
    transmittingCount: transmitting,
    siteCount,
    coveragePct,
    peakHour,
    peakKw,
    comment,
    totalAlerts: alerts.length > 0 ? alerts.length : summary.totalAlerts,
    criticalAlerts:
      alerts.length > 0
        ? alerts.filter((alert) => alert.severity === 'critique').length
        : summary.criticalAlerts,
    mediumAlerts:
      alerts.length > 0
        ? alerts.filter((alert) => alert.severity === 'moyenne').length
        : summary.mediumAlerts,
  }
}

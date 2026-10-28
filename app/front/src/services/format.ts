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

/** L'API source date /stats/summary et /sites/{id}/current sans fuseau alors qu'il
 * s'agit d'UTC, tandis que /readings met un Z. Sans ce correctif, JavaScript lit
 * l'horodatage nu comme de l'heure locale et affiche deux heures de moins en France. */
export function toIsoUtc(value: string): string {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
}

export function formatCollectedAt(value: string): string {
  if (/^\d{1,2}:\d{2}$/.test(value)) return value
  const date = new Date(toIsoUtc(value))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** Heure locale d'un horodatage ISO, pour les phrases et les graduations. */
export function hourOf(at: string): number {
  const date = new Date(toIsoUtc(at))
  return Number.isNaN(date.getTime()) ? 0 : date.getHours()
}

/** Heure entamée : une mesure de 09h32 est « le relevé de 9h ». Arrondir au
 * plus proche l'étiquetterait 10h00 et la ferait paraître plus récente
 * qu'elle n'est. */
export function formatHour(at: string): string {
  const date = new Date(toIsoUtc(at))
  if (Number.isNaN(date.getTime())) return at
  return `${String(date.getHours()).padStart(2, '0')}h00`
}

/** Minuit local du jour d'une date, pour compter les jours civils. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Écart en jours civils locaux. L'arrondi absorbe les journées de 23 ou
 * 25 heures des changements d'heure. */
function dayGap(date: Date, now: Date): number {
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
}

/** Heure entamée, datée dès qu'il ne s'agit plus d'aujourd'hui.
 *
 * Les prévisions portent sur vingt-quatre heures : « 14h00 » seul ne dit pas
 * si c'est dans deux heures ou dans vingt-deux, et se lit volontiers comme un
 * moment déjà passé. `now` est injectable pour que les tests ne dépendent pas
 * du jour où ils tournent.
 */
export function formatDayHour(at: string, now: Date = new Date()): string {
  const date = new Date(toIsoUtc(at))
  if (Number.isNaN(date.getTime())) return at

  const hour = formatHour(at)
  const gap = dayGap(date, now)
  if (gap === 0) return hour
  if (gap === 1) return `demain ${hour}`
  if (gap === -1) return `hier ${hour}`
  // Au-delà, le nom du jour suffit : l'horizon ne dépasse pas la journée
  // suivante, et une date complète alourdirait la case pour rien.
  return `${date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })} ${hour}`
}

/** Heure exacte, réservée à la mesure la plus récente : là, la minute compte. */
export function formatTime(at: string): string {
  const date = new Date(toIsoUtc(at))
  if (Number.isNaN(date.getTime())) return at
  return `${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')}`
}

export function alertsLabel(critical: number, medium: number): string {
  const criticalPart = `${critical} critique${critical > 1 ? 's' : ''}`
  const mediumPart = `${medium} moyenne${medium > 1 ? 's' : ''}`
  return `${criticalPart} · ${mediumPart}`
}

/** Seuils de charge, repris de la configuration du back — `alert_medium_pct`
 * et `alert_critical_pct` dans config.py. L'API ne les expose pas, ils sont
 * donc recopiés ici : si l'un bouge là-bas, il doit bouger ici aussi. */
const LOAD_MEDIUM_PCT = 90
const LOAD_CRITICAL_PCT = 100

/** Couleur d'une charge, aux mêmes seuils que les alertes de capacité.
 *
 * Le troisième seuil du back, 85 %, ne s'applique pas : il sert à éteindre une
 * alerte déjà levée, pour qu'elle ne clignote pas quand la charge oscille
 * autour de 90. Une valeur prévue n'a pas d'état antérieur, donc rien à
 * éteindre.
 */
export function loadTone(percentage: number | null): 'defaut' | 'ambre' | 'danger' {
  if (percentage === null) return 'defaut'
  if (percentage >= LOAD_CRITICAL_PCT) return 'danger'
  if (percentage >= LOAD_MEDIUM_PCT) return 'ambre'
  return 'defaut'
}

/** Index du dernier point portant une mesure réelle, -1 si la série n'en a aucune. */
export function lastMeasuredIndex(series: SeriesPoint[]): number {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index].measuredKw !== null) return index
  }
  return -1
}

/** Pointe prévue, éventuellement restreinte aux points postérieurs à `afterIndex`. */
export function forecastPeak(series: SeriesPoint[], afterIndex = -1): { at: string; value: number } | null {
  let best: { at: string; value: number } | null = null
  series.forEach((point, index) => {
    if (point.forecastKw === null || index <= afterIndex) return
    if (!best || point.forecastKw > best.value) {
      best = { at: point.at, value: point.forecastKw }
    }
  })
  if (best || afterIndex < 0) return best
  return forecastPeak(series)
}

/** Dernier créneau prévu après `afterIndex` : jusqu'où porte la prévision.
 *
 * « Aucun pic » sans horizon est une demi-réponse — aucun pic jusqu'à quand ? */
export function forecastHorizon(series: SeriesPoint[], afterIndex = -1): string | null {
  for (let index = series.length - 1; index > afterIndex; index -= 1) {
    if (series[index].forecastKw !== null) return series[index].at
  }
  return null
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

/** Complète un site : prévision à +2 h, pointe, badge et commentaire déduits. */
export function completeSite(site: Site): Site {
  const measuredIndex = lastMeasuredIndex(site.series)
  const peak = forecastPeak(site.series, measuredIndex)
  const forecast2hKw = site.forecast2hKw ?? site.series[measuredIndex + 2]?.forecastKw ?? null
  const peakAt = site.peakAt ?? peak?.at ?? null
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
    } else if (site.thresholdKw !== null && peakKw !== null && peakAt !== null) {
      comment = peakSentence(site.thresholdKw, peakKw, hourOf(peakAt), 'site')
    }
  }

  return {
    ...site,
    forecast2hKw,
    peakAt,
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
  const peak = forecastPeak(summary.series, lastMeasuredIndex(summary.series))
  const peakAt = summary.peakAt ?? peak?.at ?? null
  const peakKw = summary.peakKw ?? peak?.value ?? null
  const coveragePct =
    summary.coveragePct ?? (siteCount > 0 ? Math.round((transmitting / siteCount) * 100) : null)

  const contributor = sites.find((site) => site.alerts.some((alert) => alert.severity === 'critique'))
  let comment = summary.comment
  if (!comment && summary.thresholdKw !== null && peakKw !== null && peakAt !== null) {
    comment = peakSentence(summary.thresholdKw, peakKw, hourOf(peakAt), 'parc')
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
    peakAt,
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

/** Libellés de l'échelle `data_quality` de l'API source. */
const QUALITY_LABELS: Record<string, string> = {
  good: 'Toutes les mesures sont disponibles',
  partial: 'Un capteur secondaire en panne',
  degraded: 'Plusieurs capteurs en panne',
  critical: 'Perte réseau : aucune mesure',
}

/** Version courte des mêmes états, pour le bout d'une ligne de liste où la
 * phrase complète ne tiendrait pas. */
const QUALITY_SHORT: Record<string, string> = {
  partial: 'capteur en panne',
  degraded: 'capteurs en panne',
  critical: 'perte réseau',
}

/** Traduit `data_quality` en phrase lisible, ou rend la valeur brute si elle
 * est inconnue — mieux vaut afficher un mot étrange que rien du tout. */
export function qualityLabel(quality: string | null): string | null {
  if (!quality) return null
  return QUALITY_LABELS[quality] ?? quality
}

/** Même chose en quelques mots, et `null` quand tout va bien : la ligne
 * affiche alors la mesure plutôt qu'un état qui n'apprend rien. */
export function qualityShort(quality: string | null): string | null {
  if (!quality || quality === 'good') return null
  return QUALITY_SHORT[quality] ?? quality
}

const SENSOR_LABELS: Record<string, string> = {
  consumption_sensor_failure: 'Compteur de consommation en panne',
  electrical_sensor_failure: 'Capteur électrique en panne',
  humidity_sensor_failure: 'Sonde d’humidité en panne',
  network_loss: 'Lien réseau interrompu',
  temperature_sensor_failure: 'Sonde de température en panne',
}

/** Traduit un code de panne, ou rend le code brut s'il est inconnu : un mot
 * étrange reste plus exploitable pour le diagnostic qu'une ligne disparue. */
export function sensorLabel(reason: string): string {
  return SENSOR_LABELS[reason] ?? reason
}

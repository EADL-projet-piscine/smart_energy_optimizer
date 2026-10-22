import { buildSummary } from './format'
import type { Alert, ParkSummary, Recommendation, SeriePoint, Severity, Site } from './modele'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Renvoie la première clé renseignée parmi `keys`, l'API source variant d'une version à l'autre. */
function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (['true', '1', 'oui', 'yes', 'online'].includes(normalized)) return true
    if (['false', '0', 'non', 'no', 'offline'].includes(normalized)) return false
  }
  return null
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toHour(value: unknown): number | null {
  if (typeof value === 'number' && value >= 0 && value <= 24) return Math.round(value)
  if (typeof value === 'string') {
    const label = value.match(/^(\d{1,2})\s*h?$/)
    if (label) {
      const hour = Number(label[1])
      if (hour >= 0 && hour <= 24) return hour
    }
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.getHours()
  }
  return null
}

function toSeverity(value: unknown): Severity {
  const raw = String(value ?? '').toLowerCase()
  if (['critique', 'critical', 'high', 'haute', 'error', 'urgent', 'bloquant'].includes(raw)) {
    return 'critique'
  }
  if (['moyenne', 'medium', 'warning', 'warn', 'avertissement', 'moderee', 'modérée'].includes(raw)) {
    return 'moyenne'
  }
  return 'info'
}

function toBadge(value: unknown): string | null {
  const label = toText(value)
  if (!label) return null
  const key = label.toLowerCase().replaceAll(' ', '_')
  if (['forecast_exceedance', 'depassement', 'depassement_prevu', 'exceedance'].includes(key)) {
    return 'Dépassement prévu'
  }
  if (['offline', 'stale', 'interrompu', 'releve_interrompu'].includes(key)) return 'Relevé interrompu'
  if (['ok', 'stable', 'nominal'].includes(key)) return null
  return label
}

function parsePoint(value: unknown, index: number): SeriePoint | null {
  if (typeof value === 'number') {
    return { hour: index, measuredKw: value, forecastKw: null }
  }
  if (!isObject(value)) return null
  const hour = toHour(pick(value, ['heure', 'hour', 'h', 'timestamp', 'time', 'datetime'])) ?? index
  const measured = toNumber(
    pick(value, ['measured_kw', 'mesure_kw', 'consumption_kw', 'measured', 'mesure', 'value', 'kw']),
  )
  const forecast = toNumber(
    pick(value, ['forecast_kw', 'prevision_kw', 'predicted_kw', 'forecast', 'prevision', 'prediction_kw']),
  )
  if (measured === null && forecast === null) return null
  return { hour, measuredKw: measured, forecastKw: forecast }
}

function parseSeries(value: unknown): SeriePoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((point, index) => parsePoint(point, index))
    .filter((point): point is SeriePoint => point !== null)
    .sort((a, b) => a.hour - b.hour)
}

function parseAlert(value: unknown, index: number): Alert | null {
  if (!isObject(value)) return null
  const message = toText(pick(value, ['message', 'description', 'detail', 'texte', 'content']))
  const title = toText(pick(value, ['titre', 'title', 'label', 'name'])) ?? 'Alerte'
  if (!message && title === 'Alerte') return null
  return {
    id: toText(pick(value, ['id', 'alert_id', 'alerte_id'])) ?? `alerte-${index}`,
    severity: toSeverity(pick(value, ['severite', 'severity', 'level', 'niveau', 'priority'])),
    title,
    message: message ?? title,
  }
}

function parseRecommendation(value: unknown, index: number): Recommendation | null {
  if (!isObject(value)) return null
  const title = toText(pick(value, ['titre', 'title', 'label', 'name', 'action']))
  const detail = toText(pick(value, ['description', 'detail', 'message', 'texte', 'content']))
  if (!title && !detail) return null
  const savingEur = toNumber(
    pick(value, ['estimated_savings_eur', 'economie_eur', 'savings_eur', 'gain_eur']),
  )
  const savingLabel = toText(pick(value, ['economie', 'gain', 'savings']))
  return {
    id: toText(pick(value, ['id', 'recommendation_id'])) ?? `reco-${index}`,
    title: title ?? 'Recommandation',
    detail: detail ?? '',
    saving:
      savingLabel ??
      (savingEur === null ? null : `−${new Intl.NumberFormat('fr-FR').format(savingEur)} €`),
  }
}

function parseSite(value: unknown, index: number): Site | null {
  if (!isObject(value)) return null
  const id =
    toText(pick(value, ['id', 'site_id', 'code', 'site_code'])) ??
    `SITE${String(index + 1).padStart(3, '0')}`
  const series = parseSeries(
    pick(value, ['serie', 'series', 'hourly', 'points', 'timeline', 'history', 'mesures', 'measurements']),
  )
  const transmittingFlag = toBoolean(
    pick(value, ['transmet', 'transmitting', 'is_transmitting', 'online', 'active', 'is_online']),
  )
  const currentKw = toNumber(
    pick(value, [
      'current_kw',
      'current_consumption_kw',
      'consumption_kw',
      'actuel_kw',
      'puissance_kw',
      'power_kw',
    ]),
  )
  const alerts = toArray(pick(value, ['alertes', 'alerts']))
    .map((alert, alertIndex) => parseAlert(alert, alertIndex))
    .filter((alert): alert is Alert => alert !== null)
  const recommendations = toArray(pick(value, ['recommandations', 'recommendations', 'actions']))
    .map((recommendation, recoIndex) => parseRecommendation(recommendation, recoIndex))
    .filter((recommendation): recommendation is Recommendation => recommendation !== null)

  return {
    id,
    name: toText(pick(value, ['nom', 'name', 'site_name', 'label'])) ?? id,
    type: toText(pick(value, ['type', 'site_type', 'category', 'categorie', 'usage'])) ?? 'Site',
    readingLabel:
      toText(pick(value, ['reading', 'releve', 'granularity', 'reading_interval'])) ?? 'relevé horaire',
    currentKw,
    forecast2hKw: toNumber(
      pick(value, ['forecast_2h_kw', 'forecast_plus_2h_kw', 'prevu_2h_kw', 'prevision_2h_kw', 'forecast_kw']),
    ),
    thresholdKw: toNumber(
      pick(value, ['threshold_kw', 'contractual_threshold_kw', 'seuil_kw', 'seuil_contractuel_kw', 'threshold']),
    ),
    receivedCount: toNumber(
      pick(value, ['measures_received', 'mesures_recues', 'received', 'points_received']),
    ),
    expectedCount: toNumber(
      pick(value, ['measures_expected', 'mesures_attendues', 'expected', 'points_expected']),
    ),
    isTransmitting:
      transmittingFlag ?? (currentKw !== null || series.some((point) => point.measuredKw !== null)),
    badge: toBadge(pick(value, ['badge', 'status', 'etat', 'state'])),
    series,
    peakHour: toHour(pick(value, ['peak_hour', 'heure_pointe', 'forecast_peak_hour'])),
    comment: toText(pick(value, ['commentaire', 'comment', 'caption', 'summary'])),
    alerts,
    recommendations,
  }
}

function extractIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (isObject(item)) return toText(pick(item, ['id', 'site_id', 'code']))
      return null
    })
    .filter((item): item is string => item !== null)
}

function extractSites(source: Record<string, unknown>): Site[] {
  const raw = pick(source, ['sites', 'site_summaries', 'siteSummaries', 'details'])
  if (Array.isArray(raw)) {
    return raw.map((site, index) => parseSite(site, index)).filter((site): site is Site => site !== null)
  }
  if (isObject(raw)) {
    return Object.entries(raw)
      .map(([key, value], index) => {
        if (!isObject(value)) return parseSite({ id: key, current_kw: value }, index)
        return parseSite({ id: key, ...value }, index)
      })
      .filter((site): site is Site => site !== null)
  }
  return []
}

/** Rattache au bon site les alertes déclarées au niveau du parc. */
function attachParkAlerts(sites: Site[], source: Record<string, unknown>): Site[] {
  const raw = pick(source, ['alertes', 'alerts'])
  if (!Array.isArray(raw)) return sites
  const enriched = sites.map((site) => ({ ...site, alerts: [...site.alerts] }))
  raw.forEach((value, index) => {
    if (!isObject(value)) return
    const alert = parseAlert(value, index)
    if (!alert) return
    const siteId = toText(pick(value, ['site_id', 'siteId', 'site', 'code']))
    const site = enriched.find((candidate) => candidate.id === siteId)
    if (!site) return
    if (site.alerts.some((existing) => existing.id === alert.id)) return
    site.alerts.push(alert)
  })
  return enriched
}

/** Série du parc reconstituée en sommant les sites qui transmettent. */
function sumSeries(sites: Site[]): SeriePoint[] {
  const hours = new Set<number>()
  sites.forEach((site) => site.series.forEach((point) => hours.add(point.hour)))
  return [...hours]
    .sort((a, b) => a - b)
    .map((hour) => {
      let measured: number | null = null
      let forecast: number | null = null
      for (const site of sites) {
        if (!site.isTransmitting) continue
        const point = site.series.find((candidate) => candidate.hour === hour)
        if (!point) continue
        if (point.measuredKw !== null) measured = (measured ?? 0) + point.measuredKw
        if (point.forecastKw !== null) forecast = (forecast ?? 0) + point.forecastKw
      }
      return { hour, measuredKw: measured, forecastKw: forecast }
    })
}

function parseSummaryObject(source: Record<string, unknown>): ParkSummary | null {
  const sites = attachParkAlerts(extractSites(source), source)
  const consumptionKw = toNumber(
    pick(source, [
      'current_consumption_kw',
      'consommation_actuelle_kw',
      'consumption_kw',
      'total_consumption_kw',
      'current_kw',
    ]),
  )
  if (sites.length === 0 && consumptionKw === null) return null

  const series = parseSeries(
    pick(source, ['serie', 'series', 'hourly', 'timeline', 'park_series', 'consumption_series']),
  )

  const collectedAt = pick(source, [
    'last_collection',
    'last_reading_at',
    'derniere_collecte',
    'collected_at',
    'timestamp',
  ])

  const criticalAlerts = toNumber(pick(source, ['alerts_critical', 'critical_alerts', 'alertes_critiques']))
  const mediumAlerts = toNumber(pick(source, ['alerts_medium', 'medium_alerts', 'alertes_moyennes']))
  const totalAlerts = toNumber(
    pick(source, ['alerts_open', 'open_alerts', 'alertes_en_cours', 'alerts_total']),
  )

  const summary: ParkSummary = {
    siteCount: toNumber(pick(source, ['sites_count', 'nombre_sites', 'total_sites'])) ?? sites.length,
    lastCollectedAt: toText(collectedAt) ?? '',
    consumptionKw,
    changePct: toNumber(
      pick(source, [
        'consumption_delta_pct',
        'consumption_change_percent',
        'variation_horaire_pct',
        'delta_pct',
        'change_percent',
      ]),
    ),
    coveragePct: toNumber(pick(source, ['coverage_pct', 'coverage_percent', 'couverture_pct'])),
    transmittingCount:
      toNumber(pick(source, ['sites_transmitting', 'transmitting_sites', 'sites_transmettant'])) ?? 0,
    totalAlerts: totalAlerts ?? 0,
    criticalAlerts: criticalAlerts ?? 0,
    mediumAlerts: mediumAlerts ?? 0,
    dailyCostEur: toNumber(pick(source, ['daily_cost_eur', 'cout_jour_eur', 'cost_eur', 'daily_cost'])),
    co2Tons: toNumber(pick(source, ['co2_equivalent_t', 'co2_tons', 'co2_t', 'co2_equivalent_tons'])),
    excludedSites: extractIds(pick(source, ['excluded_sites', 'excluded_site_ids', 'sites_exclus'])),
    thresholdKw: toNumber(
      pick(source, ['threshold_kw', 'contractual_threshold_kw', 'seuil_kw', 'seuil_contractuel_kw']),
    ),
    peakKw: toNumber(pick(source, ['forecast_peak_kw', 'peak_kw', 'pointe_prevue_kw', 'pointe_kw'])),
    peakHour: toHour(pick(source, ['forecast_peak_hour', 'peak_hour', 'heure_pointe'])),
    series: series.length > 0 ? series : sumSeries(sites),
    comment: toText(pick(source, ['commentaire', 'comment', 'caption', 'insight'])),
    sites,
    source: 'api',
  }

  return buildSummary(summary)
}

/** Point d'entrée : accepte un tableau de sites, un résumé, ou un résumé enveloppé. */
export function normalizeSummary(body: unknown): ParkSummary | null {
  if (Array.isArray(body)) {
    const sites = body
      .map((site, index) => parseSite(site, index))
      .filter((site): site is Site => site !== null)
    if (sites.length === 0) return null
    return parseSummaryObject({ sites })
  }
  if (!isObject(body)) return null
  const direct = parseSummaryObject(body)
  if (direct) return direct
  for (const key of ['data', 'result', 'summary', 'payload']) {
    const inner = body[key]
    if (isObject(inner) || Array.isArray(inner)) {
      const summary = normalizeSummary(inner)
      if (summary) return summary
    }
  }
  return null
}

import { buildSummary, formatNumber, formatTime } from './format'
import type { Alert, ParkSummary, Recommendation, SeriesPoint, Severity, Site } from './model'

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

function parsePoint(value: unknown): SeriesPoint | null {
  if (!isObject(value)) return null
  const at = toText(pick(value, ['timestamp', 'at', 'time', 'datetime', 'horodatage']))
  if (!at || Number.isNaN(new Date(at).getTime())) return null
  const measured = toNumber(
    pick(value, ['measured_kw', 'mesure_kw', 'consumption_kw', 'measured', 'mesure', 'value', 'kw']),
  )
  const forecast = toNumber(
    pick(value, ['forecast_kw', 'prevision_kw', 'predicted_kw', 'forecast', 'prevision', 'prediction_kw']),
  )
  return { at, measuredKw: measured, forecastKw: forecast }
}

function parseSeries(value: unknown): SeriesPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((point) => parsePoint(point))
    .filter((point): point is SeriesPoint => point !== null)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
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
      savingLabel ?? (savingEur === null ? null : `−${new Intl.NumberFormat('fr-FR').format(savingEur)} €`),
  }
}

function parseSite(value: unknown, index: number): Site | null {
  if (!isObject(value)) return null
  const id =
    toText(pick(value, ['id', 'site_id', 'code', 'site_code'])) ?? `SITE${String(index + 1).padStart(3, '0')}`
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
    capacityKw: toNumber(pick(value, ['capacity_kw', 'capacite_kw', 'capacity'])),
    thresholdKw: toNumber(
      pick(value, [
        'threshold_kw',
        'contractual_threshold_kw',
        'seuil_kw',
        'seuil_contractuel_kw',
        'threshold',
      ]),
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
    peakAt: toText(pick(value, ['peak_at', 'forecast_peak_at', 'horodatage_pointe'])),
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
    capacityKw: toNumber(pick(source, ['total_capacity_kw', 'capacity_kw', 'capacite_totale_kw'])),
    thresholdKw: toNumber(
      pick(source, ['threshold_kw', 'contractual_threshold_kw', 'seuil_kw', 'seuil_contractuel_kw']),
    ),
    peakKw: toNumber(pick(source, ['forecast_peak_kw', 'peak_kw', 'pointe_prevue_kw', 'pointe_kw'])),
    peakAt: toText(pick(source, ['forecast_peak_at', 'peak_at', 'horodatage_pointe'])),
    series,
    comment: toText(pick(source, ['commentaire', 'comment', 'caption', 'insight'])),
    sites,
    source: 'api',
  }

  return buildSummary(summary)
}

/** Attache à chaque site sa dernière consommation réellement mesurée.
 *
 * L'API source renvoie `null` dès qu'un site se tait ; l'API métier garde en
 * mémoire la dernière valeur reçue et la place dans l'enveloppe, à côté du
 * résumé. Elle ne remplace jamais la mesure courante : l'écran doit pouvoir
 * distinguer une mesure de l'instant d'un souvenir.
 */
export function attachLastReadings(summary: ParkSummary, raw: unknown): ParkSummary {
  if (!isObject(raw)) return summary
  return {
    ...summary,
    sites: summary.sites.map((site) => {
      const entry = raw[site.id]
      if (!isObject(entry)) return site
      return {
        ...site,
        lastKnownKw: toNumber(entry.consumption_kw),
        lastKnownAt: toText(entry.at),
      }
    }),
  }
}

/** Titres des alertes de capacité, par gravité. */
const CAPACITY_TITLES: Record<string, string> = {
  critique: 'Capacité dépassée',
  moyenne: 'Capacité bientôt atteinte',
}

/** Transforme une alerte de capacité de l'API métier en alerte du modèle.
 *
 * Le message du serveur dit ce qui se passe ; on y ajoute de quoi en juger :
 * la charge constatée, la capacité du site, et depuis quand l'alerte dure.
 */
function parseCapacityAlert(value: unknown): { siteId: string; alert: Alert } | null {
  if (!isObject(value)) return null
  const siteId = toText(value.site_id)
  const message = toText(value.message)
  if (!siteId || !message) return null

  const severity = toSeverity(value.severity)
  const loadPct = toNumber(value.load_percent)
  const capacityKw = toNumber(value.capacity_kw)
  const raisedAt = toText(value.raised_at)

  const details: string[] = []
  if (loadPct !== null) {
    details.push(
      capacityKw === null
        ? `${formatNumber(loadPct, 1)} % de charge`
        : `${formatNumber(loadPct, 1)} % de ${formatNumber(capacityKw)} kW`,
    )
  }
  // La charge est celle du dernier cycle connu, l'horodatage celui de la levée :
  // deux faits distincts, qu'il ne faut pas présenter comme un seul. « Relevé à »
  // laisserait croire que les deux décrivent le même instant.
  if (raisedAt !== null) details.push(`alerte levée à ${formatTime(raisedAt)}`)

  return {
    siteId,
    alert: {
      // L'horodatage fait partie de l'identité : un changement de gravité est
      // un nouvel événement, et doit remplacer le précédent dans la liste.
      id: `capacite-${siteId}-${raisedAt ?? 'inconnu'}`,
      severity,
      title: CAPACITY_TITLES[severity] ?? 'Capacité',
      // Le message du serveur redirait le titre ; seuls les chiffres
      // permettent de juger, on ne garde qu'eux.
      message: details.length === 0 ? message : `${details.join(', ')}.`,
    },
  }
}

/** Attache aux sites les alertes de capacité calculées par l'API métier.
 *
 * Elles rejoignent les alertes déjà portées par chaque site : le compteur du
 * bandeau, le toast et la liste du panneau les reprennent sans rien de plus.
 */
export function attachCapacityAlerts(summary: ParkSummary, raw: unknown): ParkSummary {
  if (!Array.isArray(raw) || raw.length === 0) return summary

  const bySite = new Map<string, Alert[]>()
  for (const value of raw) {
    const parsed = parseCapacityAlert(value)
    if (!parsed) continue
    const existing = bySite.get(parsed.siteId)
    if (existing) existing.push(parsed.alert)
    else bySite.set(parsed.siteId, [parsed.alert])
  }
  if (bySite.size === 0) return summary

  const sites = summary.sites.map((site) => {
    const added = bySite.get(site.id)
    if (!added) return site
    // Jamais deux fois la même : l'identifiant porte l'horodatage de levée.
    const nouvelles = added.filter((alert) => !site.alerts.some((existing) => existing.id === alert.id))
    return { ...site, alerts: [...site.alerts, ...nouvelles] }
  })

  // Repasser par buildSummary : les compteurs du bandeau et les badges se
  // déduisent des alertes des sites, qui viennent de changer.
  return buildSummary({ ...summary, sites })
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

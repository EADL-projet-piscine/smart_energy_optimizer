/** Gravité d'une alerte. Les valeurs restent en français : ce sont des données, pas des identifiants. */
export type Severity = 'critique' | 'moyenne' | 'info'

/** Un point de mesure, daté. L'horodatage est une chaîne ISO avec son fuseau. */
export type SeriesPoint = {
  at: string
  measuredKw: number | null
  forecastKw: number | null
}

export type Alert = {
  id: string
  severity: Severity
  title: string
  message: string
}

export type Recommendation = {
  id: string
  title: string
  detail: string
  saving: string | null
}

export type Site = {
  id: string
  name: string
  type: string
  readingLabel: string
  currentKw: number | null
  /** Dernière consommation réellement mesurée, et l'instant où elle a été reçue.
   *
   * Optionnelles, et non simplement nulles : elles ne viennent pas du résumé de
   * l'API source mais de l'enveloppe posée par l'API métier. Un back qui ne les
   * fournit pas reste valide, et l'écran doit fonctionner sans elles.
   */
  lastKnownKw?: number | null
  lastKnownAt?: string | null
  forecast2hKw: number | null
  thresholdKw: number | null
  receivedCount: number | null
  expectedCount: number | null
  isTransmitting: boolean
  badge: string | null
  series: SeriesPoint[]
  peakAt: string | null
  comment: string | null
  alerts: Alert[]
  recommendations: Recommendation[]
}

export type ParkSummary = {
  siteCount: number
  lastCollectedAt: string
  consumptionKw: number | null
  changePct: number | null
  coveragePct: number | null
  transmittingCount: number
  totalAlerts: number
  criticalAlerts: number
  mediumAlerts: number
  dailyCostEur: number | null
  co2Tons: number | null
  excludedSites: string[]
  thresholdKw: number | null
  peakKw: number | null
  peakAt: string | null
  series: SeriesPoint[]
  comment: string | null
  sites: Site[]
  source: 'api' | 'demonstration'
}

/** Historique des dernières 24 heures : la somme du parc, et le détail par site. */
export type History = {
  park: SeriesPoint[]
  bySite: Record<string, SeriesPoint[]>
}

/** Détail temps réel d'un site : ce que le résumé ne dit pas. */
export type SiteDetail = {
  at: string | null
  stale: boolean
  dataQuality: string | null
  nullReasons: string[]
  voltageV: number | null
  currentA: number | null
  powerFactor: number | null
  temperatureC: number | null
  humidityPct: number | null
}

export type DetailsBySite = Record<string, SiteDetail>

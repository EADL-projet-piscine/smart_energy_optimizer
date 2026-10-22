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

import { buildSummary } from '../services/format'
import type { ParkSummary, SeriesPoint, Site } from '../services/model'

const PARK_MEASURED = [
  1850, 1780, 1720, 1680, 1710, 1840, 2100, 2420, 2680, 2790, 2860, 2890, 2840, 2780, 2820, 2880, 2847,
]
const PARK_FORECAST = [2847, 2890, 3050, 2920, 2600, 2280, 2020, 1880, 1780]
const SITE2_MEASURED = [520, 490, 460, 440, 450, 490, 560, 660, 740, 790, 820, 840, 810, 790, 800, 830, 812]
const SITE2_FORECAST = [812, 900, 1040, 980, 860, 740, 640, 580, 540]

const SITE_WEIGHTS = [680, 545, 470, 340]
const TOTAL_WEIGHT = 2035

const HOUR_MS = 3_600_000
const SERIES_START = Date.now() - 24 * HOUR_MS

/** Horodatage du point n, au pas horaire depuis il y a 24 heures. */
function atIndex(index: number): string {
  return new Date(SERIES_START + index * HOUR_MS).toISOString()
}

function buildSeries(
  measured: Array<number | null>,
  forecast: Array<number | null>,
  forecastStartIndex: number,
): SeriesPoint[] {
  return Array.from({ length: 25 }, (_, index) => ({
    at: atIndex(index),
    measuredKw: measured[index] ?? null,
    forecastKw: forecast[index - forecastStartIndex] ?? null,
  }))
}

/** Répartit un total entre les sites au prorata de leur poids, sans perdre d'unité. */
function distribute(total: number): number[] {
  const floors = SITE_WEIGHTS.map((weight) => Math.floor((total * weight) / TOTAL_WEIGHT))
  let remainder = total - floors.reduce((sum, value) => sum + value, 0)
  const fractions = SITE_WEIGHTS.map((weight, index) => ({
    index,
    fraction: (total * weight) / TOTAL_WEIGHT - floors[index],
  })).sort((a, b) => b.fraction - a.fraction)

  for (const fraction of fractions) {
    if (remainder <= 0) break
    floors[fraction.index] += 1
    remainder -= 1
  }
  return floors
}

function otherSiteSeries(): SeriesPoint[][] {
  const columns: number[][] = [[], [], [], []]
  const forecasts: number[][] = [[], [], [], []]

  PARK_MEASURED.forEach((value, index) => {
    distribute(value - SITE2_MEASURED[index]).forEach((part, site) => columns[site].push(part))
  })
  PARK_FORECAST.forEach((value, index) => {
    distribute(value - SITE2_FORECAST[index]).forEach((part, site) => forecasts[site].push(part))
  })

  return columns.map((measured, index) => {
    const dayMeasured: Array<number | null> = Array.from({ length: 25 }, () => null)
    measured.forEach((value, hour) => {
      dayMeasured[hour] = value
    })
    return buildSeries(dayMeasured, forecasts[index], PARK_MEASURED.length - 1)
  })
}

/** Série qui s'arrête en cours de journée : site dont le relevé est coupé. */
function interruptedSeries(values: number[]): SeriesPoint[] {
  const measured: Array<number | null> = Array.from({ length: 25 }, () => null)
  values.forEach((value, hour) => {
    measured[hour] = value
  })
  return buildSeries(measured, [], 0)
}

export function demoSummary(): ParkSummary {
  const [site3Series, site5Series, site7Series, site1Series] = otherSiteSeries()
  const forecastStartIndex = PARK_MEASURED.length - 1

  const sites: Site[] = [
    {
      id: 'SITE002',
      name: 'Usine de Charleville',
      type: 'Usine',
      readingLabel: 'relevé horaire',
      currentKw: 812,
      forecast2hKw: 1040,
      thresholdKw: 930,
      receivedCount: 24,
      expectedCount: 24,
      isTransmitting: true,
      badge: null,
      series: buildSeries(
        Array.from({ length: 25 }, (_, hour) => SITE2_MEASURED[hour] ?? null),
        SITE2_FORECAST,
        forecastStartIndex,
      ),
      peakAt: null,
      comment: null,
      alerts: [
        {
          id: 'alert-site002',
          severity: 'critique',
          title: 'Nouvelle alerte critique',
          message: 'SITE002 — dépassement de seuil prévu dans deux heures, 1 040 kW pour un seuil à 930 kW.',
        },
      ],
      recommendations: [
        {
          id: 'reco-site002-four',
          title: 'Décaler le four de recuit après 21 h',
          detail: 'La pointe de 18 h repasse sous le seuil de 930 kW.',
          saving: '−180 €',
        },
        {
          id: 'reco-site002-ventilation',
          title: 'Écrêter la ventilation des halls de 17 h à 19 h',
          detail: 'Effacement d’environ 90 kW sur le créneau critique.',
          saving: '−90 kW',
        },
      ],
    },
    {
      id: 'SITE003',
      name: 'Data center de Reims',
      type: 'Data center',
      readingLabel: 'relevé horaire',
      currentKw: 680,
      forecast2hKw: null,
      thresholdKw: 900,
      receivedCount: 24,
      expectedCount: 24,
      isTransmitting: true,
      badge: null,
      series: site3Series,
      peakAt: null,
      comment: null,
      alerts: [],
      recommendations: [
        {
          id: 'reco-site003',
          title: 'Reporter les lots de calcul non critiques après 20 h',
          detail: 'Le data center reste sous son seuil de 900 kW sur le créneau du soir.',
          saving: '−40 €',
        },
      ],
    },
    {
      id: 'SITE005',
      name: 'Hôpital de Sedan',
      type: 'Hôpital',
      readingLabel: 'relevé horaire',
      currentKw: 545,
      forecast2hKw: null,
      thresholdKw: 700,
      receivedCount: 24,
      expectedCount: 24,
      isTransmitting: true,
      badge: null,
      series: site5Series,
      peakAt: null,
      comment: null,
      alerts: [],
      recommendations: [
        {
          id: 'reco-site005',
          title: 'Lisser le préchauffage de l’eau sanitaire',
          detail: 'Avancer la charge du ballon hors du créneau 17 h–19 h.',
          saving: '−25 €',
        },
      ],
    },
    {
      id: 'SITE007',
      name: 'Usine de Rethel',
      type: 'Usine',
      readingLabel: 'relevé horaire',
      currentKw: 470,
      forecast2hKw: null,
      thresholdKw: 600,
      receivedCount: 24,
      expectedCount: 24,
      isTransmitting: true,
      badge: null,
      series: site7Series,
      peakAt: null,
      comment: null,
      alerts: [],
      recommendations: [
        {
          id: 'reco-site007',
          title: 'Enchaîner les presses après 19 h',
          detail: 'Évite d’additionner leur appel de puissance avec le reste du parc.',
          saving: '−60 kW',
        },
      ],
    },
    {
      id: 'SITE001',
      name: 'Siège de Charleville',
      type: 'Bureau',
      readingLabel: 'relevé horaire',
      currentKw: 340,
      forecast2hKw: null,
      thresholdKw: 450,
      receivedCount: 24,
      expectedCount: 24,
      isTransmitting: true,
      badge: null,
      series: site1Series,
      peakAt: null,
      comment: null,
      alerts: [],
      recommendations: [
        {
          id: 'reco-site001',
          title: 'Couper l’éclairage de façade dès 18 h',
          detail: 'Gain modeste, applicable dès ce soir sans toucher à l’exploitation.',
          saving: '−8 €',
        },
      ],
    },
    {
      id: 'SITE004',
      name: 'Galerie de Charleville',
      type: 'Commerce',
      readingLabel: 'relevé horaire',
      currentKw: null,
      forecast2hKw: null,
      thresholdKw: 400,
      receivedCount: 14,
      expectedCount: 24,
      isTransmitting: false,
      badge: null,
      series: interruptedSeries([180, 170, 165, 160, 170, 190, 230, 280, 320, 340, 350, 330, 300, 260]),
      peakAt: null,
      comment: null,
      alerts: [
        {
          id: 'alert-site004',
          severity: 'moyenne',
          title: 'Relevé interrompu',
          message: 'SITE004 — aucun relevé depuis plus de deux heures. Ce site est exclu du total du parc.',
        },
      ],
      recommendations: [
        {
          id: 'reco-site004',
          title: 'Vérifier la passerelle de télérelève',
          detail: 'Le site ne remonte plus de mesure. Contrôler l’alimentation et le lien radio.',
          saving: null,
        },
      ],
    },
    {
      id: 'SITE006',
      name: 'Agence de Rethel',
      type: 'Bureau',
      readingLabel: 'relevé horaire',
      currentKw: null,
      forecast2hKw: null,
      thresholdKw: 220,
      receivedCount: 14,
      expectedCount: 24,
      isTransmitting: false,
      badge: null,
      series: interruptedSeries([70, 65, 60, 58, 62, 80, 110, 140, 160, 170, 165, 150, 130, 110]),
      peakAt: null,
      comment: null,
      alerts: [
        {
          id: 'alert-site006',
          severity: 'moyenne',
          title: 'Relevé interrompu',
          message: 'SITE006 — aucun relevé depuis plus de deux heures. Ce site est exclu du total du parc.',
        },
      ],
      recommendations: [
        {
          id: 'reco-site006',
          title: 'Contrôler l’alimentation du compteur',
          detail: 'Le relevé est interrompu. Le site reste exclu du total tant que la chaîne de mesure est coupée.',
          saving: null,
        },
      ],
    },
  ]

  return buildSummary({
    siteCount: 7,
    lastCollectedAt: '21:00',
    consumptionKw: 2847,
    changePct: 12,
    coveragePct: null,
    transmittingCount: 5,
    totalAlerts: 0,
    criticalAlerts: 0,
    mediumAlerts: 0,
    dailyCostEur: 4120,
    co2Tons: 1.8,
    excludedSites: ['SITE004', 'SITE006'],
    thresholdKw: 2900,
    peakKw: null,
    peakAt: null,
    series: buildSeries(
      Array.from({ length: 25 }, (_, hour) => PARK_MEASURED[hour] ?? null),
      PARK_FORECAST,
      forecastStartIndex,
    ),
    comment: null,
    sites,
    source: 'demonstration',
  })
}

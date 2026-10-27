/** Opérations sur les séries datées, partagées par l'historique et les prévisions. */

import type { SeriesPoint } from './model'

/** La grandeur portée par un point : ce qui a été mesuré, ou ce qui est prévu. */
type Field = 'measuredKw' | 'forecastKw'

function byDate(a: SeriesPoint, b: SeriesPoint): number {
  return new Date(a.at).getTime() - new Date(b.at).getTime()
}

function point(at: string, field: Field, value: number | null): SeriesPoint {
  return {
    at,
    measuredKw: field === 'measuredKw' ? value : null,
    forecastKw: field === 'forecastKw' ? value : null,
  }
}

/** Somme des sites à horodatage égal.
 *
 * Un horodatage où aucun site n'a de valeur reste à null : zéro serait une
 * mesure, l'absence de mesure n'en est pas une. Un site muet ne doit pas tirer
 * le total du parc vers le bas.
 */
export function sumBySite(bySite: Record<string, SeriesPoint[]>, field: Field): SeriesPoint[] {
  const totals = new Map<string, number | null>()
  for (const series of Object.values(bySite)) {
    for (const item of series) {
      const value = item[field]
      if (value === null) {
        if (!totals.has(item.at)) totals.set(item.at, null)
        continue
      }
      totals.set(item.at, (totals.get(item.at) ?? 0) + value)
    }
  }
  return [...totals.entries()].map(([at, total]) => point(at, field, total)).sort(byDate)
}

/** Réunit mesures et prévisions en une seule série, triée.
 *
 * Les deux ne se chevauchent pas — l'historique s'arrête au présent, les
 * prévisions commencent après — mais si un horodatage leur est commun, le
 * point porte les deux valeurs plutôt que d'apparaître en double.
 */
export function mergeSeries(measured: SeriesPoint[], forecast: SeriesPoint[]): SeriesPoint[] {
  const byMoment = new Map<string, SeriesPoint>()
  for (const item of measured) {
    byMoment.set(item.at, { ...item })
  }
  for (const item of forecast) {
    const existing = byMoment.get(item.at)
    if (existing) {
      existing.forecastKw = item.forecastKw
    } else {
      byMoment.set(item.at, { ...item })
    }
  }
  return [...byMoment.values()].sort(byDate)
}

/** Raccroche la courbe de prévision à la dernière mesure connue.
 *
 * Sans cela, la ligne des prévisions démarre au premier créneau à venir et
 * flotte, détachée de la courbe mesurée : le lecteur voit deux tracés sans
 * lien alors qu'il s'agit de la même consommation, avant et après maintenant.
 *
 * Le point de jonction porte les deux valeurs, strictement égales : on ne
 * prétend rien prévoir, on prolonge la ligne jusqu'à ce qui est déjà constaté.
 */
export function connectForecast(series: SeriesPoint[]): SeriesPoint[] {
  const lastMeasured = series.findLastIndex((item) => item.measuredKw !== null)
  if (lastMeasured === -1) return series

  const hasForecastAhead = series.slice(lastMeasured + 1).some((item) => item.forecastKw !== null)
  if (!hasForecastAhead) return series

  return series.map((item, index) =>
    index === lastMeasured ? { ...item, forecastKw: item.measuredKw } : item,
  )
}

import { describe, expect, it } from 'vitest'
import type { SeriesPoint } from '../../services/model'
import { connectForecast, mergeSeries, sumBySite } from '../../services/series'

function measured(hour: number, value: number | null): SeriesPoint {
  return { at: `2026-10-27T${String(hour).padStart(2, '0')}:00:00Z`, measuredKw: value, forecastKw: null }
}

function forecast(hour: number, value: number): SeriesPoint {
  return { at: `2026-10-27T${String(hour).padStart(2, '0')}:00:00Z`, measuredKw: null, forecastKw: value }
}

describe('sumBySite', () => {
  it('adds the sites sharing a timestamp', () => {
    const total = sumBySite({ A: [measured(10, 10)], B: [measured(10, 20)] }, 'measuredKw')

    expect(total).toEqual([measured(10, 30)])
  })

  it('does not count a missing site as a zero', () => {
    const total = sumBySite({ A: [measured(10, null)], B: [measured(10, 20)] }, 'measuredKw')

    expect(total[0].measuredKw).toBe(20)
  })

  it('keeps a timestamp where no site has a value', () => {
    // The hole stays visible: an absence of measurement is not a zero.
    const total = sumBySite({ A: [measured(10, null)] }, 'measuredKw')

    expect(total).toEqual([measured(10, null)])
  })

  it('sums forecasts just as well', () => {
    const total = sumBySite({ A: [forecast(14, 100)], B: [forecast(14, 50)] }, 'forecastKw')

    expect(total).toEqual([forecast(14, 150)])
  })

  it('sorts chronologically', () => {
    const total = sumBySite({ A: [measured(12, 1), measured(10, 2)] }, 'measuredKw')

    expect(total.map((point) => point.at)).toEqual(['2026-10-27T10:00:00Z', '2026-10-27T12:00:00Z'])
  })
})

describe('mergeSeries', () => {
  it('puts measurements and forecasts on one timeline', () => {
    const merged = mergeSeries([measured(10, 100)], [forecast(14, 120)])

    expect(merged.map((point) => [point.measuredKw, point.forecastKw])).toEqual([
      [100, null],
      [null, 120],
    ])
  })

  it('carries both values on a shared timestamp instead of duplicating the point', () => {
    const merged = mergeSeries([measured(10, 100)], [forecast(10, 120)])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual({ at: '2026-10-27T10:00:00Z', measuredKw: 100, forecastKw: 120 })
  })

  it('sorts the result chronologically', () => {
    const merged = mergeSeries([measured(12, 1)], [forecast(10, 2)])

    expect(merged.map((point) => point.at)).toEqual(['2026-10-27T10:00:00Z', '2026-10-27T12:00:00Z'])
  })

  it('does not alter the series it was given', () => {
    const source = [measured(10, 100)]

    mergeSeries(source, [forecast(10, 120)])

    expect(source[0].forecastKw).toBeNull()
  })

  it('works when one side is empty', () => {
    expect(mergeSeries([], [forecast(14, 120)])).toHaveLength(1)
    expect(mergeSeries([measured(10, 100)], [])).toHaveLength(1)
  })
})

describe('connectForecast', () => {
  it('joins the forecast line to the last measurement', () => {
    // Without this, the forecast line starts in mid-air and reads as a second,
    // unrelated curve.
    const joined = connectForecast([measured(10, 100), forecast(14, 120)])

    expect(joined[0]).toEqual({ at: '2026-10-27T10:00:00Z', measuredKw: 100, forecastKw: 100 })
  })

  it('claims nothing: the junction point repeats the measurement', () => {
    const joined = connectForecast([measured(10, 100), forecast(14, 120)])

    expect(joined[0].forecastKw).toBe(joined[0].measuredKw)
  })

  it('leaves the series alone when no forecast follows', () => {
    const series = [measured(10, 100), measured(11, 110)]

    expect(connectForecast(series)).toBe(series)
  })

  it('leaves the series alone when nothing was measured', () => {
    const series = [forecast(14, 120)]

    expect(connectForecast(series)).toBe(series)
  })

  it('joins at the last measurement, not the first', () => {
    const joined = connectForecast([measured(10, 100), measured(11, 110), forecast(14, 120)])

    expect(joined[0].forecastKw).toBeNull()
    expect(joined[1].forecastKw).toBe(110)
  })

  it('ignores a forecast that precedes the last measurement', () => {
    // A forecast for a slot already measured teaches nothing, and joining to
    // it would draw the line backwards.
    const series = [forecast(9, 90), measured(10, 100)]

    expect(connectForecast(series)).toBe(series)
  })
})

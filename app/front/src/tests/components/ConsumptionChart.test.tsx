import { render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsumptionChart } from '../../components/ConsumptionChart'
import type { SeriesPoint } from '../../services/model'

// Tooltip state, read by the fake Tooltip below.
const tooltip = vi.hoisted(() => ({ active: false, payload: [] as unknown[] }))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    // jsdom has no layout: ResponsiveContainer would measure 0x0 and draw nothing.
    ResponsiveContainer: ({ children }: { children: ReactElement<Record<string, unknown>> }) =>
      cloneElement(children, { width: 600, height: 300 }),
    // Hovering cannot be simulated reliably in jsdom: we render the tooltip content instead.
    Tooltip: ({ content }: { content: ReactElement<Record<string, unknown>> }) =>
      cloneElement(content, { active: tooltip.active, payload: tooltip.payload }),
  }
})

// Local hours (TZ=Europe/Paris, set by the npm scripts): 08:00Z → 10h00.
const SERIES: SeriesPoint[] = [
  { at: '2026-10-21T08:00:00Z', measuredKw: 700, forecastKw: null },
  { at: '2026-10-21T09:00:00Z', measuredKw: 720, forecastKw: null },
  { at: '2026-10-21T10:00:00Z', measuredKw: null, forecastKw: 880 },
  { at: '2026-10-21T11:00:00Z', measuredKw: null, forecastKw: 950 },
]

beforeEach(() => {
  tooltip.active = false
  tooltip.payload = []
})

describe('ConsumptionChart — content', () => {
  it('announces the absence of readings on an empty series', () => {
    render(<ConsumptionChart series={[]} capacityKw={null} />)

    expect(screen.getByText('Aucune mesure disponible sur la période.')).toBeInTheDocument()
  })

  it('draws the chart when the series has points', () => {
    const { container } = render(<ConsumptionChart series={SERIES} capacityKw={null} />)

    expect(container.querySelector('svg.recharts-surface')).not.toBeNull()
    expect(screen.queryByText('Aucune mesure disponible sur la période.')).toBeNull()
  })

  it('scales the time axis in local hours', () => {
    render(<ConsumptionChart series={SERIES} capacityKw={null} />)

    expect(screen.getAllByText(/^\d{2}h(00|\d{2})$/).length).toBeGreaterThan(0)
  })

  it('reserves more height for the full-size chart than for the compact one', () => {
    const full = render(<ConsumptionChart series={SERIES} capacityKw={null} />)
    const compact = render(<ConsumptionChart series={SERIES} capacityKw={null} compact />)

    expect((full.container.firstChild as HTMLElement).style.height).toBe('320px')
    expect((compact.container.firstChild as HTMLElement).style.height).toBe('230px')
  })
})

describe('ConsumptionChart — markers', () => {
  it('displays the capacity when there is one', () => {
    render(<ConsumptionChart series={SERIES} capacityKw={1000} />)

    expect(screen.getByText(/^1\s000 kW$/)).toBeInTheDocument()
  })

  it('invents no capacity when it is missing', () => {
    render(<ConsumptionChart series={SERIES} capacityKw={null} />)

    expect(screen.queryByText(/ kW$/)).toBeNull()
  })

  it('marks the forecast peak on request', () => {
    render(<ConsumptionChart series={SERIES} capacityKw={null} showPeakValue />)

    expect(screen.getByText('950 kW')).toBeInTheDocument()
  })

  it('does not mark the peak by default', () => {
    render(<ConsumptionChart series={SERIES} capacityKw={null} />)

    expect(screen.queryByText('950 kW')).toBeNull()
  })

  it('marks no peak when the series has no forecast at all', () => {
    const measuredOnly = SERIES.slice(0, 2)

    render(<ConsumptionChart series={measuredOnly} capacityKw={null} showPeakValue />)

    expect(screen.queryByText(/ kW$/)).toBeNull()
  })
})

describe('ConsumptionChart — tooltip', () => {
  function showTooltip(point: SeriesPoint) {
    tooltip.active = true
    tooltip.payload = [{ payload: { time: new Date(point.at).getTime(), ...point } }]
    render(<ConsumptionChart series={SERIES} capacityKw={null} />)
  }

  it('stays silent as long as nothing is hovered', () => {
    tooltip.payload = [{ payload: { time: 0, ...SERIES[0] } }]

    render(<ConsumptionChart series={SERIES} capacityKw={null} />)

    expect(screen.queryByText(/700 kW/)).toBeNull()
  })

  it('stays silent when the hover carries no data', () => {
    tooltip.active = true

    render(<ConsumptionChart series={SERIES} capacityKw={null} />)

    expect(screen.queryByText(/ · /)).toBeNull()
  })

  it('gives the reading at the hour under way', () => {
    showTooltip(SERIES[0])

    expect(screen.getByText(/^10h00 · 700 kW$/)).toBeInTheDocument()
  })

  it('states that a value is a forecast', () => {
    showTooltip(SERIES[2])

    expect(screen.getByText(/^12h00 · 880 kW prévus$/)).toBeInTheDocument()
  })

  it('guesses nothing when neither reading nor forecast exists', () => {
    showTooltip({ at: '2026-10-21T09:00:00Z', measuredKw: null, forecastKw: null })

    expect(screen.getByText(/^11h00 · pas de mesure$/)).toBeInTheDocument()
  })

  it('gives the exact minute for the most recent reading only', () => {
    const last: SeriesPoint = { at: '2026-10-21T11:32:00Z', measuredKw: 760, forecastKw: null }
    tooltip.active = true
    tooltip.payload = [{ payload: { time: new Date(last.at).getTime(), ...last } }]

    render(<ConsumptionChart series={[...SERIES.slice(0, 3), last]} capacityKw={null} />)

    expect(screen.getByText(/^13h32 · 760 kW$/)).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsumptionChart } from '../../components/ConsumptionChart'
import type { SeriesPoint } from '../../services/model'

// État de l'infobulle, lu par le faux Tooltip ci-dessous.
const tooltip = vi.hoisted(() => ({ active: false, payload: [] as unknown[] }))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    // jsdom n'a pas de mise en page : ResponsiveContainer mesurerait 0×0 et ne dessinerait rien.
    ResponsiveContainer: ({ children }: { children: ReactElement<Record<string, unknown>> }) =>
      cloneElement(children, { width: 600, height: 300 }),
    // Le survol ne se simule pas de façon fiable en jsdom : on rend le contenu de l'infobulle.
    Tooltip: ({ content }: { content: ReactElement<Record<string, unknown>> }) =>
      cloneElement(content, { active: tooltip.active, payload: tooltip.payload }),
  }
})

// Heures locales (TZ=Europe/Paris, fixé par les scripts npm) : 08:00Z → 10h00.
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

describe('ConsumptionChart — contenu', () => {
  it('annonce l’absence de mesure sur une série vide', () => {
    render(<ConsumptionChart series={[]} thresholdKw={null} />)

    expect(screen.getByText('Aucune mesure disponible sur la période.')).toBeInTheDocument()
  })

  it('dessine le graphique quand la série a des points', () => {
    const { container } = render(<ConsumptionChart series={SERIES} thresholdKw={null} />)

    expect(container.querySelector('svg.recharts-surface')).not.toBeNull()
    expect(screen.queryByText('Aucune mesure disponible sur la période.')).toBeNull()
  })

  it('gradue l’axe du temps en heures locales', () => {
    render(<ConsumptionChart series={SERIES} thresholdKw={null} />)

    expect(screen.getAllByText(/^\d{2}h(00|\d{2})$/).length).toBeGreaterThan(0)
  })

  it('réserve plus de hauteur au graphique pleine taille qu’au graphique compact', () => {
    const full = render(<ConsumptionChart series={SERIES} thresholdKw={null} />)
    const compact = render(<ConsumptionChart series={SERIES} thresholdKw={null} compact />)

    expect((full.container.firstChild as HTMLElement).style.height).toBe('320px')
    expect((compact.container.firstChild as HTMLElement).style.height).toBe('230px')
  })
})

describe('ConsumptionChart — repères', () => {
  it('affiche le seuil contractuel quand il existe', () => {
    render(<ConsumptionChart series={SERIES} thresholdKw={1000} />)

    expect(screen.getByText(/^1\s000 kW$/)).toBeInTheDocument()
  })

  it('n’invente pas de seuil quand il est absent', () => {
    render(<ConsumptionChart series={SERIES} thresholdKw={null} />)

    expect(screen.queryByText(/ kW$/)).toBeNull()
  })

  it('marque la pointe prévue à la demande', () => {
    render(<ConsumptionChart series={SERIES} thresholdKw={null} showPeakValue />)

    expect(screen.getByText('950 kW')).toBeInTheDocument()
  })

  it('ne marque pas la pointe par défaut', () => {
    render(<ConsumptionChart series={SERIES} thresholdKw={null} />)

    expect(screen.queryByText('950 kW')).toBeNull()
  })

  it('ne marque aucune pointe quand la série n’a aucune prévision', () => {
    const measuredOnly = SERIES.slice(0, 2)

    render(<ConsumptionChart series={measuredOnly} thresholdKw={null} showPeakValue />)

    expect(screen.queryByText(/ kW$/)).toBeNull()
  })
})

describe('ConsumptionChart — infobulle', () => {
  function showTooltip(point: SeriesPoint) {
    tooltip.active = true
    tooltip.payload = [{ payload: { time: new Date(point.at).getTime(), ...point } }]
    render(<ConsumptionChart series={SERIES} thresholdKw={null} />)
  }

  it('reste muette tant que rien n’est survolé', () => {
    tooltip.payload = [{ payload: { time: 0, ...SERIES[0] } }]

    render(<ConsumptionChart series={SERIES} thresholdKw={null} />)

    expect(screen.queryByText(/700 kW/)).toBeNull()
  })

  it('reste muette quand le survol ne porte aucune donnée', () => {
    tooltip.active = true

    render(<ConsumptionChart series={SERIES} thresholdKw={null} />)

    expect(screen.queryByText(/ · /)).toBeNull()
  })

  it('donne la mesure à l’heure entamée', () => {
    showTooltip(SERIES[0])

    expect(screen.getByText(/^10h00 · 700 kW$/)).toBeInTheDocument()
  })

  it('précise qu’une valeur est une prévision', () => {
    showTooltip(SERIES[2])

    expect(screen.getByText(/^12h00 · 880 kW prévus$/)).toBeInTheDocument()
  })

  it('ne devine rien quand ni mesure ni prévision n’existent', () => {
    showTooltip({ at: '2026-10-21T09:00:00Z', measuredKw: null, forecastKw: null })

    expect(screen.getByText(/^11h00 · pas de mesure$/)).toBeInTheDocument()
  })

  it('donne la minute exacte pour la mesure la plus récente seulement', () => {
    const last: SeriesPoint = { at: '2026-10-21T11:32:00Z', measuredKw: 760, forecastKw: null }
    tooltip.active = true
    tooltip.payload = [{ payload: { time: new Date(last.at).getTime(), ...last } }]

    render(<ConsumptionChart series={[...SERIES.slice(0, 3), last]} thresholdKw={null} />)

    expect(screen.getByText(/^13h32 · 760 kW$/)).toBeInTheDocument()
  })
})

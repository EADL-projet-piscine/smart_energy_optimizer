import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Caption, Figure, Label, SiteText, Subtitle } from '../../../components/ui/Text'

describe('SiteText', () => {
  it('sets site identifiers in bold', () => {
    render(<SiteText text="Le total exclut SITE004 et SITE006." />)

    expect(screen.getByText('SITE004').tagName).toBe('STRONG')
    expect(screen.getByText('SITE006').tagName).toBe('STRONG')
  })

  it('leaves the rest of the text untouched', () => {
    const { container } = render(<SiteText text="Le total exclut SITE004 et SITE006." />)

    expect(container.textContent).toBe('Le total exclut SITE004 et SITE006.')
  })

  it('does not weigh down a text without an identifier', () => {
    const { container } = render(<SiteText text="Tout va bien." />)

    expect(container.querySelector('strong')).toBeNull()
  })
})

describe('Figure', () => {
  it('displays the value and its unit', () => {
    render(<Figure value="2 847" unit="kW" />)

    expect(screen.getByText('2 847')).toBeInTheDocument()
    expect(screen.getByText('kW')).toBeInTheDocument()
  })

  it('does without a unit when there is none', () => {
    render(<Figure value="—" />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('Label, Caption, Subtitle', () => {
  it('render their content', () => {
    render(
      <>
        <Label>Couverture</Label>
        <Caption>Un commentaire</Caption>
        <Subtitle>Alertes</Subtitle>
      </>,
    )

    expect(screen.getByText('Couverture')).toBeInTheDocument()
    expect(screen.getByText('Un commentaire')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Alertes' })).toBeInTheDocument()
  })
})

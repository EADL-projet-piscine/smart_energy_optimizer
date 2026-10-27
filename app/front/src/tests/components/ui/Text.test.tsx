import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Caption, Figure, Label, SiteText, Subtitle } from '../../../components/ui/Text'

describe('SiteText', () => {
  it('met les identifiants de site en gras', () => {
    render(<SiteText text="Le total exclut SITE004 et SITE006." />)

    expect(screen.getByText('SITE004').tagName).toBe('STRONG')
    expect(screen.getByText('SITE006').tagName).toBe('STRONG')
  })

  it('laisse le reste du texte intact', () => {
    const { container } = render(<SiteText text="Le total exclut SITE004 et SITE006." />)

    expect(container.textContent).toBe('Le total exclut SITE004 et SITE006.')
  })

  it('n’alourdit pas un texte sans identifiant', () => {
    const { container } = render(<SiteText text="Tout va bien." />)

    expect(container.querySelector('strong')).toBeNull()
  })
})

describe('Figure', () => {
  it('affiche la valeur et son unité', () => {
    render(<Figure value="2 847" unit="kW" />)

    expect(screen.getByText('2 847')).toBeInTheDocument()
    expect(screen.getByText('kW')).toBeInTheDocument()
  })

  it('se passe d’unité quand il n’y en a pas', () => {
    render(<Figure value="—" />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('Label, Caption, Subtitle', () => {
  it('rendent leur contenu', () => {
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

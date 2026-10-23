import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Tabs } from '../../../components/ui/Tabs'

const entries = [
  { id: 'SITE001', title: 'SITE001', detail: 'Bureau' },
  { id: 'SITE002', title: 'SITE002', detail: 'Usine' },
  { id: 'SITE003', title: 'SITE003', detail: 'Data center' },
]

function renderTabs(active = 'SITE001') {
  const onSelect = vi.fn()
  render(
    <Tabs entries={entries} active={active} panelId="site-panel" label="Sites du parc" onSelect={onSelect} />,
  )
  return onSelect
}

describe('Tabs', () => {
  it('marque l’onglet actif pour les lecteurs d’écran', () => {
    renderTabs('SITE002')

    expect(screen.getByRole('tab', { name: /SITE002/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /SITE001/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('signale le site choisi au clic', () => {
    const onSelect = renderTabs()

    fireEvent.click(screen.getByRole('tab', { name: /SITE003/ }))

    expect(onSelect).toHaveBeenCalledWith('SITE003')
  })

  it('avance avec la flèche droite', () => {
    const onSelect = renderTabs('SITE001')

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })

    expect(onSelect).toHaveBeenCalledWith('SITE002')
  })

  it('recule avec la flèche gauche', () => {
    const onSelect = renderTabs('SITE002')

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' })

    expect(onSelect).toHaveBeenCalledWith('SITE001')
  })

  it('boucle d’un bout à l’autre', () => {
    // Depuis le dernier onglet, la flèche droite revient au premier : sans
    // cela, la navigation au clavier se bloquerait en bout de liste.
    const onSelect = renderTabs('SITE003')

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })

    expect(onSelect).toHaveBeenCalledWith('SITE001')
  })

  it('ignore les autres touches', () => {
    const onSelect = renderTabs()

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'a' })

    expect(onSelect).not.toHaveBeenCalled()
  })
})

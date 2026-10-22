import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toast } from '../../../components/ui/Toast'

describe('Toast', () => {
  it('affiche le titre et le message', () => {
    render(
      <Toast severity="critique" title="Dépassement prévu" message="1 040 kW" onClose={vi.fn()} />,
    )

    expect(screen.getByText('Dépassement prévu')).toBeInTheDocument()
    expect(screen.getByText('1 040 kW')).toBeInTheDocument()
  })

  it('est annoncé comme une information d’état', () => {
    // role="status" le fait lire par les lecteurs d'écran sans voler le focus.
    render(<Toast severity="moyenne" title="x" message="y" onClose={vi.fn()} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('se ferme sur demande', () => {
    const onClose = vi.fn()
    render(<Toast severity="critique" title="x" message="y" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /Fermer/ }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('propose le détail quand une action est fournie', () => {
    const onDetail = vi.fn()
    render(<Toast severity="critique" title="x" message="y" onClose={vi.fn()} onDetail={onDetail} />)

    fireEvent.click(screen.getByRole('button', { name: 'Voir le détail' }))

    expect(onDetail).toHaveBeenCalledOnce()
  })

  it('masque le détail quand aucune action n’est fournie', () => {
    render(<Toast severity="info" title="x" message="y" onClose={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Voir le détail' })).not.toBeInTheDocument()
  })
})

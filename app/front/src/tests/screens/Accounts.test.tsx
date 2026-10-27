import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../api/client'
import { Accounts, changesOf } from '../../screens/Accounts'
import type { ManagedAccount } from '../../services/accounts'
import { useAccounts } from '../../services/useAccounts'

vi.mock('../../services/useAccounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/useAccounts')>()),
  useAccounts: vi.fn(),
}))

const ADMIN: ManagedAccount = {
  id: 'u-admin',
  email: 'admin@example.com',
  displayName: 'Admin',
  isActive: true,
  role: 'admin',
  siteIds: [],
}
const VIEWER: ManagedAccount = {
  id: 'u-viewer',
  email: 'ada@example.com',
  displayName: 'Ada',
  isActive: true,
  role: 'viewer',
  siteIds: ['SITE001'],
}
const SITES = [
  { id: 'SITE001', name: 'Paris', clientId: 'u-viewer' },
  { id: 'SITE002', name: 'Lyon', clientId: null },
]

const create = vi.fn()
const update = vi.fn()

function mockAccounts(overrides: Partial<ReturnType<typeof useAccounts>> = {}) {
  vi.mocked(useAccounts).mockReturnValue({
    data: { accounts: [ADMIN, VIEWER], sites: SITES },
    error: null,
    create,
    update,
    ...overrides,
  })
}

beforeEach(() => {
  create.mockReset().mockResolvedValue(undefined)
  update.mockReset().mockResolvedValue(undefined)
  mockAccounts()
})

function newAccountForm() {
  return screen.getByRole('button', { name: 'Créer le compte' }).closest('form') as HTMLFormElement
}

describe('Accounts', () => {
  it('lists the accounts with their role and sites', () => {
    render(<Accounts currentUserId="u-admin" onBack={vi.fn()} />)

    expect(screen.getByText('2 comptes')).toBeInTheDocument()
    expect(screen.getByText(/ada@example.com · Lecteur · SITE001/)).toBeInTheDocument()
    expect(screen.getByText(/admin@example.com · Administrateur · Tout le parc/)).toBeInTheDocument()
  })

  it('announces loading, then a refusal', () => {
    mockAccounts({ data: null })
    const { rerender } = render(<Accounts currentUserId="u-admin" onBack={vi.fn()} />)
    expect(screen.getByText('Chargement des comptes…')).toBeInTheDocument()

    mockAccounts({ data: null, error: 'Réservé aux administrateurs.' })
    rerender(<Accounts currentUserId="u-admin" onBack={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Réservé aux administrateurs.')
  })

  it('goes back to the dashboard', () => {
    const onBack = vi.fn()
    render(<Accounts currentUserId="u-admin" onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retour au tableau de bord' }))

    expect(onBack).toHaveBeenCalledOnce()
  })

  it('creates a viewer with the chosen sites', async () => {
    render(<Accounts currentUserId="u-admin" onBack={vi.fn()} />)
    const form = within(newAccountForm())

    fireEvent.change(form.getByLabelText('Adresse e-mail'), { target: { value: ' bob@example.com ' } })
    fireEvent.change(form.getByLabelText('Nom affiché'), { target: { value: 'Bob' } })
    fireEvent.change(form.getByLabelText('Mot de passe'), { target: { value: 'correct horse battery' } })
    fireEvent.click(form.getByLabelText('Lyon'))
    expect(form.getByText(/client actuel : Ada/)).toBeInTheDocument()
    fireEvent.submit(newAccountForm())

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        email: 'bob@example.com',
        displayName: 'Bob',
        password: 'correct horse battery',
        role: 'viewer',
        siteIds: ['SITE002'],
      }),
    )
  })

  it('shows the refusal of the API next to the form', async () => {
    create.mockRejectedValue(new HttpError(409, 'Un compte existe déjà avec cet e-mail.'))
    render(<Accounts currentUserId="u-admin" onBack={vi.fn()} />)
    const form = within(newAccountForm())
    fireEvent.change(form.getByLabelText('Rôle'), { target: { value: 'operator' } })

    expect(form.getByText('Un exploitant voit tout le parc.')).toBeInTheDocument()
    fireEvent.submit(newAccountForm())

    expect(await form.findByRole('alert')).toHaveTextContent('Un compte existe déjà avec cet e-mail.')
  })

  it('edits an account and sends only what changed', async () => {
    render(<Accounts currentUserId="u-admin" onBack={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Modifier Ada' }))
    const form = within(
      screen.getByRole('button', { name: 'Enregistrer' }).closest('form') as HTMLFormElement,
    )
    fireEvent.click(form.getByLabelText('Compte actif'))
    fireEvent.click(form.getByLabelText('Lyon'))
    fireEvent.click(form.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('u-viewer', { isActive: false, siteIds: ['SITE001', 'SITE002'] }),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument())
  })

  it('cannot remove the rights of the signed-in admin', () => {
    render(<Accounts currentUserId="u-admin" onBack={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Modifier Admin' }))
    const form = within(
      screen.getByRole('button', { name: 'Enregistrer' }).closest('form') as HTMLFormElement,
    )

    expect(form.getByLabelText('Rôle')).toBeDisabled()
    expect(form.getByLabelText('Compte actif')).toBeDisabled()
    fireEvent.click(form.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument()
  })
})

describe('changesOf', () => {
  const values = {
    email: VIEWER.email,
    displayName: VIEWER.displayName,
    password: '',
    role: VIEWER.role ?? 'viewer',
    isActive: true,
    siteIds: ['SITE001'],
  }

  it('is empty when nothing changed, whatever the order of the sites', () => {
    expect(
      changesOf(
        { ...VIEWER, siteIds: ['SITE002', 'SITE001'] },
        { ...values, siteIds: ['SITE001', 'SITE002'] },
      ),
    ).toEqual({})
  })

  it('clears the sites of an account that now sees the whole fleet', () => {
    expect(
      changesOf(VIEWER, {
        ...values,
        role: 'operator',
        displayName: ' Ada L. ',
        password: 'new passphrase!',
      }),
    ).toEqual({
      role: 'operator',
      siteIds: [],
      displayName: 'Ada L.',
      password: 'new passphrase!',
    })
  })
})

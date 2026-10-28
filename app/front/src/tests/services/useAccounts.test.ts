import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../api/client'
import { createAccount, loadAccounts, updateAccount } from '../../services/accounts'
import { accountError, useAccounts } from '../../services/useAccounts'

vi.mock('../../services/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/accounts')>()),
  loadAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
}))

const DATA = { accounts: [], sites: [{ id: 'SITE001', name: 'Paris', clientId: null }] }

afterEach(() => {
  vi.mocked(loadAccounts).mockReset()
  vi.mocked(createAccount).mockReset()
  vi.mocked(updateAccount).mockReset()
})

describe('useAccounts', () => {
  it('loads the accounts and the sites', async () => {
    vi.mocked(loadAccounts).mockResolvedValue(DATA)

    const { result } = renderHook(() => useAccounts())

    await waitFor(() => expect(result.current.data).toEqual(DATA))
    expect(result.current.error).toBeNull()
  })

  it('reports a refusal with the message of the API', async () => {
    vi.mocked(loadAccounts).mockRejectedValue(new HttpError(403, 'Réservé aux administrateurs.'))

    const { result } = renderHook(() => useAccounts())

    await waitFor(() => expect(result.current.error).toBe('Réservé aux administrateurs.'))
  })

  it('reloads after a creation and after a change', async () => {
    vi.mocked(loadAccounts).mockResolvedValue(DATA)
    const { result } = renderHook(() => useAccounts())
    await waitFor(() => expect(result.current.data).not.toBeNull())
    vi.mocked(createAccount).mockResolvedValue({} as never)
    vi.mocked(updateAccount).mockResolvedValue({} as never)

    await act(() =>
      result.current.create({
        email: 'a@b.fr',
        displayName: 'A',
        password: 'p',
        role: 'viewer',
        siteIds: [],
      }),
    )
    await act(() => result.current.update('u-1', { isActive: false }))

    expect(updateAccount).toHaveBeenCalledWith('u-1', { isActive: false })
    expect(loadAccounts).toHaveBeenCalledTimes(3)
  })

  it('lets a failed change reach the form', async () => {
    vi.mocked(loadAccounts).mockResolvedValue(DATA)
    const { result } = renderHook(() => useAccounts())
    await waitFor(() => expect(result.current.data).not.toBeNull())
    vi.mocked(updateAccount).mockRejectedValue(new HttpError(409, 'Conflit'))

    await expect(act(() => result.current.update('u-1', {}))).rejects.toThrow('Statut 409')
  })
})

describe('accountError', () => {
  it.each([
    [new HttpError(409, 'Un compte existe déjà avec cet e-mail.'), 'Un compte existe déjà avec cet e-mail.'],
    [new HttpError(422), 'Valeur refusée : vérifiez les champs.'],
    [new HttpError(503), 'L’API métier ne répond pas.'],
    [new Error('Aborted'), 'L’API métier ne répond pas.'],
  ])('explains %s', (cause, message) => {
    expect(accountError(cause)).toBe(message)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'
import {
  createAccount,
  loadAccounts,
  normalizeAccount,
  normalizeAccounts,
  updateAccount,
} from '../../services/accounts'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  fetchJson: vi.fn(),
}))

afterEach(() => {
  vi.mocked(fetchJson).mockReset()
})

const RAW_VIEWER = {
  id: 'u-1',
  email: 'ada@example.com',
  display_name: 'Ada',
  is_active: true,
  roles: ['viewer'],
  site_ids: ['SITE001'],
}

describe('normalizeAccounts', () => {
  it('reads accounts and sites', () => {
    const data = normalizeAccounts({
      comptes: [RAW_VIEWER],
      sites: [
        { site_id: 'SITE001', site_name: 'Paris', client_user_id: 'u-1' },
        { site_id: 'SITE002', site_name: '', client_user_id: null },
      ],
    })

    expect(data.accounts).toEqual([
      {
        id: 'u-1',
        email: 'ada@example.com',
        displayName: 'Ada',
        isActive: true,
        role: 'viewer',
        siteIds: ['SITE001'],
      },
    ])
    expect(data.sites).toEqual([
      { id: 'SITE001', name: 'Paris', clientId: 'u-1' },
      { id: 'SITE002', name: 'SITE002', clientId: null },
    ])
  })

  it('drops entries without an identifier and survives an unexpected payload', () => {
    expect(normalizeAccounts({ comptes: [{ email: 'x@y.fr' }], sites: [{}] })).toEqual({
      accounts: [],
      sites: [],
    })
    expect(normalizeAccounts(null)).toEqual({ accounts: [], sites: [] })
  })

  it('reads an unknown role as no role and a missing name as the e-mail', () => {
    expect(normalizeAccount({ id: 'u-2', email: 'b@c.fr', roles: ['root'], is_active: false })).toMatchObject(
      {
        displayName: 'b@c.fr',
        role: null,
        isActive: false,
        siteIds: [],
      },
    )
  })
})

describe('requests', () => {
  it('loads the accounts', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ comptes: [RAW_VIEWER], sites: [] })

    await expect(loadAccounts()).resolves.toMatchObject({ accounts: [{ id: 'u-1' }] })
    expect(fetchJson).toHaveBeenCalledWith('/api/comptes', undefined)
  })

  it('creates a viewer with its sites', async () => {
    vi.mocked(fetchJson).mockResolvedValue(RAW_VIEWER)

    await createAccount({
      email: 'ada@example.com',
      displayName: 'Ada',
      password: 'correct horse battery',
      role: 'viewer',
      siteIds: ['SITE001'],
    })

    expect(fetchJson).toHaveBeenCalledWith('/api/comptes', undefined, 'POST', {
      email: 'ada@example.com',
      display_name: 'Ada',
      password: 'correct horse battery',
      role: 'viewer',
      site_ids: ['SITE001'],
    })
  })

  it('does not send sites for a role that sees the whole fleet', async () => {
    vi.mocked(fetchJson).mockResolvedValue(RAW_VIEWER)

    await createAccount({
      email: 'a@b.fr',
      displayName: 'A',
      password: 'p'.repeat(12),
      role: 'admin',
      siteIds: ['SITE001'],
    })

    expect(vi.mocked(fetchJson).mock.calls[0][3]).toMatchObject({ site_ids: [] })
  })

  it('sends only the changed fields, and never an empty password', async () => {
    vi.mocked(fetchJson).mockResolvedValue(RAW_VIEWER)

    await updateAccount('u/1', {
      isActive: false,
      role: 'operator',
      siteIds: [],
      displayName: 'Bob',
      password: '',
    })

    expect(fetchJson).toHaveBeenCalledWith('/api/comptes/u%2F1', undefined, 'PATCH', {
      is_active: false,
      role: 'operator',
      site_ids: [],
      display_name: 'Bob',
    })
  })

  it('sends a new password', async () => {
    vi.mocked(fetchJson).mockResolvedValue(RAW_VIEWER)

    await updateAccount('u-1', { password: 'a brand new passphrase' })

    expect(vi.mocked(fetchJson).mock.calls[0][3]).toEqual({ password: 'a brand new passphrase' })
  })
})

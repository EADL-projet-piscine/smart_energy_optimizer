import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, HttpError } from '../../api/client'
import { loadSession, normalizeSession, signIn, signOut } from '../../services/session'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  fetchJson: vi.fn(),
}))

afterEach(() => {
  vi.mocked(fetchJson).mockReset()
})

const VIEWER = {
  auth_enabled: true,
  user: {
    id: 'u-1',
    email: 'ada@example.com',
    display_name: 'Ada',
    roles: ['viewer'],
    site_ids: ['SITE001', 'SITE003'],
  },
}

describe('normalizeSession', () => {
  it('reads a signed-in viewer', () => {
    expect(normalizeSession(VIEWER)).toEqual({
      authEnabled: true,
      account: {
        id: 'u-1',
        email: 'ada@example.com',
        displayName: 'Ada',
        roles: ['viewer'],
        siteIds: ['SITE001', 'SITE003'],
      },
    })
  })

  it('reads null site_ids as the whole fleet', () => {
    const admin = { ...VIEWER, user: { ...VIEWER.user, roles: ['admin'], site_ids: null } }

    expect(normalizeSession(admin).account?.siteIds).toBeNull()
  })

  it('has no account when authentication is disabled', () => {
    expect(normalizeSession({ auth_enabled: false, user: { id: null } })).toEqual({
      authEnabled: false,
      account: null,
    })
  })

  it('falls back on the e-mail when the display name is missing', () => {
    const user = { id: 'u-2', email: 'bob@example.com', roles: 'not-a-list' }

    expect(normalizeSession({ auth_enabled: true, user }).account).toMatchObject({
      displayName: 'bob@example.com',
      roles: [],
    })
  })

  it('survives an unexpected payload', () => {
    expect(normalizeSession(null)).toEqual({ authEnabled: false, account: null })
  })
})

describe('loadSession', () => {
  it('returns the session described by the API', async () => {
    vi.mocked(fetchJson).mockResolvedValue(VIEWER)

    await expect(loadSession()).resolves.toMatchObject({ authEnabled: true })
    expect(fetchJson).toHaveBeenCalledWith('/api/auth/me', undefined)
  })

  it('returns null when the API asks for a login', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new HttpError(401))

    await expect(loadSession()).resolves.toBeNull()
  })

  it('lets any other failure through', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new HttpError(503))

    await expect(loadSession()).rejects.toThrow('Statut 503')
  })
})

describe('signIn and signOut', () => {
  it('posts the credentials', async () => {
    vi.mocked(fetchJson).mockResolvedValue(null)

    await signIn('ada@example.com', 'secret')

    expect(fetchJson).toHaveBeenCalledWith('/api/auth/login', undefined, 'POST', {
      email: 'ada@example.com',
      password: 'secret',
    })
  })

  it('posts the logout', async () => {
    vi.mocked(fetchJson).mockResolvedValue(null)

    await signOut()

    expect(fetchJson).toHaveBeenCalledWith('/api/auth/logout', undefined, 'POST')
  })
})

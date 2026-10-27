import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNAUTHORIZED_EVENT } from '../../api/client'
import { type Account, loadSession, SessionNotKeptError, signIn, signOut } from '../../services/session'
import { useSession } from '../../services/useSession'

vi.mock('../../services/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/session')>()),
  loadSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

const ACCOUNT: Account = {
  id: 'u-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  roles: ['viewer'],
  siteIds: ['SITE001'],
}

afterEach(() => {
  vi.mocked(loadSession).mockReset()
  vi.mocked(signIn).mockReset()
  vi.mocked(signOut).mockReset()
})

describe('useSession', () => {
  it('waits for the API before deciding anything', () => {
    vi.mocked(loadSession).mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useSession())

    expect(result.current.state).toEqual({ status: 'loading' })
  })

  it('shows the dashboard to a signed-in user', async () => {
    vi.mocked(loadSession).mockResolvedValue({ authEnabled: true, account: ACCOUNT })

    const { result } = renderHook(() => useSession())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', account: ACCOUNT }))
  })

  it('shows the dashboard without an account when the API is open', async () => {
    vi.mocked(loadSession).mockResolvedValue({ authEnabled: false, account: null })

    const { result } = renderHook(() => useSession())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', account: null }))
  })

  it('asks for a login when the API requires one', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)

    const { result } = renderHook(() => useSession())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'signed-out' }))
  })

  it('leaves the dashboard to report an API that does not answer', async () => {
    // An older back without /api/auth/me, or a back that is down: the dashboard
    // already says it, the login screen would wrongly blame the user.
    vi.mocked(loadSession).mockRejectedValue(new Error('Statut 404'))

    const { result } = renderHook(() => useSession())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', account: null }))
  })

  it('goes back to the login screen when a session expires', async () => {
    vi.mocked(loadSession).mockResolvedValue({ authEnabled: true, account: ACCOUNT })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    })

    expect(result.current.state).toEqual({ status: 'signed-out' })
  })

  it('signs in, then reads the session back', async () => {
    vi.mocked(loadSession).mockResolvedValueOnce(null)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.state.status).toBe('signed-out'))
    vi.mocked(signIn).mockResolvedValue()
    vi.mocked(loadSession).mockResolvedValueOnce({ authEnabled: true, account: ACCOUNT })

    await act(() => result.current.login('ada@example.com', 'secret'))

    expect(signIn).toHaveBeenCalledWith('ada@example.com', 'secret')
    expect(result.current.state).toEqual({ status: 'ready', account: ACCOUNT })
  })

  it('reports a session the browser did not keep', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.state.status).toBe('signed-out'))
    vi.mocked(signIn).mockResolvedValue()

    await expect(act(() => result.current.login('ada@example.com', 'secret'))).rejects.toBeInstanceOf(
      SessionNotKeptError,
    )
  })

  it('signs out even when the API does not answer', async () => {
    vi.mocked(loadSession).mockResolvedValue({ authEnabled: true, account: ACCOUNT })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    vi.mocked(signOut).mockRejectedValue(new Error('Statut 503'))

    await act(() => result.current.logout())

    expect(result.current.state).toEqual({ status: 'signed-out' })
  })
})

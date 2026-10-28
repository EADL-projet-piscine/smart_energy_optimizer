import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, HttpError, UNAUTHORIZED_EVENT } from '../../api/client'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Never settles on its own: it only rejects once the request signal is aborted.
function hangingFetch(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

describe('fetchJson', () => {
  it('asks for JSON at the configured base URL', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test/')
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))

    await expect(fetchJson('/health')).resolves.toEqual({ status: 'ok' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/health')
    expect(init).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' } })
  })

  it('calls a relative path when no base URL is configured', async () => {
    vi.stubEnv('VITE_API_URL', '')
    fetchMock.mockResolvedValue(jsonResponse([]))

    await fetchJson('/api/consommations', undefined, 'POST')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/consommations')
    expect(init).toMatchObject({ method: 'POST' })
  })

  it('calls a relative path when VITE_API_URL is not defined at all', async () => {
    // The default in development: no variable, therefore no prefix, and the
    // call goes through the Vite proxy. Distinct from the empty string.
    vi.stubEnv('VITE_API_URL', undefined)
    fetchMock.mockResolvedValue(jsonResponse({}))

    await fetchJson('/api/consommations')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/consommations')
  })

  it('rejects an error status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Service indisponible' }, 503))

    await expect(fetchJson('/health')).rejects.toThrow('Statut 503')
  })

  it('sends the session cookie with every call', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))

    await fetchJson('/api/consommations')

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
  })

  it('sends a JSON body when one is given', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(
      fetchJson('/api/auth/login', undefined, 'POST', { email: 'a@b.fr', password: 'secret' }),
    ).resolves.toBeNull()

    const init = fetchMock.mock.calls[0][1]
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.fr', password: 'secret' }),
    })
  })

  it('announces a 401 and rejects with its status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Authentification requise.' }, 401))
    const listener = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, listener)

    const outcome = await fetchJson('/api/consommations').catch((cause: unknown) => cause)

    window.removeEventListener(UNAUTHORIZED_EVENT, listener)
    expect(outcome).toBeInstanceOf(HttpError)
    expect((outcome as HttpError).status).toBe(401)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('keeps the message the API gives with an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Un compte existe déjà avec cet e-mail.' }, 409))

    const outcome = await fetchJson('/api/comptes', undefined, 'POST', {}).catch((cause: unknown) => cause)

    expect((outcome as HttpError).detail).toBe('Un compte existe déjà avec cet e-mail.')
  })

  it.each([
    ['a validation error list', jsonResponse({ detail: [{ msg: 'field required' }] }, 422)],
    ['a body that is not JSON', new Response('<html>Bad Gateway</html>', { status: 502 })],
  ])('has no message for %s', async (_label, response) => {
    fetchMock.mockResolvedValue(response)

    const outcome = await fetchJson('/api/comptes').catch((cause: unknown) => cause)

    expect((outcome as HttpError).detail).toBeNull()
  })

  it('sends a PATCH', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))

    await fetchJson('/api/comptes/u-1', undefined, 'PATCH', { is_active: false })

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH', body: '{"is_active":false}' })
  })

  it('does not announce other errors as a lost session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403))
    const listener = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, listener)

    await expect(fetchJson('/api/consommations/sites/SITE009')).rejects.toThrow('Statut 403')

    window.removeEventListener(UNAUTHORIZED_EVENT, listener)
    expect(listener).not.toHaveBeenCalled()
  })

  it('gives up after three seconds', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(hangingFetch)

    const outcome = expect(fetchJson('/health')).rejects.toThrow('Aborted')
    await vi.advanceTimersByTimeAsync(3000)

    await outcome
  })

  it('stops when the caller aborts', async () => {
    fetchMock.mockImplementation(hangingFetch)
    const caller = new AbortController()

    const request = fetchJson('/health', caller.signal)
    caller.abort()

    await expect(request).rejects.toThrow('Aborted')
  })
})

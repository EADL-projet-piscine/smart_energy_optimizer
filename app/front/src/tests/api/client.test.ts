import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'

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

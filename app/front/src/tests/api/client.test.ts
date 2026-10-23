import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Ne se termine jamais seul : ne rejette que lorsque le signal de la requête est interrompu.
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
  it('demande du JSON à l’URL de base configurée', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test/')
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))

    await expect(fetchJson('/health')).resolves.toEqual({ status: 'ok' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/health')
    expect(init).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' } })
  })

  it('appelle un chemin relatif quand aucune URL de base n’est configurée', async () => {
    vi.stubEnv('VITE_API_URL', '')
    fetchMock.mockResolvedValue(jsonResponse([]))

    await fetchJson('/api/consommation/resume', undefined, 'POST')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/consommation/resume')
    expect(init).toMatchObject({ method: 'POST' })
  })

  it('rejette un statut d’erreur', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Service indisponible' }, 503))

    await expect(fetchJson('/health')).rejects.toThrow('Statut 503')
  })

  it('abandonne au bout de trois secondes', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(hangingFetch)

    const outcome = expect(fetchJson('/health')).rejects.toThrow('Aborted')
    await vi.advanceTimersByTimeAsync(3000)

    await outcome
  })

  it('s’arrête quand l’appelant annule', async () => {
    fetchMock.mockImplementation(hangingFetch)
    const caller = new AbortController()

    const request = fetchJson('/health', caller.signal)
    caller.abort()

    await expect(request).rejects.toThrow('Aborted')
  })
})

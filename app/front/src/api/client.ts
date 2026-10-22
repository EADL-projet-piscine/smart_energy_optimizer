const TIMEOUT_MS = 3000

export async function fetchJson(
  path: string,
  signal?: AbortSignal,
  method: 'GET' | 'POST' = 'GET',
): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)

  try {
    const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
    const response = await fetch(`${base}${path}`, {
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Statut ${response.status}`)
    return (await response.json()) as unknown
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

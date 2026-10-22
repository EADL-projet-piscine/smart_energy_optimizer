const DELAI_MS = 3000

export async function fetchJson(
  chemin: string,
  signal?: AbortSignal,
  methode: 'GET' | 'POST' = 'GET',
): Promise<unknown> {
  const controle = new AbortController()
  const timer = window.setTimeout(() => controle.abort(), DELAI_MS)
  const interrompre = () => controle.abort()
  signal?.addEventListener('abort', interrompre)

  try {
    const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
    const reponse = await fetch(`${base}${chemin}`, {
      method: methode,
      signal: controle.signal,
      headers: { Accept: 'application/json' },
    })
    if (!reponse.ok) throw new Error(`Statut ${reponse.status}`)
    return (await reponse.json()) as unknown
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', interrompre)
  }
}

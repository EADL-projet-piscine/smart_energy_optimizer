const TIMEOUT_MS = 3000

/** Émis quand l'API répond 401 : la session est absente ou vient d'expirer.
 * L'application l'écoute pour réafficher l'écran de connexion. */
export const UNAUTHORIZED_EVENT = 'enervision:unauthorized'

/** Réponse HTTP en erreur, avec son statut : l'appelant distingue un 401 d'une panne. */
export class HttpError extends Error {
  readonly status: number
  /** Le message de l'API (`detail`), quand elle en donne un en texte. */
  readonly detail: string | null

  constructor(status: number, detail: string | null = null) {
    super(`Statut ${status}`)
    this.status = status
    this.detail = detail
  }
}

/** Le `detail` d'une réponse en erreur de FastAPI ; rien si le corps n'en a pas. */
async function detailOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    return typeof body.detail === 'string' ? body.detail : null
  } catch {
    return null
  }
}

export async function fetchJson(
  path: string,
  signal?: AbortSignal,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
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
      // Le cookie de session accompagne chaque appel : l'API est servie depuis la
      // même origine que le dashboard (proxy de Vite en développement, nginx sinon).
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    if (!response.ok) throw new HttpError(response.status, await detailOf(response))
    // 204 : réponse sans corps (connexion, déconnexion).
    if (response.status === 204) return null
    return (await response.json()) as unknown
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

import { fetchJson, HttpError } from '../api/client'

/** L'utilisateur connecté, tel que le décrit `GET /api/auth/me`. */
export type Account = {
  id: string
  email: string
  displayName: string
  roles: string[]
  /** `null` : tous les sites du parc. */
  siteIds: string[] | null
}

export type Session = {
  /** Faux quand l'API est ouverte : le dashboard s'affiche sans connexion. */
  authEnabled: boolean
  /** Absent quand l'authentification est désactivée. */
  account: Account | null
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Lit la réponse de `/api/auth/me`, sans faire confiance à sa forme. */
export function normalizeSession(payload: unknown): Session {
  const body = (payload ?? {}) as Record<string, unknown>
  const authEnabled = body.auth_enabled === true
  const user = (body.user ?? {}) as Record<string, unknown>
  const id = stringOf(user.id)
  if (!authEnabled || id === null) return { authEnabled, account: null }

  const email = stringOf(user.email) ?? ''
  return {
    authEnabled,
    account: {
      id,
      email,
      displayName: stringOf(user.display_name) ?? email,
      roles: stringsOf(user.roles),
      siteIds: Array.isArray(user.site_ids) ? stringsOf(user.site_ids) : null,
    },
  }
}

/** La session en cours, ou `null` si l'API exige une connexion. */
export async function loadSession(signal?: AbortSignal): Promise<Session | null> {
  try {
    return normalizeSession(await fetchJson('/api/auth/me', signal))
  } catch (cause) {
    if (cause instanceof HttpError && cause.status === 401) return null
    throw cause
  }
}

/** Connexion acceptée par l'API, mais le navigateur n'a pas renvoyé le cookie :
 * typiquement un cookie `Secure` refusé sur un site servi en HTTP. */
export class SessionNotKeptError extends Error {
  constructor() {
    super('Session non conservée par le navigateur')
  }
}

/** Ouvre une session : le serveur pose un cookie que le dashboard ne lit jamais. */
export async function signIn(email: string, password: string): Promise<void> {
  await fetchJson('/api/auth/login', undefined, 'POST', { email, password })
}

export async function signOut(): Promise<void> {
  await fetchJson('/api/auth/logout', undefined, 'POST')
}

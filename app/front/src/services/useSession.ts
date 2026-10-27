import { useCallback, useEffect, useState } from 'react'
import { UNAUTHORIZED_EVENT } from '../api/client'
import { type Account, loadSession, SessionNotKeptError, signIn, signOut } from './session'

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  /** `account` est absent quand l'API est ouverte, ou quand elle n'a pas pu le dire :
   * le dashboard s'affiche alors comme avant et signale lui-même une API muette. */
  | { status: 'ready'; account: Account | null }

/** Décide de ce que l'application affiche : l'écran de connexion ou le dashboard.
 *
 * Toute réponse 401 d'un autre appel (session expirée en cours de route) ramène à
 * l'écran de connexion, via l'événement émis par le client HTTP.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const session = await loadSession(signal)
      if (signal?.aborted) return
      setState(session ? { status: 'ready', account: session.account } : { status: 'signed-out' })
    } catch {
      if (signal?.aborted) return
      setState({ status: 'ready', account: null })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    const onUnauthorized = () => setState({ status: 'signed-out' })
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  /** Les erreurs remontent à l'appelant : c'est l'écran de connexion qui les affiche. */
  const login = useCallback(async (email: string, password: string) => {
    await signIn(email, password)
    // Relire la session prouve que le navigateur a gardé le cookie.
    const session = await loadSession()
    if (!session) throw new SessionNotKeptError()
    setState({ status: 'ready', account: session.account })
  }, [])

  const logout = useCallback(async () => {
    try {
      await signOut()
    } catch {
      // Même si l'API ne répond pas : l'utilisateur a demandé à partir, et le
      // cookie expirera de lui-même.
    }
    setState({ status: 'signed-out' })
  }, [])

  return { state, login, logout }
}

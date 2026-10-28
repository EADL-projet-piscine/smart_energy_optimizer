import { useCallback, useEffect, useState } from 'react'
import { HttpError } from '../api/client'
import {
  type AccountChanges,
  type AccountsData,
  createAccount,
  loadAccounts,
  type NewAccount,
  updateAccount,
} from './accounts'

/** Message affichable d'un échec : celui de l'API quand elle en donne un. */
export function accountError(cause: unknown): string {
  if (cause instanceof HttpError && cause.detail) return cause.detail
  if (cause instanceof HttpError && cause.status === 422) return 'Valeur refusée : vérifiez les champs.'
  return 'L’API métier ne répond pas.'
}

/** Charge les comptes et les sites, et recharge après chaque modification.
 *
 * Recharger plutôt que modifier la liste localement : rattacher un site à un compte
 * le retire à son client précédent, et seul le serveur connaît tous les effets.
 */
export function useAccounts() {
  const [data, setData] = useState<AccountsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const loaded = await loadAccounts(signal)
      if (signal?.aborted) return
      setData(loaded)
      setError(null)
    } catch (cause) {
      if (signal?.aborted) return
      setError(accountError(cause))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void reload(controller.signal)
    return () => controller.abort()
  }, [reload])

  /** Les erreurs remontent au formulaire, qui les affiche à côté des champs. */
  const create = useCallback(
    async (account: NewAccount) => {
      await createAccount(account)
      await reload()
    },
    [reload],
  )

  const update = useCallback(
    async (id: string, changes: AccountChanges) => {
      await updateAccount(id, changes)
      await reload()
    },
    [reload],
  )

  return { data, error, create, update }
}

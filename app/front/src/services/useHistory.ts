import { useEffect, useState } from 'react'
import { loadHistory } from './history'
import type { History } from './model'

// L'historique est au pas horaire : le rafraîchir plus souvent ne montrerait rien
// de neuf, et la source régénère ses valeurs à chaque appel — la courbe sauterait.
const REFRESH_INTERVAL_MS = 300_000

export function useHistory() {
  const [history, setHistory] = useState<History | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    function refresh() {
      loadHistory(controller.signal)
        .then((received) => {
          if (controller.signal.aborted) return
          setError(null)
          setHistory(received)
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return
          setError(cause instanceof Error ? cause.message : 'Historique indisponible')
        })
    }

    refresh()
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS)

    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  return { history, error }
}

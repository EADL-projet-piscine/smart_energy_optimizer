import { useCallback, useEffect, useState } from 'react'
import type { ParkSummary } from './model'
import { loadSummary } from './summary'

const REFRESH_INTERVAL_MS = 10_000

/** Site sélectionné au premier chargement : le plus critique, sinon le premier. */
function initialSiteId(summary: ParkSummary): string | null {
  return (
    summary.sites.find((site) => site.alerts.some((alert) => alert.severity === 'critique'))?.id ??
    summary.sites[0]?.id ??
    null
  )
}

export function useSummary() {
  const [summary, setSummary] = useState<ParkSummary | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback((keepSiteId: string | null, signal?: AbortSignal) => {
    setLoading(true)
    loadSummary(signal)
      .then((received) => {
        if (signal?.aborted) return
        setError(null)
        setSummary(received)
        setSiteId((current) =>
          keepSiteId && received.sites.some((site) => site.id === keepSiteId)
            ? keepSiteId
            : current && received.sites.some((site) => site.id === current)
              ? current
              : initialSiteId(received),
        )
      })
      .catch((cause: unknown) => {
        if (signal?.aborted) return
        // Aucun repli sur des données inventées : le dernier résumé réellement
        // reçu reste affiché, et `error` signale qu'il n'est plus rafraîchi.
        setError(cause instanceof Error ? cause.message : 'API injoignable')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    refresh(null, controller.signal)

    const timer = window.setInterval(() => refresh(null, controller.signal), REFRESH_INTERVAL_MS)

    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [refresh])

  return { summary, error, loading, siteId, setSiteId, refresh }
}

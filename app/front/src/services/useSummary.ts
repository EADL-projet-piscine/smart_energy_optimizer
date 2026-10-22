import { useEffect, useState } from 'react'
import { toIsoUtc } from './format'
import type { ParkSummary } from './model'
import { loadSummary } from './summary'

/** Cadence de repli quand le serveur n'annonce pas sa prochaine mesure. */
const FALLBACK_MS = 60_000
/** Marge après l'heure annoncée, pour ne pas arriver une seconde trop tôt. */
const SAFETY_MS = 2_000
/** Garde-fou contre une rafale si le serveur annonce une heure déjà passée. */
const MIN_DELAY_MS = 5_000

/** Site sélectionné au premier chargement : le plus critique, sinon le premier. */
function initialSiteId(summary: ParkSummary): string | null {
  return (
    summary.sites.find((site) => site.alerts.some((alert) => alert.severity === 'critique'))?.id ??
    summary.sites[0]?.id ??
    null
  )
}

/** Délai avant le prochain appel, calé sur l'heure annoncée par le serveur. */
function delayUntil(nextAt: string | null): number {
  if (!nextAt) return FALLBACK_MS
  const target = new Date(toIsoUtc(nextAt)).getTime()
  if (Number.isNaN(target)) return FALLBACK_MS
  const wait = target - Date.now() + SAFETY_MS
  return Math.min(Math.max(wait, MIN_DELAY_MS), FALLBACK_MS)
}

export function useSummary() {
  const [summary, setSummary] = useState<ParkSummary | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer = 0

    function schedule(nextAt: string | null) {
      if (controller.signal.aborted) return
      timer = window.setTimeout(refresh, delayUntil(nextAt))
    }

    function refresh() {
      setLoading(true)
      loadSummary(controller.signal)
        .then(({ summary: received, nextAt }) => {
          if (controller.signal.aborted) return
          setError(null)
          setSummary(received)
          setSiteId((current) =>
            current && received.sites.some((site) => site.id === current)
              ? current
              : initialSiteId(received),
          )
          schedule(nextAt)
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return
          // Aucun repli sur des données inventées : le dernier résumé réellement
          // reçu reste affiché, et `error` signale qu'il n'est plus rafraîchi.
          setError(cause instanceof Error ? cause.message : 'API injoignable')
          schedule(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }

    refresh()

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [])

  return { summary, error, loading, siteId, setSiteId }
}

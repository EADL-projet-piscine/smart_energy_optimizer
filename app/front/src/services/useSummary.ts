import { useEffect, useState } from 'react'
import { loadDetails } from './details'
import { toIsoUtc } from './format'
import type { DetailsBySite, ParkSummary } from './model'
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

/** Message affichable d'une cause de rejet. Rien ne garantit qu'un rejet porte
 * une `Error` : une promesse peut être rejetée avec n'importe quelle valeur. */
function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

/** Charge l'état temps réel du parc : le résumé et le détail de chaque site.
 *
 * Les deux endpoints sont rafraîchis par la même boucle côté serveur. Les
 * charger dans le même cycle garantit que le chiffre affiché et son
 * explication décrivent le même instant.
 */
export function useSummary() {
  const [summary, setSummary] = useState<ParkSummary | null>(null)
  const [details, setDetails] = useState<DetailsBySite>({})
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
      // allSettled et non all : un détail indisponible ne doit pas faire
      // disparaître le dashboard entier.
      Promise.allSettled([loadSummary(controller.signal), loadDetails(controller.signal)])
        .then(([summaryResult, detailsResult]) => {
          if (controller.signal.aborted) return

          if (summaryResult.status === 'fulfilled') {
            const { summary: received, nextAt } = summaryResult.value
            setError(null)
            setSummary(received)
            setSiteId((current) =>
              current && received.sites.some((site) => site.id === current)
                ? current
                : initialSiteId(received),
            )
            schedule(nextAt)
          } else {
            // Aucun repli sur des données inventées : le dernier résumé
            // réellement reçu reste affiché, et `error` signale qu'il n'est
            // plus rafraîchi.
            setError(messageOf(summaryResult.reason, 'API injoignable'))
            schedule(null)
          }

          // Le détail est un complément : son échec n'efface pas ce qu'on a déjà.
          if (detailsResult.status === 'fulfilled') setDetails(detailsResult.value)
        })
        .catch((cause: unknown) => {
          // allSettled ne rejette jamais : un rejet ici vient du traitement
          // ci-dessus, donc d'un défaut de code ou d'une réponse hors contrat.
          // Sans ce catch il disparaîtrait en silence et l'écran resterait vide
          // sans rien signaler.
          if (controller.signal.aborted) return
          setError(messageOf(cause, 'Erreur inattendue'))
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

  return { summary, details, error, loading, siteId, setSiteId }
}

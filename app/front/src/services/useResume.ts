import { useCallback, useEffect, useState } from 'react'
import { demoSummary } from '../donnees/demonstration'
import type { ParkSummary } from './modele'
import { loadSummary } from './summary'

const INTERVALLE_MS = 10_000

function siteInitial(summary: ParkSummary): string | null {
  return (
    summary.sites.find((site) => site.alerts.some((alert) => alert.severity === 'critique'))?.id ??
    summary.sites[0]?.id ??
    null
  )
}

export function useResume() {
  const [summary, setResume] = useState<ParkSummary | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)

  const actualiser = useCallback((conserverSite: string | null, annulation?: AbortSignal) => {
    setChargement(true)
    loadSummary(annulation)
      .then((recu) => {
        if (annulation?.aborted) return
        setResume(recu)
        setSiteId((current) =>
          conserverSite && recu.sites.some((site) => site.id === conserverSite)
            ? conserverSite
            : current && recu.sites.some((site) => site.id === current)
              ? current
              : siteInitial(recu),
        )
      })
      .catch(() => {
        if (annulation?.aborted) return
        setResume((current) => (current?.source === 'api' ? current : demoSummary()))
      })
      .finally(() => {
        if (!annulation?.aborted) setChargement(false)
      })
  }, [])

  useEffect(() => {
    const controle = new AbortController()
    actualiser(null, controle.signal)

    const minuterie = window.setInterval(() => actualiser(null, controle.signal), INTERVALLE_MS)

    return () => {
      controle.abort()
      window.clearInterval(minuterie)
    }
  }, [actualiser])

  return { summary, siteId, setSiteId, chargement, actualiser }
}

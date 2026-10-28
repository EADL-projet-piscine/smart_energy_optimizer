import { useEffect, useState } from 'react'
import { loadForecasts } from './forecasts'
import type { Forecasts } from './model'

// Même cadence que l'historique : les deux séries sont tracées ensemble, et
// les rafraîchir séparément ferait apparaître une prévision plus récente que
// la mesure qu'elle prolonge. Le modèle ne produit au mieux qu'une fois par
// heure : rafraîchir plus souvent ne montrerait rien de neuf.
const REFRESH_INTERVAL_MS = 300_000

export function useForecasts() {
  const [forecasts, setForecasts] = useState<Forecasts | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    function refresh() {
      loadForecasts(controller.signal)
        .then((received) => {
          if (controller.signal.aborted) return
          setError(null)
          setForecasts(received)
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return
          setError(cause instanceof Error ? cause.message : 'Prévisions indisponibles')
        })
    }

    refresh()
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS)

    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  return { forecasts, error }
}

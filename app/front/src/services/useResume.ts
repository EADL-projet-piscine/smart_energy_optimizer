import { useCallback, useEffect, useState } from 'react'
import { resumeDemonstration } from '../donnees/demonstration'
import type { ResumeParc } from './modele'
import { chargerResume } from './resume'

function siteInitial(resume: ResumeParc): string | null {
  return (
    resume.sites.find((site) => site.alertes.some((alerte) => alerte.severite === 'critique'))?.id ??
    resume.sites[0]?.id ??
    null
  )
}

export function useResume() {
  const [resume, setResume] = useState<ResumeParc | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)

  const actualiser = useCallback((conserverSite: string | null, annulation?: AbortSignal) => {
    setChargement(true)
    chargerResume(annulation)
      .then((recu) => {
        if (annulation?.aborted) return
        setResume(recu)
        setSiteId((actuel) =>
          conserverSite && recu.sites.some((site) => site.id === conserverSite)
            ? conserverSite
            : actuel && recu.sites.some((site) => site.id === actuel)
              ? actuel
              : siteInitial(recu),
        )
      })
      .catch(() => {
        if (annulation?.aborted) return
        setResume((actuel) => (actuel?.source === 'api' ? actuel : resumeDemonstration()))
      })
      .finally(() => {
        if (!annulation?.aborted) setChargement(false)
      })
  }, [])

  useEffect(() => {
    const controle = new AbortController()
    actualiser(null, controle.signal)
    return () => controle.abort()
  }, [actualiser])

  return { resume, siteId, setSiteId, chargement, actualiser }
}

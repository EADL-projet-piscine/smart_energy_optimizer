import { useCallback, useEffect, useState } from 'react'
import { chargerResume } from '../api/resume'
import { resumeDemonstration } from '../donnees/demonstration'
import { formaterCollecte, formaterNombre, libelleAlertes, libelleSites } from '../format'
import type { ResumeParc } from '../modele'
import { DetailSite } from './DetailSite'
import { GraphiqueConsommation } from './GraphiqueConsommation'
import { IconeActualiser, IconeEclair, IconeLune, IconeSoleil } from './Icones'
import { Anneau } from './ui/Anneau'
import { Banniere } from './ui/Banniere'
import { BoutonIcone } from './ui/BoutonIcone'
import { Carte } from './ui/Carte'
import { Indicateur } from './ui/Indicateur'
import { Legende } from './ui/Legende'
import { Libelle, TexteSites } from './ui/Texte'

function siteInitial(resume: ResumeParc): string | null {
  return (
    resume.sites.find((site) => site.alertes.some((alerte) => alerte.severite === 'critique'))?.id ??
    resume.sites[0]?.id ??
    null
  )
}

export function TableauDeBord() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  const [resume, setResume] = useState<ResumeParc | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)

  const appliquer = useCallback((recu: ResumeParc, conserverSite: string | null) => {
    setResume(recu)
    setSiteId(conserverSite && recu.sites.some((site) => site.id === conserverSite) ? conserverSite : siteInitial(recu))
  }, [])

  const actualiser = useCallback(
    (conserverSite: string | null, annulation?: AbortSignal) => {
      setChargement(true)
      chargerResume(annulation)
        .then((recu) => {
          if (annulation?.aborted) return
          appliquer(recu, conserverSite)
        })
        .catch(() => {
          if (annulation?.aborted) return
          setResume((actuel) => (actuel?.source === 'api' ? actuel : resumeDemonstration()))
        })
        .finally(() => {
          if (!annulation?.aborted) setChargement(false)
        })
    },
    [appliquer],
  )

  useEffect(() => {
    const controle = new AbortController()
    actualiser(null, controle.signal)
    return () => controle.abort()
  }, [actualiser])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('enervision-theme', theme)
  }, [theme])

  const messageExclusion =
    resume && resume.sitesExclus.length > 0
      ? `Le total du parc exclut ${resume.sitesExclus.join(' et ')}, sans relevé depuis plus de deux heures. La consommation réelle est donc supérieure à la valeur affichée.`
      : null

  return (
    <div className="mx-auto w-[min(1180px,calc(100%-40px))] pt-[22px] pb-16 max-[680px]:w-[min(1180px,calc(100%-24px))]">
      <header className="mb-7 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-lg font-[650] tracking-[-0.02em]">
          <span className="grid size-7 place-items-center text-mesure [&_svg]:size-[22px]">
            <IconeEclair />
          </span>
          <span>EnerVision</span>
        </div>
        <div className="flex gap-1 rounded-[14px] border border-bordure bg-pilule p-1 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
          <BoutonIcone
            onClick={() => setTheme((actuel) => (actuel === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
          >
            {theme === 'dark' ? <IconeSoleil /> : <IconeLune />}
          </BoutonIcone>
          <BoutonIcone
            onClick={() => actualiser(siteId)}
            disabled={chargement}
            aria-label={
              resume?.source === 'demonstration'
                ? 'Actualiser. L’API est indisponible, la maquette est affichée.'
                : 'Actualiser les données'
            }
          >
            <IconeActualiser className={chargement ? 'animate-spin motion-reduce:animate-none' : undefined} />
            <span
              className={`absolute top-1.5 right-1.5 size-[7px] rounded-full shadow-[0_0_0_2px_var(--pilule)] ${
                resume?.source === 'demonstration' ? 'bg-ambre' : 'bg-hausse'
              }`}
            />
          </BoutonIcone>
        </div>
      </header>

      <main>
        <div>
          <h1 className="m-0 text-[32px] font-[650] tracking-[-0.035em] max-[680px]:text-[26px]">
            Vue d’ensemble du parc
          </h1>
          <p className="mt-1.5 text-sm text-discret">
            {resume
              ? `${libelleSites(resume.nombreSites)} · dernière collecte à ${formaterCollecte(resume.derniereCollecte) || '—'}`
              : 'Chargement des sites…'}
          </p>
        </div>

        {resume ? (
          <>
            <section
              className="mt-[22px] grid grid-cols-1 gap-3.5 min-[681px]:grid-cols-2 min-[981px]:grid-cols-4"
              aria-label="Indicateurs du parc"
            >
              <Indicateur
                libelle="Consommation actuelle"
                valeur={resume.consommationKw === null ? '—' : formaterNombre(resume.consommationKw)}
                unite={resume.consommationKw === null ? undefined : 'kW'}
                taille="lg"
                detail={
                  resume.variationPct !== null && (
                    <span className={resume.variationPct >= 0 ? 'text-hausse' : 'text-danger'}>
                      {resume.variationPct >= 0 ? '↑' : '↓'} {formaterNombre(Math.abs(resume.variationPct))} % sur une
                      heure
                    </span>
                  )
                }
              />

              <article className="flex min-h-[124px] items-center gap-4 rounded-2xl border border-bordure bg-carte px-[18px] pt-[18px] pb-4 shadow-[0_1px_0_rgba(255,255,255,0.02)]">
                <Anneau pourcentage={resume.couverturePct ?? 0} />
                <div>
                  <Libelle>Couverture</Libelle>
                  <p className="mt-1.5 max-w-[12em] text-[15px] leading-snug text-encre">
                    {resume.sitesTransmettant > 1
                      ? `${formaterNombre(resume.sitesTransmettant)} sites sur ${formaterNombre(resume.nombreSites)} transmettent`
                      : `${formaterNombre(resume.sitesTransmettant)} site sur ${formaterNombre(resume.nombreSites)} transmet`}
                  </p>
                </div>
              </article>

              <Indicateur
                libelle="Alertes en cours"
                valeur={formaterNombre(resume.alertesTotal)}
                ton="danger"
                taille="lg"
                detail={libelleAlertes(resume.alertesCritiques, resume.alertesMoyennes)}
              />

              <Indicateur
                libelle="Coût du jour"
                valeur={resume.coutJourEur === null ? '—' : formaterNombre(resume.coutJourEur)}
                unite={resume.coutJourEur === null ? undefined : '€'}
                taille="lg"
                detail={resume.co2Tonnes === null ? '—' : `${formaterNombre(resume.co2Tonnes, 1)} t CO₂ équivalent`}
              />
            </section>

            {messageExclusion && (
              <Banniere>
                <TexteSites texte={messageExclusion} />
              </Banniere>
            )}

            <Carte aria-labelledby="titre-courbe">
              <header className="flex items-start justify-between gap-4 max-[680px]:flex-col">
                <h2 id="titre-courbe" className="m-0 text-base font-[650] tracking-[-0.02em]">
                  Consommation et prévision
                </h2>
                <Legende
                  entrees={[
                    { libelle: 'Mesuré', style: 'mesure' },
                    { libelle: 'Prévision', style: 'prevision' },
                    { libelle: 'Seuil contractuel', style: 'seuil' },
                  ]}
                />
              </header>
              <GraphiqueConsommation serie={resume.serie} seuilKw={resume.seuilKw} afficherValeurPointe />
              {resume.commentaire && <p className="mt-1 text-[13px] leading-snug text-discret">{resume.commentaire}</p>}
            </Carte>

            <DetailSite sites={resume.sites} siteId={siteId ?? ''} onChoisir={setSiteId} />
          </>
        ) : (
          <p className="mt-1.5 text-sm text-discret">Lecture du résumé du parc…</p>
        )}
      </main>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { chargerResume } from '../api/resume'
import { resumeDemonstration } from '../donnees/demonstration'
import { formaterCollecte, formaterNombre, libelleAlertes, libelleSites } from '../format'
import type { ResumeParc } from '../modele'
import { DetailSite } from './DetailSite'
import { GraphiqueConsommation } from './GraphiqueConsommation'
import { IconeActualiser, IconeAttention, IconeEclair, IconeLune, IconeSoleil } from './Icones'

function siteInitial(resume: ResumeParc): string | null {
  return (
    resume.sites.find((site) => site.alertes.some((alerte) => alerte.severite === 'critique'))?.id ??
    resume.sites[0]?.id ??
    null
  )
}

function TexteSites({ texte }: { texte: string }) {
  const morceaux = texte.split(/(SITE\d+)/g)
  return morceaux.map((morceau, index) =>
    /^SITE\d+$/.test(morceau) ? <strong key={`${morceau}-${index}`}>{morceau}</strong> : <span key={index}>{morceau}</span>,
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
    <div className="page">
      <header className="barre">
        <div className="marque">
          <span className="logo">
            <IconeEclair />
          </span>
          <span>EnerVision</span>
        </div>
        <div className="actions-barre">
          <button
            type="button"
            onClick={() => setTheme((actuel) => (actuel === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
          >
            {theme === 'dark' ? <IconeSoleil /> : <IconeLune />}
          </button>
          <button
            type="button"
            onClick={() => actualiser(siteId)}
            disabled={chargement}
            aria-label={
              resume?.source === 'demonstration'
                ? 'Actualiser. L’API est indisponible, la maquette est affichée.'
                : 'Actualiser les données'
            }
          >
            <IconeActualiser className={chargement ? 'tourne' : undefined} />
            <span className={resume?.source === 'demonstration' ? 'pastille-source demo' : 'pastille-source api'} />
          </button>
        </div>
      </header>

      <main>
        <div className="intro">
          <h1>Vue d’ensemble du parc</h1>
          <p>
            {resume
              ? `${libelleSites(resume.nombreSites)} · dernière collecte à ${formaterCollecte(resume.derniereCollecte) || '—'}`
              : 'Chargement des sites…'}
          </p>
        </div>

        {resume ? (
          <>
            <section className="grille-kpi" aria-label="Indicateurs du parc">
              <article className="carte kpi">
                <p className="libelle">Consommation actuelle</p>
                <p className="chiffre xl">
                  <span>{resume.consommationKw === null ? '—' : formaterNombre(resume.consommationKw)}</span>
                  {resume.consommationKw !== null && <small>kW</small>}
                </p>
                {resume.variationPct !== null && (
                  <p className={resume.variationPct >= 0 ? 'variation hausse' : 'variation baisse'}>
                    {resume.variationPct >= 0 ? '↑' : '↓'} {formaterNombre(Math.abs(resume.variationPct))} % sur une
                    heure
                  </p>
                )}
              </article>

              <article className="carte kpi couverture">
                <Anneau pourcentage={resume.couverturePct ?? 0} />
                <div>
                  <p className="libelle">Couverture</p>
                  <p className="couverture-texte">
                    {resume.sitesTransmettant > 1
                      ? `${formaterNombre(resume.sitesTransmettant)} sites sur ${formaterNombre(resume.nombreSites)} transmettent`
                      : `${formaterNombre(resume.sitesTransmettant)} site sur ${formaterNombre(resume.nombreSites)} transmet`}
                  </p>
                </div>
              </article>

              <article className="carte kpi">
                <p className="libelle">Alertes en cours</p>
                <p className="chiffre xl danger">
                  <span>{formaterNombre(resume.alertesTotal)}</span>
                </p>
                <p className="sous-texte">{libelleAlertes(resume.alertesCritiques, resume.alertesMoyennes)}</p>
              </article>

              <article className="carte kpi">
                <p className="libelle">Coût du jour</p>
                <p className="chiffre xl">
                  <span>{resume.coutJourEur === null ? '—' : formaterNombre(resume.coutJourEur)}</span>
                  {resume.coutJourEur !== null && <small>€</small>}
                </p>
                <p className="sous-texte">
                  {resume.co2Tonnes === null ? '—' : `${formaterNombre(resume.co2Tonnes, 1)} t CO₂ équivalent`}
                </p>
              </article>
            </section>

            {messageExclusion && (
              <div className="banniere" role="status">
                <IconeAttention />
                <p>
                  <TexteSites texte={messageExclusion} />
                </p>
              </div>
            )}

            <section className="carte" aria-labelledby="titre-courbe">
              <header className="carte-entete">
                <h2 id="titre-courbe">Consommation et prévision</h2>
                <ul className="legende">
                  <li>
                    <span className="trait mesure" /> Mesuré
                  </li>
                  <li>
                    <span className="trait prevision" /> Prévision
                  </li>
                  <li>
                    <span className="trait seuil" /> Seuil contractuel
                  </li>
                </ul>
              </header>
              <GraphiqueConsommation
                serie={resume.serie}
                seuilKw={resume.seuilKw}
                afficherValeurPointe
              />
              {resume.commentaire && <p className="commentaire">{resume.commentaire}</p>}
            </section>

            <DetailSite sites={resume.sites} siteId={siteId ?? ''} onChoisir={setSiteId} />
          </>
        ) : (
          <p className="chargement">Lecture du résumé du parc…</p>
        )}
      </main>
    </div>
  )
}

function Anneau({ pourcentage }: { pourcentage: number }) {
  const rayon = 26
  const circonference = 2 * Math.PI * rayon
  const borne = Math.min(100, Math.max(0, pourcentage))
  const offset = circonference * (1 - borne / 100)
  return (
    <div className="anneau" aria-hidden="true">
      <svg viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={rayon} className="anneau-piste" />
        <circle
          cx="36"
          cy="36"
          r={rayon}
          className="anneau-valeur"
          strokeDasharray={circonference}
          strokeDashoffset={offset}
        />
      </svg>
      <p>
        <strong>{formaterNombre(Math.round(borne))}</strong>
        <span>%</span>
      </p>
    </div>
  )
}

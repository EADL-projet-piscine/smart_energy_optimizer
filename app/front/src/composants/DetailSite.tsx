import { useEffect, useState, type KeyboardEvent } from 'react'
import { formaterKw, formaterNombre } from '../format'
import type { Alerte, Site } from '../modele'
import { GraphiqueConsommation } from './GraphiqueConsommation'
import { IconeAttention, IconeFermer } from './Icones'

type Props = {
  sites: Site[]
  siteId: string
  onChoisir: (id: string) => void
}

function classeBadge(badge: string): string {
  const texte = badge.toLowerCase()
  if (texte.includes('interrompu')) return 'badge ambre'
  if (texte.includes('stable') || texte.includes('nominal')) return 'badge ok'
  return 'badge alerte'
}

function alertePrincipale(site: Site): Alerte | null {
  return site.alertes.find((alerte) => alerte.severite === 'critique') ?? site.alertes[0] ?? null
}

export function DetailSite({ sites, siteId, onChoisir }: Props) {
  const site = sites.find((candidat) => candidat.id === siteId) ?? sites[0]
  const [toastFerme, setToastFerme] = useState(false)
  const [misEnEvidence, setMisEnEvidence] = useState(false)

  useEffect(() => {
    setToastFerme(false)
    setMisEnEvidence(false)
  }, [site?.id])

  if (!site) {
    return (
      <section className="carte">
        <h2>Détail par site</h2>
        <p className="commentaire">Aucun site n’est disponible dans le résumé.</p>
      </section>
    )
  }

  const principale = alertePrincipale(site)
  const autres = site.alertes.filter((alerte) => alerte !== principale || toastFerme)
  const prevuDepasse = site.seuilKw !== null && site.prevu2hKw !== null && site.prevu2hKw > site.seuilKw
  const mesuresCompletes =
    site.mesuresRecues !== null &&
    site.mesuresAttendues !== null &&
    site.mesuresAttendues > 0 &&
    site.mesuresRecues >= site.mesuresAttendues
  const mesuresPartielles =
    site.mesuresRecues !== null && site.mesuresAttendues !== null && site.mesuresRecues < site.mesuresAttendues

  function deplacerOnglet(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = sites.findIndex((candidat) => candidat.id === site.id)
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const suivant = sites[(index + delta + sites.length) % sites.length]
    onChoisir(suivant.id)
    document.getElementById(`onglet-${suivant.id}`)?.focus()
  }

  function voirDetail() {
    document.getElementById(`bloc-actions-${site.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setMisEnEvidence(true)
    window.setTimeout(() => setMisEnEvidence(false), 1800)
  }

  return (
    <section className="carte detail-site" aria-labelledby="titre-detail">
      <h2 id="titre-detail">Détail par site</h2>
      <div className="onglets" role="tablist" aria-label="Sites du parc" onKeyDown={deplacerOnglet}>
        {sites.map((candidat) => {
          const actif = candidat.id === site.id
          return (
            <button
              key={candidat.id}
              type="button"
              role="tab"
              id={`onglet-${candidat.id}`}
              aria-selected={actif}
              aria-controls="panneau-site"
              className={actif ? 'onglet actif' : 'onglet'}
              onClick={() => onChoisir(candidat.id)}
            >
              <span className="onglet-id">{candidat.id}</span>
              <span className="onglet-type">{candidat.type}</span>
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id="panneau-site" aria-labelledby={`onglet-${site.id}`} className="panneau-site">
        <header className="entete-site">
          <div>
            <h3>{site.nom}</h3>
            <p>
              {site.type} · {site.releve}
            </p>
          </div>
          {site.badge && <span className={classeBadge(site.badge)}>{site.badge}</span>}
        </header>

        <div className="grille-site">
          <article className="kpi-site">
            <p className="libelle">Actuel</p>
            <p className="chiffre">
              <span>{formaterKw(site.actuelKw)}</span>
              {site.actuelKw !== null && <small>kW</small>}
            </p>
          </article>
          <article className="kpi-site">
            <p className="libelle">Prévu +2 h</p>
            <p className={prevuDepasse ? 'chiffre danger' : 'chiffre'}>
              <span>{formaterKw(site.prevu2hKw)}</span>
              {site.prevu2hKw !== null && <small>kW</small>}
            </p>
          </article>
          <article className="kpi-site">
            <p className="libelle">Seuil contractuel</p>
            <p className="chiffre">
              <span>{formaterKw(site.seuilKw)}</span>
              {site.seuilKw !== null && <small>kW</small>}
            </p>
          </article>
          <article className="kpi-site">
            <p className="libelle">Mesures reçues</p>
            <p
              className={
                mesuresCompletes ? 'chiffre ok' : mesuresPartielles ? 'chiffre ambre' : 'chiffre'
              }
            >
              <span>
                {site.mesuresRecues === null || site.mesuresAttendues === null
                  ? '—'
                  : `${formaterNombre(site.mesuresRecues)}/${formaterNombre(site.mesuresAttendues)}`}
              </span>
            </p>
          </article>
        </div>

        <div className="graphique-cadre">
          <GraphiqueConsommation serie={site.serie} seuilKw={site.seuilKw} compact />
          {principale && !toastFerme && (
            <aside className={`toast ${principale.severite}`} role="status">
              <button type="button" className="fermer" onClick={() => setToastFerme(true)} aria-label="Fermer l’alerte">
                <IconeFermer />
              </button>
              <div className="toast-icone">
                <IconeAttention />
              </div>
              <div>
                <p className="toast-titre">{principale.titre}</p>
                <p className="toast-message">{principale.message}</p>
                <button type="button" className="lien" onClick={voirDetail}>
                  Voir le détail
                </button>
              </div>
            </aside>
          )}
        </div>
        {site.commentaire && <p className="commentaire">{site.commentaire}</p>}

        <div
          id={`bloc-actions-${site.id}`}
          className={misEnEvidence ? 'actions-site mis-en-evidence' : 'actions-site'}
        >
          {autres.length > 0 && (
            <div>
              <h4>Alertes</h4>
              <ul className="liste-alertes">
                {autres.map((alerte) => (
                  <li key={alerte.id} className={alerte.severite}>
                    <strong>{alerte.titre}</strong>
                    <p>{alerte.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4>Recommandations</h4>
            {site.recommandations.length === 0 ? (
              <p className="commentaire">Aucune recommandation pour ce site.</p>
            ) : (
              <ul className="recommandations">
                {site.recommandations.map((recommandation, index) => (
                  <li key={recommandation.id}>
                    <span className="pastille">{index + 1}</span>
                    <div>
                      <strong>{recommandation.titre}</strong>
                      <p>{recommandation.detail}</p>
                    </div>
                    {recommandation.economie && <em>{recommandation.economie}</em>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

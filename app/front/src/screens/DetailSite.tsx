import { useEffect, useState } from 'react'
import { GraphiqueConsommation } from '../composants/GraphiqueConsommation'
import { Badge, tonBadge } from '../composants/ui/Badge'
import { Carte } from '../composants/ui/Carte'
import { Indicateur } from '../composants/ui/Indicateur'
import { Ligne, Liste, Pastille } from '../composants/ui/Ligne'
import { Onglets } from '../composants/ui/Onglets'
import { Commentaire, SousTitre } from '../composants/ui/Texte'
import { Toast } from '../composants/ui/Toast'
import { cn } from '../composants/ui/cn'
import { formaterKw, formaterNombre } from '../services/format'
import type { Alerte, Site } from '../services/modele'

type Props = {
  sites: Site[]
  siteId: string
  onChoisir: (id: string) => void
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
      <Carte>
        <h2 className="m-0 text-base font-[650] tracking-[-0.02em]">Détail par site</h2>
        <Commentaire>Aucun site n’est disponible dans le résumé.</Commentaire>
      </Carte>
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
  const tonMesures = mesuresCompletes ? 'ok' : mesuresPartielles ? 'ambre' : 'defaut'

  function voirDetail() {
    document.getElementById(`bloc-actions-${site.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setMisEnEvidence(true)
    window.setTimeout(() => setMisEnEvidence(false), 1800)
  }

  return (
    <Carte aria-labelledby="titre-detail" className="pb-[18px]">
      <h2 id="titre-detail" className="m-0 text-base font-[650] tracking-[-0.02em]">
        Détail par site
      </h2>
      <Onglets
        libelle="Sites du parc"
        panneauId="panneau-site"
        actif={site.id}
        onChoisir={onChoisir}
        entrees={sites.map((candidat) => ({ id: candidat.id, titre: candidat.id, detail: candidat.type }))}
      />

      <div role="tabpanel" id="panneau-site" aria-labelledby={`onglet-${site.id}`}>
        <header className="mt-[18px] flex items-center justify-between gap-4 max-[680px]:flex-col max-[680px]:items-start">
          <div>
            <h3 className="m-0 text-[22px] font-[650] tracking-[-0.03em]">{site.nom}</h3>
            <p className="mt-1 text-[13px] text-discret">
              {site.type} · {site.releve}
            </p>
          </div>
          {site.badge && <Badge ton={tonBadge(site.badge)}>{site.badge}</Badge>}
        </header>

        <div className="mt-4 grid grid-cols-1 gap-3 min-[681px]:grid-cols-2 min-[981px]:grid-cols-4">
          <Indicateur
            variante="inset"
            libelle="Actuel"
            valeur={formaterKw(site.actuelKw)}
            unite={site.actuelKw === null ? undefined : 'kW'}
          />
          <Indicateur
            variante="inset"
            libelle="Prévu +2 h"
            valeur={formaterKw(site.prevu2hKw)}
            unite={site.prevu2hKw === null ? undefined : 'kW'}
            ton={prevuDepasse ? 'danger' : 'defaut'}
          />
          <Indicateur
            variante="inset"
            libelle="Seuil contractuel"
            valeur={formaterKw(site.seuilKw)}
            unite={site.seuilKw === null ? undefined : 'kW'}
          />
          <Indicateur
            variante="inset"
            libelle="Mesures reçues"
            ton={tonMesures}
            valeur={
              site.mesuresRecues === null || site.mesuresAttendues === null
                ? '—'
                : `${formaterNombre(site.mesuresRecues)}/${formaterNombre(site.mesuresAttendues)}`
            }
          />
        </div>

        <div className="relative mt-2">
          <GraphiqueConsommation serie={site.serie} seuilKw={site.seuilKw} compact />
          {principale && !toastFerme && (
            <Toast
              severite={principale.severite}
              titre={principale.titre}
              message={principale.message}
              onFermer={() => setToastFerme(true)}
              onDetail={voirDetail}
            />
          )}
        </div>
        {site.commentaire && <Commentaire>{site.commentaire}</Commentaire>}

        <div
          id={`bloc-actions-${site.id}`}
          className={cn('mt-2 grid gap-4 pt-2', misEnEvidence && 'rounded-xl shadow-[0_0_0_2px_rgba(91,157,255,0.45)]')}
        >
          {autres.length > 0 && (
            <div>
              <SousTitre>Alertes</SousTitre>
              <Liste>
                {autres.map((alerte) => (
                  <Ligne key={alerte.id} accent={alerte.severite === 'critique' ? 'danger' : 'ambre'}>
                    <strong className="block text-sm">{alerte.titre}</strong>
                    <p className="mt-[3px] text-[13px] leading-snug text-secondaire">{alerte.message}</p>
                  </Ligne>
                ))}
              </Liste>
            </div>
          )}
          <div>
            <SousTitre>Recommandations</SousTitre>
            {site.recommandations.length === 0 ? (
              <Commentaire>Aucune recommandation pour ce site.</Commentaire>
            ) : (
              <Liste>
                {site.recommandations.map((recommandation, index) => (
                  <Ligne key={recommandation.id}>
                    <Pastille>{index + 1}</Pastille>
                    <div>
                      <strong className="block text-sm">{recommandation.titre}</strong>
                      <p className="mt-[3px] text-[13px] leading-snug text-secondaire">{recommandation.detail}</p>
                    </div>
                    {recommandation.economie && (
                      <em className="text-[13px] font-bold whitespace-nowrap text-hausse not-italic">
                        {recommandation.economie}
                      </em>
                    )}
                  </Ligne>
                ))}
              </Liste>
            )}
          </div>
        </div>
      </div>
    </Carte>
  )
}

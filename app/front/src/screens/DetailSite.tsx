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
import { formatKw, formatNumber } from '../services/format'
import type { Alert, Site } from '../services/modele'

type Props = {
  sites: Site[]
  siteId: string
  onSelect: (id: string) => void
}

function alertePrincipale(site: Site): Alert | null {
  return site.alerts.find((alert) => alert.severity === 'critique') ?? site.alerts[0] ?? null
}

export function DetailSite({ sites, siteId, onSelect }: Props) {
  const site = sites.find((candidate) => candidate.id === siteId) ?? sites[0]
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
  const autres = site.alerts.filter((alert) => alert !== principale || toastFerme)
  const prevuDepasse = site.thresholdKw !== null && site.forecast2hKw !== null && site.forecast2hKw > site.thresholdKw
  const mesuresCompletes =
    site.receivedCount !== null &&
    site.expectedCount !== null &&
    site.expectedCount > 0 &&
    site.receivedCount >= site.expectedCount
  const mesuresPartielles =
    site.receivedCount !== null && site.expectedCount !== null && site.receivedCount < site.expectedCount
  const tonMesures = mesuresCompletes ? 'ok' : mesuresPartielles ? 'ambre' : 'defaut'

  function voirDetail() {
    document.getElementById(`bloc-actions-${site.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setMisEnEvidence(true)
    window.setTimeout(() => setMisEnEvidence(false), 1800)
  }

  return (
    <Carte aria-labelledby="title-detail" className="pb-[18px]">
      <h2 id="title-detail" className="m-0 text-base font-[650] tracking-[-0.02em]">
        Détail par site
      </h2>
      <Onglets
        label="Sites du parc"
        panelId="panneau-site"
        active={site.id}
        onSelect={onSelect}
        entries={sites.map((candidate) => ({ id: candidate.id, title: candidate.id, detail: candidate.type }))}
      />

      <div role="tabpanel" id="panneau-site" aria-labelledby={`onglet-${site.id}`}>
        <header className="mt-[18px] flex items-center justify-between gap-4 max-[680px]:flex-col max-[680px]:items-start">
          <div>
            <h3 className="m-0 text-[22px] font-[650] tracking-[-0.03em]">{site.name}</h3>
            <p className="mt-1 text-[13px] text-discret">
              {site.type} · {site.readingLabel}
            </p>
          </div>
          {site.badge && <Badge tone={tonBadge(site.badge)}>{site.badge}</Badge>}
        </header>

        <div className="mt-4 grid grid-cols-1 gap-3 min-[681px]:grid-cols-2 min-[981px]:grid-cols-4">
          <Indicateur
            variant="inset"
            label="Actuel"
            value={formatKw(site.currentKw)}
            unit={site.currentKw === null ? undefined : 'kW'}
          />
          <Indicateur
            variant="inset"
            label="Prévu +2 h"
            value={formatKw(site.forecast2hKw)}
            unit={site.forecast2hKw === null ? undefined : 'kW'}
            tone={prevuDepasse ? 'danger' : 'defaut'}
          />
          <Indicateur
            variant="inset"
            label="Seuil contractuel"
            value={formatKw(site.thresholdKw)}
            unit={site.thresholdKw === null ? undefined : 'kW'}
          />
          <Indicateur
            variant="inset"
            label="Mesures reçues"
            tone={tonMesures}
            value={
              site.receivedCount === null || site.expectedCount === null
                ? '—'
                : `${formatNumber(site.receivedCount)}/${formatNumber(site.expectedCount)}`
            }
          />
        </div>

        <div className="relative mt-2">
          <GraphiqueConsommation series={site.series} thresholdKw={site.thresholdKw} compact />
          {principale && !toastFerme && (
            <Toast
              severity={principale.severity}
              title={principale.title}
              message={principale.message}
              onClose={() => setToastFerme(true)}
              onDetail={voirDetail}
            />
          )}
        </div>
        {site.comment && <Commentaire>{site.comment}</Commentaire>}

        <div
          id={`bloc-actions-${site.id}`}
          className={cn('mt-2 grid gap-4 pt-2', misEnEvidence && 'rounded-xl shadow-[0_0_0_2px_rgba(91,157,255,0.45)]')}
        >
          {autres.length > 0 && (
            <div>
              <SousTitre>Alertes</SousTitre>
              <Liste>
                {autres.map((alert) => (
                  <Ligne key={alert.id} accent={alert.severity === 'critique' ? 'danger' : 'ambre'}>
                    <strong className="block text-sm">{alert.title}</strong>
                    <p className="mt-[3px] text-[13px] leading-snug text-secondaire">{alert.message}</p>
                  </Ligne>
                ))}
              </Liste>
            </div>
          )}
          <div>
            <SousTitre>Recommandations</SousTitre>
            {site.recommendations.length === 0 ? (
              <Commentaire>Aucune recommandation pour ce site.</Commentaire>
            ) : (
              <Liste>
                {site.recommendations.map((recommendation, index) => (
                  <Ligne key={recommendation.id}>
                    <Pastille>{index + 1}</Pastille>
                    <div>
                      <strong className="block text-sm">{recommendation.title}</strong>
                      <p className="mt-[3px] text-[13px] leading-snug text-secondaire">{recommendation.detail}</p>
                    </div>
                    {recommendation.saving && (
                      <em className="text-[13px] font-bold whitespace-nowrap text-hausse not-italic">
                        {recommendation.saving}
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

import { useEffect, useState } from 'react'
import { GraphiqueConsommation } from '../composants/GraphiqueConsommation'
import { IconeEclair, IconeLune, IconeSoleil } from '../composants/Icones'
import { Anneau } from '../composants/ui/Anneau'
import { Banniere } from '../composants/ui/Banniere'
import { BoutonIcone } from '../composants/ui/BoutonIcone'
import { Carte } from '../composants/ui/Carte'
import { Indicateur } from '../composants/ui/Indicateur'
import { Legende } from '../composants/ui/Legende'
import { Libelle, TexteSites } from '../composants/ui/Texte'
import { alertsLabel, formatCollectedAt, formatNumber, sitesLabel } from '../services/format'
import { useResume } from '../services/useResume'
import { DetailSite } from './DetailSite'

export function TableauDeBord() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  const { summary, siteId, setSiteId } = useResume()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('enervision-theme', theme)
  }, [theme])

  const exclusionMessage =
    summary && summary.excludedSites.length > 0
      ? `Le total du parc exclut ${summary.excludedSites.join(' et ')}, sans relevé depuis plus de deux heures. La consommation réelle est donc supérieure à la valeur affichée.`
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
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
          >
            {theme === 'dark' ? <IconeSoleil /> : <IconeLune />}
          </BoutonIcone>
        </div>
      </header>

      <main>
        <div>
          <h1 className="m-0 text-[32px] font-[650] tracking-[-0.035em] max-[680px]:text-[26px]">
            Vue d’ensemble du parc
          </h1>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-discret">
            <span
              className={`size-[7px] shrink-0 rounded-full ${
                summary?.source === 'demonstration' ? 'bg-ambre' : 'bg-hausse'
              }`}
              aria-hidden="true"
            />
            {summary
              ? `${sitesLabel(summary.siteCount)} · dernière collecte à ${formatCollectedAt(summary.lastCollectedAt) || '—'}`
              : 'Chargement des sites…'}
          </p>
        </div>

        {summary ? (
          <>
            <section
              className="mt-[22px] grid grid-cols-1 gap-3.5 min-[681px]:grid-cols-2 min-[981px]:grid-cols-4"
              aria-label="Indicateurs du parc"
            >
              <Indicateur
                label="Consommation actuelle"
                value={summary.consumptionKw === null ? '—' : formatNumber(summary.consumptionKw)}
                unit={summary.consumptionKw === null ? undefined : 'kW'}
                size="lg"
                detail={
                  summary.changePct !== null && (
                    <span className={summary.changePct >= 0 ? 'text-hausse' : 'text-danger'}>
                      {summary.changePct >= 0 ? '↑' : '↓'} {formatNumber(Math.abs(summary.changePct))} % sur
                      une heure
                    </span>
                  )
                }
              />

              <article className="flex min-h-[124px] items-center gap-4 rounded-2xl border border-bordure bg-carte px-[18px] pt-[18px] pb-4 shadow-[0_1px_0_rgba(255,255,255,0.02)]">
                <Anneau percentage={summary.coveragePct ?? 0} />
                <div>
                  <Libelle>Couverture</Libelle>
                  <p className="mt-1.5 max-w-[12em] text-[15px] leading-snug text-encre">
                    {summary.transmittingCount > 1
                      ? `${formatNumber(summary.transmittingCount)} sites sur ${formatNumber(summary.siteCount)} transmettent`
                      : `${formatNumber(summary.transmittingCount)} site sur ${formatNumber(summary.siteCount)} transmet`}
                  </p>
                </div>
              </article>

              <Indicateur
                label="Alertes en cours"
                value={formatNumber(summary.totalAlerts)}
                tone="danger"
                size="lg"
                detail={alertsLabel(summary.criticalAlerts, summary.mediumAlerts)}
              />

              <Indicateur
                label="Coût du jour"
                value={summary.dailyCostEur === null ? '—' : formatNumber(summary.dailyCostEur)}
                unit={summary.dailyCostEur === null ? undefined : '€'}
                size="lg"
                detail={summary.co2Tons === null ? '—' : `${formatNumber(summary.co2Tons, 1)} t CO₂ équivalent`}
              />
            </section>

            {exclusionMessage && (
              <Banniere>
                <TexteSites text={exclusionMessage} />
              </Banniere>
            )}

            <Carte aria-labelledby="chart-title">
              <header className="flex items-start justify-between gap-4 max-[680px]:flex-col">
                <h2 id="chart-title" className="m-0 text-base font-[650] tracking-[-0.02em]">
                  Consommation et prévision
                </h2>
                <Legende
                  entries={[
                    { label: 'Mesuré', style: 'mesure' },
                    { label: 'Prévision', style: 'prevision' },
                    { label: 'Seuil contractuel', style: 'seuil' },
                  ]}
                />
              </header>
              <GraphiqueConsommation series={summary.series} thresholdKw={summary.thresholdKw} showPeakValue />
              {summary.comment && (
                <p className="mt-1 text-[13px] leading-snug text-discret">{summary.comment}</p>
              )}
            </Carte>

            <DetailSite sites={summary.sites} siteId={siteId ?? ''} onSelect={setSiteId} />
          </>
        ) : (
          <p className="mt-1.5 text-sm text-discret">Lecture du résumé du parc…</p>
        )}
      </main>
    </div>
  )
}

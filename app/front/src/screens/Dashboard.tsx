import { useEffect, useState } from 'react'
import { ConsumptionChart } from '../components/ConsumptionChart'
import { IconBolt, IconMoon, IconSun } from '../components/Icons'
import { Banner } from '../components/ui/Banner'
import { Card } from '../components/ui/Card'
import { IconButton } from '../components/ui/IconButton'
import { Legend } from '../components/ui/Legend'
import { Metric } from '../components/ui/Metric'
import { Ring } from '../components/ui/Ring'
import { Label, SiteText } from '../components/ui/Text'
import { alertsLabel, formatCollectedAt, formatNumber, sitesLabel } from '../services/format'
import { useSummary } from '../services/useSummary'
import { SiteDetail } from './SiteDetail'

export function Dashboard() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  const { summary, error, siteId, setSiteId } = useSummary()

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
            <IconBolt />
          </span>
          <span>EnerVision</span>
        </div>
        <div className="flex gap-1 rounded-[14px] border border-bordure bg-pilule p-1 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
          <IconButton
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </IconButton>
        </div>
      </header>

      <main>
        <div>
          <h1 className="m-0 text-[32px] font-[650] tracking-[-0.035em] max-[680px]:text-[26px]">
            Vue d’ensemble du parc
          </h1>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-discret">
            <span
              className={`size-[7px] shrink-0 rounded-full ${error ? 'bg-danger' : 'bg-hausse'}`}
              aria-hidden="true"
            />
            {summary
              ? `${sitesLabel(summary.siteCount)} · dernière collecte à ${formatCollectedAt(summary.lastCollectedAt) || '—'}`
              : error
                ? 'API injoignable'
                : 'Chargement des sites…'}
          </p>
        </div>

        {summary && error && (
          <Banner>
            L’API métier ne répond plus. Les valeurs ci-dessous sont les dernières reçues et ne sont plus
            rafraîchies.
          </Banner>
        )}

        {summary ? (
          <>
            <section
              className="mt-[22px] grid grid-cols-1 gap-3.5 min-[681px]:grid-cols-2 min-[981px]:grid-cols-4"
              aria-label="Indicateurs du parc"
            >
              <Metric
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
                <Ring percentage={summary.coveragePct ?? 0} />
                <div>
                  <Label>Couverture</Label>
                  <p className="mt-1.5 max-w-[12em] text-[15px] leading-snug text-encre">
                    {summary.transmittingCount > 1
                      ? `${formatNumber(summary.transmittingCount)} sites sur ${formatNumber(summary.siteCount)} transmettent`
                      : `${formatNumber(summary.transmittingCount)} site sur ${formatNumber(summary.siteCount)} transmet`}
                  </p>
                </div>
              </article>

              <Metric
                label="Alertes en cours"
                value={formatNumber(summary.totalAlerts)}
                tone="danger"
                size="lg"
                detail={alertsLabel(summary.criticalAlerts, summary.mediumAlerts)}
              />

              <Metric
                label="Coût du jour"
                value={summary.dailyCostEur === null ? '—' : formatNumber(summary.dailyCostEur)}
                unit={summary.dailyCostEur === null ? undefined : '€'}
                size="lg"
                detail={summary.co2Tons === null ? '—' : `${formatNumber(summary.co2Tons, 1)} t CO₂ équivalent`}
              />
            </section>

            {exclusionMessage && (
              <Banner>
                <SiteText text={exclusionMessage} />
              </Banner>
            )}

            <Card aria-labelledby="chart-title">
              <header className="flex items-start justify-between gap-4 max-[680px]:flex-col">
                <h2 id="chart-title" className="m-0 text-base font-[650] tracking-[-0.02em]">
                  Consommation et prévision
                </h2>
                <Legend
                  entries={[
                    { label: 'Mesuré', style: 'mesure' },
                    { label: 'Prévision', style: 'prevision' },
                    { label: 'Seuil contractuel', style: 'seuil' },
                  ]}
                />
              </header>
              <ConsumptionChart series={summary.series} thresholdKw={summary.thresholdKw} showPeakValue />
              {summary.comment && (
                <p className="mt-1 text-[13px] leading-snug text-discret">{summary.comment}</p>
              )}
            </Card>

            <SiteDetail sites={summary.sites} siteId={siteId ?? ''} onSelect={setSiteId} />
          </>
        ) : (
          <Card>
            <p className="m-0 text-sm text-discret">
              {error
                ? `Aucune donnée disponible : l’API métier ne répond pas (${error}).`
                : 'Lecture du résumé du parc…'}
            </p>
          </Card>
        )}
      </main>
    </div>
  )
}

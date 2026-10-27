import { useEffect, useMemo, useState } from 'react'
import { ConsumptionChart } from '../components/ConsumptionChart'
import { IconBolt, IconLogout, IconMoon, IconSun, IconUsers } from '../components/Icons'
import { Banner } from '../components/ui/Banner'
import { Card } from '../components/ui/Card'
import { IconButton } from '../components/ui/IconButton'
import { Legend } from '../components/ui/Legend'
import { Metric } from '../components/ui/Metric'
import { Ring } from '../components/ui/Ring'
import { Label, SiteText } from '../components/ui/Text'
import { alertsLabel, formatCollectedAt, formatNumber, sitesLabel } from '../services/format'
import { appendCurrent } from '../services/history'
import type { SeriesPoint } from '../services/model'
import { useHistory } from '../services/useHistory'
import { useSummary } from '../services/useSummary'
import { SiteDetail } from './SiteDetail'

/** L'utilisateur connecté, absent quand l'API est ouverte. */
export type SignedInAccount = {
  name: string
  onSignOut: () => void
  /** Présent pour un administrateur seulement. */
  onOpenAccounts?: () => void
}

export function Dashboard({ account = null }: { account?: SignedInAccount | null }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  const { summary, details, error, siteId, setSiteId } = useSummary()
  const { history, error: historyError } = useHistory()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('enervision-theme', theme)
  }, [theme])

  // L'historique s'arrête à l'heure précédente ; la mesure temps réel le prolonge
  // jusqu'à maintenant, pour que la courbe rejoigne le chiffre affiché au-dessus.
  const parkSeries = useMemo(
    () => appendCurrent(history?.park ?? [], summary?.consumptionKw ?? null, summary?.lastCollectedAt),
    [history, summary],
  )

  const seriesBySite = useMemo(() => {
    const result: Record<string, SeriesPoint[]> = {}
    for (const site of summary?.sites ?? []) {
      result[site.id] = appendCurrent(
        history?.bySite[site.id] ?? [],
        site.currentKw,
        summary?.lastCollectedAt,
      )
    }
    return result
  }, [history, summary])

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
          {account && (
            <>
              <span className="self-center px-2 text-[13px] text-secondaire max-[680px]:hidden">
                {account.name}
              </span>
              {account.onOpenAccounts && (
                <IconButton onClick={account.onOpenAccounts} aria-label="Gérer les comptes">
                  <IconUsers />
                </IconButton>
              )}
              <IconButton onClick={account.onSignOut} aria-label="Se déconnecter">
                <IconLogout />
              </IconButton>
            </>
          )}
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
              className="mt-[22px] grid grid-cols-1 gap-3.5 min-[681px]:grid-cols-2 min-[981px]:grid-cols-3"
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
                tone={summary.criticalAlerts > 0 ? 'danger' : summary.totalAlerts > 0 ? 'ambre' : 'defaut'}
                size="lg"
                detail={alertsLabel(summary.criticalAlerts, summary.mediumAlerts)}
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
                  Consommation des dernières 24 heures
                </h2>
                {/* Pas de ligne de capacité ici : la somme des sept
                    installations est une limite théorique, jamais atteinte
                    simultanément, et le total affiché exclut les sites muets.
                    La capacité garde tout son sens au niveau d'un site. */}
                <Legend entries={[{ label: 'Mesuré', style: 'mesure' }]} />
              </header>
              {historyError ? (
                <p className="mt-1.5 text-[13px] text-discret">Historique indisponible : {historyError}</p>
              ) : (
                <ConsumptionChart series={parkSeries} capacityKw={null} />
              )}
              {summary.comment && (
                <p className="mt-1 text-[13px] leading-snug text-discret">{summary.comment}</p>
              )}
            </Card>

            <SiteDetail
              sites={summary.sites}
              siteId={siteId ?? ''}
              onSelect={setSiteId}
              seriesBySite={seriesBySite}
              details={details}
            />
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

import { useEffect, useState } from 'react'
import { ConsumptionChart } from '../components/ConsumptionChart'
import { Badge, badgeTone } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Metric } from '../components/ui/Metric'
import { Bullet, List, Row } from '../components/ui/Row'
import { Tabs } from '../components/ui/Tabs'
import { Caption, Subtitle } from '../components/ui/Text'
import { Toast } from '../components/ui/Toast'
import { cn } from '../components/ui/cn'
import { formatKw, formatNumber } from '../services/format'
import type { Alert, SeriesPoint, Site } from '../services/model'

type Props = {
  sites: Site[]
  siteId: string
  onSelect: (id: string) => void
  seriesBySite: Record<string, SeriesPoint[]>
}

/** Alerte mise en avant dans le toast : la plus grave, sinon la première. */
function mainAlert(site: Site): Alert | null {
  return site.alerts.find((alert) => alert.severity === 'critique') ?? site.alerts[0] ?? null
}

export function SiteDetail({ sites, siteId, onSelect, seriesBySite }: Props) {
  const site = sites.find((candidate) => candidate.id === siteId) ?? sites[0]
  const [toastClosed, setToastClosed] = useState(false)
  const [highlighted, setHighlighted] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: déclencheur, pas une valeur lue
  useEffect(() => {
    setToastClosed(false)
    setHighlighted(false)
  }, [site?.id])

  if (!site) {
    return (
      <Card>
        <h2 className="m-0 text-base font-[650] tracking-[-0.02em]">Détail par site</h2>
        <Caption>Aucun site n’est disponible dans le résumé.</Caption>
      </Card>
    )
  }

  const main = mainAlert(site)
  const others = site.alerts.filter((alert) => alert !== main || toastClosed)
  const forecastExceeds =
    site.thresholdKw !== null && site.forecast2hKw !== null && site.forecast2hKw > site.thresholdKw
  const readingsComplete =
    site.receivedCount !== null &&
    site.expectedCount !== null &&
    site.expectedCount > 0 &&
    site.receivedCount >= site.expectedCount
  const readingsPartial =
    site.receivedCount !== null && site.expectedCount !== null && site.receivedCount < site.expectedCount
  const readingsTone = readingsComplete ? 'ok' : readingsPartial ? 'ambre' : 'defaut'

  function scrollToActions() {
    document.getElementById(`actions-${site.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setHighlighted(true)
    window.setTimeout(() => setHighlighted(false), 1800)
  }

  return (
    <Card aria-labelledby="detail-title" className="pb-[18px]">
      <h2 id="detail-title" className="m-0 text-base font-[650] tracking-[-0.02em]">
        Détail par site
      </h2>
      <Tabs
        label="Sites du parc"
        panelId="site-panel"
        active={site.id}
        onSelect={onSelect}
        entries={sites.map((candidate) => ({
          id: candidate.id,
          title: candidate.id,
          detail: candidate.type,
        }))}
      />

      <div role="tabpanel" id="site-panel" aria-labelledby={`tab-${site.id}`}>
        <header className="mt-[18px] flex items-center justify-between gap-4 max-[680px]:flex-col max-[680px]:items-start">
          <div>
            <h3 className="m-0 text-[22px] font-[650] tracking-[-0.03em]">{site.name}</h3>
            <p className="mt-1 text-[13px] text-discret">
              {site.type} · {site.readingLabel}
            </p>
          </div>
          {site.badge && <Badge tone={badgeTone(site.badge)}>{site.badge}</Badge>}
        </header>

        <div className="mt-4 grid grid-cols-1 gap-3 min-[681px]:grid-cols-2 min-[981px]:grid-cols-4">
          <Metric
            variant="inset"
            label="Actuel"
            value={formatKw(site.currentKw)}
            unit={site.currentKw === null ? undefined : 'kW'}
          />
          <Metric
            variant="inset"
            label="Prévu +2 h"
            value={formatKw(site.forecast2hKw)}
            unit={site.forecast2hKw === null ? undefined : 'kW'}
            tone={forecastExceeds ? 'danger' : 'defaut'}
          />
          <Metric
            variant="inset"
            label="Seuil contractuel"
            value={formatKw(site.thresholdKw)}
            unit={site.thresholdKw === null ? undefined : 'kW'}
          />
          <Metric
            variant="inset"
            label="Mesures reçues"
            tone={readingsTone}
            value={
              site.receivedCount === null || site.expectedCount === null
                ? '—'
                : `${formatNumber(site.receivedCount)}/${formatNumber(site.expectedCount)}`
            }
          />
        </div>

        <div className="relative mt-2">
          <ConsumptionChart series={seriesBySite[site.id] ?? []} thresholdKw={site.thresholdKw} compact />
          {main && !toastClosed && (
            <Toast
              severity={main.severity}
              title={main.title}
              message={main.message}
              onClose={() => setToastClosed(true)}
              onDetail={scrollToActions}
            />
          )}
        </div>
        {site.comment && <Caption>{site.comment}</Caption>}

        <div
          id={`actions-${site.id}`}
          className={cn(
            'mt-2 grid gap-4 pt-2',
            highlighted && 'rounded-xl shadow-[0_0_0_2px_rgba(91,157,255,0.45)]',
          )}
        >
          {others.length > 0 && (
            <div>
              <Subtitle>Alertes</Subtitle>
              <List>
                {others.map((alert) => (
                  <Row key={alert.id} accent={alert.severity === 'critique' ? 'danger' : 'ambre'}>
                    <strong className="block text-sm">{alert.title}</strong>
                    <p className="mt-[3px] text-[13px] leading-snug text-secondaire">{alert.message}</p>
                  </Row>
                ))}
              </List>
            </div>
          )}
          <div>
            <Subtitle>Recommandations</Subtitle>
            {site.recommendations.length === 0 ? (
              <Caption>Aucune recommandation pour ce site.</Caption>
            ) : (
              <List>
                {site.recommendations.map((recommendation, index) => (
                  <Row key={recommendation.id}>
                    <Bullet>{index + 1}</Bullet>
                    <div>
                      <strong className="block text-sm">{recommendation.title}</strong>
                      <p className="mt-[3px] text-[13px] leading-snug text-secondaire">
                        {recommendation.detail}
                      </p>
                    </div>
                    {recommendation.saving && (
                      <em className="text-[13px] font-bold whitespace-nowrap text-hausse not-italic">
                        {recommendation.saving}
                      </em>
                    )}
                  </Row>
                ))}
              </List>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

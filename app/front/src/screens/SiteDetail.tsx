import { useMemo, useState } from 'react'
import { ConsumptionChart } from '../components/ConsumptionChart'
import { Badge, badgeTone } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { cn } from '../components/ui/cn'
import { Metric } from '../components/ui/Metric'
import { Bullet, List, Row } from '../components/ui/Row'
import { Caption, Subtitle } from '../components/ui/Text'
import { Toast } from '../components/ui/Toast'
import { formatKw, formatNumber, qualityLabel, qualityShort } from '../services/format'
import type { Alert, SiteDetail as Detail, DetailsBySite, SeriesPoint, Site } from '../services/model'

type Props = {
  sites: Site[]
  siteId: string
  onSelect: (id: string) => void
  seriesBySite: Record<string, SeriesPoint[]>
  details: DetailsBySite
}

/** Alerte mise en avant dans le toast : la plus grave, sinon la première. */
function mainAlert(site: Site): Alert | null {
  return site.alerts.find((alert) => alert.severity === 'critique') ?? site.alerts[0] ?? null
}

/** Couleur du badge de qualité : rouge si rien n'arrive, ambre sinon. */
function qualityTone(quality: string | null): 'ok' | 'ambre' | 'alert' {
  if (quality === 'good') return 'ok'
  if (quality === 'critical') return 'alert'
  return 'ambre'
}

/** En dessous de ce seuil, le fournisseur facture la puissance réactive. */
const POWER_FACTOR_FLOOR = 0.9

/** Ce qu'affiche le bout d'une ligne : l'anomalie si elle existe, sinon la mesure.
 *
 * Un problème passe devant un chiffre : une ligne de liste sert d'abord à
 * repérer le site qui demande une attention.
 */
function rowStatus(site: Site, detail: Detail | null): { text: string; alerting: boolean } {
  const issue = qualityShort(detail?.dataQuality ?? null)
  if (issue) return { text: issue, alerting: true }
  if (!site.isTransmitting) return { text: 'relevé interrompu', alerting: true }
  if (site.currentKw === null) return { text: '—', alerting: false }
  return { text: `${formatKw(site.currentKw)} kW`, alerting: false }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn('size-3.5 shrink-0', open ? 'text-orange' : 'text-discret')}
    >
      <path
        d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Grandeurs électriques du site, absentes du résumé du parc. */
function Installation({ detail }: { detail: Detail }) {
  const poorPowerFactor = detail.powerFactor !== null && detail.powerFactor < POWER_FACTOR_FLOOR

  return (
    <div>
      <Subtitle>État de l’installation</Subtitle>
      <div className="grid grid-cols-2 gap-3 min-[981px]:grid-cols-4">
        <Metric
          variant="inset"
          label="Tension"
          value={detail.voltageV === null ? '—' : formatNumber(detail.voltageV, 1)}
          unit={detail.voltageV === null ? undefined : 'V'}
        />
        <Metric
          variant="inset"
          label="Intensité"
          value={detail.currentA === null ? '—' : formatNumber(detail.currentA, 1)}
          unit={detail.currentA === null ? undefined : 'A'}
        />
        <Metric
          variant="inset"
          label="Facteur de puissance"
          tone={poorPowerFactor ? 'ambre' : 'defaut'}
          value={detail.powerFactor === null ? '—' : formatNumber(detail.powerFactor, 3)}
          detail={poorPowerFactor ? 'Sous 0,9 : puissance réactive facturée' : undefined}
        />
        <Metric
          variant="inset"
          label="Température"
          value={detail.temperatureC === null ? '—' : formatNumber(detail.temperatureC, 1)}
          unit={detail.temperatureC === null ? undefined : '°C'}
          detail={
            detail.humidityPct === null ? undefined : `${formatNumber(detail.humidityPct)} % d’humidité`
          }
        />
      </div>
    </div>
  )
}

type RowProps = {
  site: Site
  detail: Detail | null
  series: SeriesPoint[]
  open: boolean
  onToggle: () => void
}

/** Une ligne de la liste et, quand elle est dépliée, le détail de son site.
 *
 * Chaque ligne porte ses propres données : plusieurs panneaux peuvent être
 * ouverts à la fois sans que l'un affiche le contenu de l'autre.
 */
function SiteRow({ site, detail, series, open, onToggle }: RowProps) {
  const [toastClosed, setToastClosed] = useState(false)
  const [highlighted, setHighlighted] = useState(false)

  const main = mainAlert(site)
  const others = site.alerts.filter((alert) => alert !== main || toastClosed)
  const status = rowStatus(site, detail)
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

  // La qualité ne s'affiche que lorsqu'elle pose problème : « 24/24 » suivi de
  // « toutes les mesures sont disponibles » n'apprend rien au lecteur.
  const qualityIssue = detail && detail.dataQuality !== 'good' ? qualityLabel(detail.dataQuality) : null

  function scrollToActions() {
    document.getElementById(`actions-${site.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setHighlighted(true)
    window.setTimeout(() => setHighlighted(false), 1800)
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-inset',
        open ? 'border-bordure-forte' : 'border-bordure',
      )}
    >
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`panneau-${site.id}`}
          onClick={onToggle}
          className={cn(
            'flex w-full items-center gap-3 border-0 px-3.5 py-3 text-left font-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lien',
            open ? 'bg-[rgba(255,122,26,0.14)]' : 'bg-transparent hover:bg-onglet',
          )}
        >
          <Chevron open={open} />
          <span className="shrink-0 text-[11px] font-[650] tracking-[0.06em] text-discret">{site.id}</span>
          <span className="grow truncate text-[15px] font-bold tracking-[-0.01em] text-encre">
            {site.name}
          </span>
          <span
            className={cn(
              'shrink-0 text-[13px] whitespace-nowrap',
              status.alerting ? 'font-[650] text-ambre' : 'text-secondaire',
            )}
          >
            {status.text}
          </span>
        </button>
      </h3>

      {open && (
        <div id={`panneau-${site.id}`} className="px-3.5 pt-1 pb-3.5">
          <div className="flex items-center justify-between gap-4 max-[680px]:flex-col max-[680px]:items-start">
            <p className="m-0 text-[13px] text-discret">
              {site.type} · {site.readingLabel}
            </p>
            <div className="flex items-center gap-2">
              {qualityIssue && <Badge tone={qualityTone(detail?.dataQuality ?? null)}>{qualityIssue}</Badge>}
              {site.badge && <Badge tone={badgeTone(site.badge)}>{site.badge}</Badge>}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 min-[681px]:grid-cols-2 min-[981px]:grid-cols-4">
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
              // Le résumé dit qu'il manque des mesures, le détail dit pourquoi.
              detail={qualityIssue}
            />
          </div>

          <div className="relative mt-2">
            <ConsumptionChart series={series} thresholdKw={site.thresholdKw} compact />
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
            {detail && <Installation detail={detail} />}

            {detail && detail.nullReasons.length > 0 && (
              <div>
                <Subtitle>Capteurs indisponibles</Subtitle>
                <List>
                  {detail.nullReasons.map((reason) => (
                    <Row key={reason} accent="ambre">
                      <p className="m-0 text-[13px] leading-snug text-secondaire">{reason}</p>
                    </Row>
                  ))}
                </List>
              </div>
            )}

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
      )}
    </div>
  )
}

export function SiteDetail({ sites, siteId, onSelect, seriesBySite, details }: Props) {
  // Tant que le lecteur n'a rien touché, l'ouverture suit ce que désigne le
  // parent (au premier chargement, le site le plus critique). Au premier clic,
  // elle lui appartient : `null` distingue les deux états.
  const [chosen, setChosen] = useState<string[] | null>(null)

  const fallback = useMemo(() => {
    if (sites.length === 0) return []
    // Un identifiant qui ne désigne aucun site ouvre le premier, plutôt que
    // de laisser la liste entièrement fermée.
    const known = sites.some((site) => site.id === siteId)
    return [known ? siteId : sites[0].id]
  }, [sites, siteId])

  const openIds = chosen ?? fallback

  if (sites.length === 0) {
    return (
      <Card>
        <h2 className="m-0 text-base font-[650] tracking-[-0.02em]">Détail par site</h2>
        <Caption>Aucun site n’est disponible dans le résumé.</Caption>
      </Card>
    )
  }

  function toggle(id: string) {
    // Plusieurs sites peuvent rester dépliés : on compare souvent deux
    // installations, et refermer la première rendrait la comparaison impossible.
    setChosen((current) => {
      const previous = current ?? fallback
      return previous.includes(id) ? previous.filter((open) => open !== id) : [...previous, id]
    })
    // Le parent suit le dernier site consulté ; il n'a pas à connaître le
    // détail de ce qui est plié ou déplié.
    onSelect(id)
  }

  return (
    <Card aria-labelledby="detail-title" className="pb-[18px]">
      <h2 id="detail-title" className="m-0 text-base font-[650] tracking-[-0.02em]">
        Détail par site
      </h2>

      <div className="mt-4 grid gap-1.5">
        {sites.map((site) => (
          <SiteRow
            key={site.id}
            site={site}
            detail={details[site.id] ?? null}
            series={seriesBySite[site.id] ?? []}
            open={openIds.includes(site.id)}
            onToggle={() => toggle(site.id)}
          />
        ))}
      </div>
    </Card>
  )
}

import { useMemo, useState } from 'react'
import { ConsumptionChart } from '../components/ConsumptionChart'
import { Badge, badgeTone } from '../components/ui/Badge'
import { Banner } from '../components/ui/Banner'
import { Card } from '../components/ui/Card'
import { cn } from '../components/ui/cn'
import { Metric } from '../components/ui/Metric'
import { Bullet, List, Row } from '../components/ui/Row'
import { Caption, Subtitle } from '../components/ui/Text'
import {
  forecastPeak,
  formatDayHour,
  formatKw,
  formatNumber,
  formatTime,
  lastMeasuredIndex,
  loadTone,
  qualityLabel,
  qualityShort,
  sensorLabel,
} from '../services/format'
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

type Reading = { value: number | null; note: string | undefined; stale: boolean }

/** Ce que montre la case « Actuel », et ce qu'il faut en dire.
 *
 * Un chiffre n'est marqué comme daté que lorsqu'il sort réellement de la
 * mémoire. L'état des capteurs, lui, ne périme rien : le détail et le résumé
 * sont deux endpoints décorrélés, et le badge du panneau dit déjà qu'un
 * capteur est tombé. Le tiret ne reste que si l'on n'a jamais rien mesuré.
 */
function currentReading(site: Site): Reading {
  if (site.currentKw !== null) return { value: site.currentKw, note: undefined, stale: false }

  const remembered = site.lastKnownKw ?? null
  if (remembered === null) return { value: null, note: undefined, stale: false }

  return {
    value: remembered,
    // Un chiffre daté sans son heure n'apprend rien : le lecteur ne peut pas
    // juger s'il peut encore s'y fier.
    note: site.lastKnownAt
      ? `Dernier relevé datant de ${formatTime(site.lastKnownAt)}`
      : 'Dernière valeur connue',
    stale: true,
  }
}

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
      className={cn('size-3.5 shrink-0', open ? 'text-accent' : 'text-discret')}
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
  return (
    <div>
      <Subtitle>État de l’installation</Subtitle>
      <div className="grid grid-cols-2 gap-3 min-[981px]:grid-cols-3">
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
  const main = mainAlert(site)
  const others = site.alerts.filter((alert) => alert !== main)
  const status = rowStatus(site, detail)

  // La qualité ne s'affiche que lorsqu'elle pose problème : « 24/24 » suivi de
  // « toutes les mesures sont disponibles » n'apprend rien au lecteur.
  const qualityIssue = detail && detail.dataQuality !== 'good' ? qualityLabel(detail.dataQuality) : null
  const reading = currentReading(site)

  // Part de la capacité réellement utilisée. Une capacité seule ne dit rien ;
  // c'est le rapport à la consommation qui informe, et c'est aussi la grandeur
  // sur laquelle les alertes se déclenchent. Aucun seuil n'est jugé ici : le
  // bandeau s'en charge, et le dupliquer risquerait de le contredire.
  const loadPct = reading.value !== null && site.capacityKw ? (reading.value / site.capacityKw) * 100 : null
  const loadLabel = loadPct === null ? undefined : `${formatNumber(loadPct, 1)} % utilisés`

  // Maximum prévu, strictement après la dernière mesure. `forecastPeak` se
  // rabat sur toute la série quand il ne trouve rien au-delà ; comme le point
  // de jonction porte la dernière mesure en guise de prévision, il rendrait
  // alors un chiffre mesuré sous l'étiquette « prévu ». D'où le garde-fou.
  const measuredIndex = lastMeasuredIndex(series)
  const hasForecastAhead = series.slice(measuredIndex + 1).some((point) => point.forecastKw !== null)
  const peak = hasForecastAhead ? forecastPeak(series, measuredIndex) : null
  const peakPct = peak && site.capacityKw ? (peak.value / site.capacityKw) * 100 : null
  const peakTone = loadTone(peakPct)

  // Trois états, et non deux. Un pic au seuil des alertes se montre avec son
  // heure ; un maximum ordinaire n'en est pas un, et la case le dit plutôt
  // que de crier au loup ; une absence de prévision n'est ni l'un ni l'autre,
  // et seule celle-là mérite un tiret. Sans capacité connue il n'y a rien à
  // comparer, donc rien à qualifier de pic.
  const notable = peak !== null && peakTone !== 'defaut'
  const lastForecast = series.findLast(
    (point) => point.forecastKw !== null && point !== series[measuredIndex],
  )

  let peakValue = '—'
  let peakDetail: string | undefined
  if (notable && peak && peakPct !== null) {
    peakValue = formatKw(peak.value)
    peakDetail = `${formatDayHour(peak.at)} · ${formatNumber(peakPct)} % de la capacité`
  } else if (peak && lastForecast) {
    peakValue = 'Aucun'
    peakDetail = `jusqu’à ${formatDayHour(lastForecast.at)}`
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
            open ? 'bg-accent-doux' : 'bg-transparent hover:bg-onglet',
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

          {/* Ce que le site consomme, ce qu'il peut encaisser, et le pic
              prévu. Trois cases fixes : les faire apparaître et disparaître
              selon le site donnerait des panneaux de largeurs inégales dès
              que deux sont ouverts côte à côte.
              « Prévu +2 h » et « Mesures reçues » ont été retirées — aucune
              source ne les alimentait, elles affichaient un tiret en
              permanence. */}
          <div className="mt-3 grid grid-cols-1 gap-3 min-[681px]:grid-cols-2 min-[981px]:grid-cols-3">
            <Metric
              variant="inset"
              label="Actuel"
              tone={reading.stale ? 'ambre' : 'defaut'}
              value={formatKw(reading.value)}
              unit={reading.value === null ? undefined : 'kW'}
              detail={reading.note}
            />
            <Metric
              variant="inset"
              // « Capacité » et non « Seuil contractuel » : l'API n'expose que
              // la limite technique de l'installation. Afficher une capacité
              // sous un nom contractuel ferait passer l'une pour l'autre.
              label="Capacité"
              value={formatKw(site.capacityKw ?? null)}
              unit={site.capacityKw == null ? undefined : 'kW'}
              detail={loadLabel}
            />
            <Metric
              variant="inset"
              // Le même franchissement que montre la courbe, dit en chiffres :
              // la ligne de capacité se lit d'un coup d'œil, la valeur exacte
              // demande de survoler.
              label="Pic de consommation prévu"
              // Mêmes seuils que les alertes de capacité : 90 % en ambre,
              // 100 % en rouge. Un pic signalé autrement que la charge réelle
              // ferait douter de l'un ou de l'autre.
              tone={peakTone}
              value={peakValue}
              unit={notable ? 'kW' : undefined}
              detail={peakDetail}
            />
          </div>

          {/* Au-dessus du graphique, et non par-dessus : une alerte posée sur
              la courbe cache précisément ce qu'elle commente. */}
          {main && (
            <Banner tone={main.severity === 'critique' ? 'danger' : 'ambre'}>
              <strong className="font-[650]">{main.title}</strong>&nbsp;: {main.message}
            </Banner>
          )}

          <div className="mt-2">
            <ConsumptionChart series={series} capacityKw={site.capacityKw ?? null} compact />
          </div>
          {site.comment && <Caption>{site.comment}</Caption>}

          <div className="mt-2 grid gap-4 pt-2">
            {detail && <Installation detail={detail} />}

            {detail && detail.nullReasons.length > 0 && (
              <div>
                <Subtitle>Capteurs indisponibles</Subtitle>
                <List>
                  {detail.nullReasons.map((reason) => (
                    <Row key={reason} accent="ambre">
                      <p className="m-0 text-[13px] leading-snug text-secondaire">{sensorLabel(reason)}</p>
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

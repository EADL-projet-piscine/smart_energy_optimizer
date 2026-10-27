import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../../api/client'
import { loadDetails } from '../../services/details'

vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }))

/** Réponse type de l'endpoint, avec un seul site. */
function reponse(data: Record<string, unknown>, stale = false) {
  return {
    sites: {
      SITE001: { data, fetched_at: '2026-10-25T13:15:16+00:00', stale },
    },
  }
}

const MESURE = {
  timestamp: '2026-10-25T13:15:16.361330',
  site_id: 'SITE001',
  site_type: 'office',
  consumption_kw: 165.22,
  voltage_v: 405.8,
  current_a: 247.43,
  power_factor: 0.909,
  temperature_celsius: 7.8,
  humidity_percent: 39.3,
  null_reasons: [],
  data_quality: 'good',
}

beforeEach(() => {
  vi.mocked(fetchJson).mockReset()
})

describe('loadDetails', () => {
  it('interroge la route du détail des sites', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse(MESURE))
    const signal = new AbortController().signal

    await loadDetails(signal)

    expect(fetchJson).toHaveBeenCalledWith('/api/consommations/sites', signal)
  })

  it('normalise les grandeurs de chaque site', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse(MESURE))

    const details = await loadDetails()

    expect(details.SITE001).toMatchObject({
      dataQuality: 'good',
      voltageV: 405.8,
      currentA: 247.43,
      powerFactor: 0.909,
      temperatureC: 7.8,
      humidityPct: 39.3,
      stale: false,
    })
  })

  it('lit l’horodatage nu comme de l’UTC', async () => {
    // La source date sans fuseau alors qu'il s'agit d'UTC, comme /stats/summary.
    // Sans correction, le navigateur l'interprète en heure locale.
    vi.mocked(fetchJson).mockResolvedValue(reponse(MESURE))

    const details = await loadDetails()

    expect(details.SITE001.at).toBe('2026-10-25T13:15:16.361330Z')
  })

  it('garde un horodatage qui porte déjà son fuseau', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse({ ...MESURE, timestamp: '2026-10-25T13:15:16Z' }))

    const details = await loadDetails()

    expect(details.SITE001.at).toBe('2026-10-25T13:15:16Z')
  })

  it('relaie les causes d’absence de mesure', async () => {
    // C'est la raison d'être de cet endpoint : le résumé dit qu'une mesure
    // manque, lui seul dit pourquoi.
    vi.mocked(fetchJson).mockResolvedValue(
      reponse({
        ...MESURE,
        data_quality: 'degraded',
        null_reasons: ['sonde de tension HS', 'capteur hygrométrie muet'],
      }),
    )

    const details = await loadDetails()

    expect(details.SITE001.dataQuality).toBe('degraded')
    expect(details.SITE001.nullReasons).toEqual(['sonde de tension HS', 'capteur hygrométrie muet'])
  })

  it('ignore les causes qui ne sont pas des textes', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse({ ...MESURE, null_reasons: ['réseau', 42, null] }))

    const details = await loadDetails()

    expect(details.SITE001.nullReasons).toEqual(['réseau'])
  })

  it('rend une liste vide quand les causes ne sont pas un tableau', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse({ ...MESURE, null_reasons: 'réseau' }))

    const details = await loadDetails()

    expect(details.SITE001.nullReasons).toEqual([])
  })

  it('laisse une grandeur absente à null plutôt qu’à zéro', async () => {
    // Zéro volt est une mesure, l'absence de mesure n'en est pas une.
    vi.mocked(fetchJson).mockResolvedValue(
      reponse({ ...MESURE, voltage_v: null, power_factor: 'NaN', temperature_celsius: undefined }),
    )

    const details = await loadDetails()

    expect(details.SITE001.voltageV).toBeNull()
    expect(details.SITE001.powerFactor).toBeNull()
    expect(details.SITE001.temperatureC).toBeNull()
  })

  it('conserve un zéro réel', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse({ ...MESURE, current_a: 0 }))

    const details = await loadDetails()

    expect(details.SITE001.currentA).toBe(0)
  })

  it('signale une mesure périmée', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse(MESURE, true))

    const details = await loadDetails()

    expect(details.SITE001.stale).toBe(true)
  })

  it('laisse une qualité inconnue telle quelle', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse({ ...MESURE, data_quality: 42 }))

    const details = await loadDetails()

    expect(details.SITE001.dataQuality).toBeNull()
  })

  it('met de côté un site sans mesure exploitable', async () => {
    // Un site en échec côté serveur ne doit pas faire tomber les autres.
    vi.mocked(fetchJson).mockResolvedValue({
      sites: {
        SITE001: { data: MESURE, stale: false },
        SITE002: { data: null, stale: true },
      },
    })

    const details = await loadDetails()

    expect(Object.keys(details)).toEqual(['SITE001'])
  })

  it('laisse un horodatage illisible à null', async () => {
    vi.mocked(fetchJson).mockResolvedValue(reponse({ ...MESURE, timestamp: 42 }))

    const details = await loadDetails()

    expect(details.SITE001.at).toBeNull()
  })

  it.each([null, 'inattendu', { data: [] }])(
    'refuse une réponse qu’il ne sait pas lire : %j',
    async (body) => {
      vi.mocked(fetchJson).mockResolvedValue(body)

      await expect(loadDetails()).rejects.toThrow('Forme de réponse non reconnue')
    },
  )

  it('laisse remonter l’échec de l’appel réseau', async () => {
    // Pas de repli silencieux : l'appelant doit savoir que rien n'est arrivé.
    vi.mocked(fetchJson).mockRejectedValue(new Error('Statut 503'))

    await expect(loadDetails()).rejects.toThrow('Statut 503')
  })
})

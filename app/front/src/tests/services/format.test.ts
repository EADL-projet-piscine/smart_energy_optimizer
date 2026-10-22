import { describe, expect, it } from 'vitest'
import { formatCollectedAt, formatHour, formatTime, hourOf, toIsoUtc } from '../../services/format'

// Ces tests supposent TZ=Europe/Paris, fixé par le script npm : sans cela, ils
// passeraient sur une machine française et échoueraient en CI, qui tourne en UTC.

describe('toIsoUtc', () => {
  it('ajoute le fuseau manquant', () => {
    // /stats/summary date sans fuseau alors qu'il s'agit d'UTC.
    expect(toIsoUtc('2026-10-22T07:05:19.904319')).toBe('2026-10-22T07:05:19.904319Z')
  })

  it('laisse intact un horodatage déjà daté', () => {
    expect(toIsoUtc('2026-10-22T07:05:19Z')).toBe('2026-10-22T07:05:19Z')
    expect(toIsoUtc('2026-10-22T09:05:19+02:00')).toBe('2026-10-22T09:05:19+02:00')
  })
})

describe('formatCollectedAt', () => {
  it('lit un horodatage nu comme de l’UTC', () => {
    // Sans toIsoUtc, JavaScript l'interpréterait comme de l'heure locale et
    // afficherait 07:05 au lieu de 09:05 : deux heures d'écart silencieuses.
    expect(formatCollectedAt('2026-10-22T07:05:19')).toBe('09:05')
  })

  it('laisse passer une heure déjà formatée', () => {
    expect(formatCollectedAt('21:00')).toBe('21:00')
  })

  it('rend la valeur brute quand elle n’est pas une date', () => {
    expect(formatCollectedAt('bientôt')).toBe('bientôt')
  })
})

describe('formatHour', () => {
  it('rend l’heure entamée, sans arrondir', () => {
    // Les points de l'historique tombent à 09h32, 10h32… c'est « le relevé
    // de 9h », pas celui de 10h.
    expect(formatHour('2026-10-22T07:32:00Z')).toBe('09h00')
    expect(formatHour('2026-10-22T07:57:00Z')).toBe('09h00')
  })

  it('ne fait jamais paraître une mesure plus récente qu’elle n’est', () => {
    expect(formatHour('2026-10-22T07:01:00Z')).toBe('09h00')
    expect(formatHour('2026-10-22T07:59:00Z')).toBe('09h00')
  })
})

describe('formatTime', () => {
  it('garde la minute exacte', () => {
    expect(formatTime('2026-10-22T11:04:00Z')).toBe('13h04')
  })

  it('n’arrondit pas', () => {
    expect(formatTime('2026-10-22T11:57:00Z')).toBe('13h57')
  })
})

describe('hourOf', () => {
  it('rend l’heure locale', () => {
    expect(hourOf('2026-10-22T07:32:00Z')).toBe(9)
  })

  it('rend 0 sur une valeur illisible', () => {
    expect(hourOf('pas une date')).toBe(0)
  })
})

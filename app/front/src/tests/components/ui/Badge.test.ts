import { describe, expect, it } from 'vitest'
import { badgeTone } from '../../../components/ui/Badge'

describe('badgeTone', () => {
  it('passe en ambre sur un relevé interrompu', () => {
    expect(badgeTone('Relevé interrompu')).toBe('ambre')
  })

  it('passe au vert sur un état nominal', () => {
    expect(badgeTone('Stable')).toBe('ok')
    expect(badgeTone('Nominal')).toBe('ok')
  })

  it('alerte par défaut', () => {
    // Un badge inconnu doit attirer l'œil plutôt que passer pour normal.
    expect(badgeTone('Dépassement prévu')).toBe('alert')
    expect(badgeTone('Alerte critique')).toBe('alert')
    expect(badgeTone('Quelque chose d’inattendu')).toBe('alert')
  })

  it('ignore la casse', () => {
    expect(badgeTone('RELEVÉ INTERROMPU')).toBe('ambre')
  })
})

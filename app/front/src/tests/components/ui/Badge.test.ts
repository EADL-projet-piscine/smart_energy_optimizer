import { describe, expect, it } from 'vitest'
import { badgeTone } from '../../../components/ui/Badge'

describe('badgeTone', () => {
  it('turns amber on an interrupted reading', () => {
    expect(badgeTone('Relevé interrompu')).toBe('ambre')
  })

  it('turns green on a nominal state', () => {
    expect(badgeTone('Stable')).toBe('ok')
    expect(badgeTone('Nominal')).toBe('ok')
  })

  it('alerts by default', () => {
    // An unknown badge must catch the eye rather than pass for normal.
    expect(badgeTone('Dépassement prévu')).toBe('alert')
    expect(badgeTone('Alerte critique')).toBe('alert')
    expect(badgeTone('Quelque chose d’inattendu')).toBe('alert')
  })

  it('ignores the case', () => {
    expect(badgeTone('RELEVÉ INTERROMPU')).toBe('ambre')
  })
})

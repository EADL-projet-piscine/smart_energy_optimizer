import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../api/client'
import { Login, signInError } from '../../screens/Login'
import { SessionNotKeptError } from '../../services/session'

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
}

describe('Login', () => {
  it('sends the trimmed e-mail and the password', async () => {
    const onSignIn = vi.fn().mockResolvedValue(undefined)
    render(<Login onSignIn={onSignIn} />)

    fill('  ada@example.com ', 'correct horse')

    await waitFor(() => expect(onSignIn).toHaveBeenCalledWith('ada@example.com', 'correct horse'))
  })

  it('blocks a second submission while the first one runs', () => {
    render(<Login onSignIn={() => new Promise(() => {})} />)

    fill('ada@example.com', 'correct horse')

    expect(screen.getByRole('button', { name: 'Connexion…' })).toBeDisabled()
  })

  it('says the credentials are wrong and clears the password', async () => {
    render(<Login onSignIn={vi.fn().mockRejectedValue(new HttpError(401))} />)

    fill('ada@example.com', 'wrong')

    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiant ou mot de passe incorrect.')
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
  })
})

describe('signInError', () => {
  it.each([
    [new HttpError(401), 'Identifiant ou mot de passe incorrect.'],
    [new SessionNotKeptError(), 'le site doit être servi en HTTPS'],
    [new HttpError(503), 'n’a pas accès aux comptes'],
    [new Error('Aborted'), 'l’API métier ne répond pas'],
    ['not an error', 'l’API métier ne répond pas'],
  ])('explains %s', (cause, message) => {
    expect(signInError(cause)).toContain(message)
  })
})

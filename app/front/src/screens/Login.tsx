import { type FormEvent, useState } from 'react'
import { HttpError } from '../api/client'
import { IconBolt } from '../components/Icons'
import { Card } from '../components/ui/Card'
import { SessionNotKeptError } from '../services/session'

type Props = {
  /** Rejette en cas d'échec ; l'écran en tire le message à afficher. */
  onSignIn: (email: string, password: string) => Promise<void>
}

const field =
  'w-full rounded-[10px] border border-bordure-forte bg-inset px-3 py-2.5 text-[15px] text-encre outline-none focus-visible:border-lien focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lien'

const fieldLabel = 'text-[11px] font-[650] tracking-[0.08em] text-discret uppercase'

/** Message affichable d'un échec de connexion. */
export function signInError(cause: unknown): string {
  if (cause instanceof HttpError && cause.status === 401) return 'Identifiant ou mot de passe incorrect.'
  if (cause instanceof SessionNotKeptError)
    return 'Connexion acceptée, mais le navigateur n’a pas gardé la session : le site doit être servi en HTTPS.'
  if (cause instanceof HttpError && cause.status === 503)
    return 'Connexion indisponible : l’API métier n’a pas accès aux comptes.'
  return 'Connexion impossible : l’API métier ne répond pas.'
}

export function Login({ onSignIn }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await onSignIn(email.trim(), password)
    } catch (cause) {
      setError(signInError(cause))
      // Le mot de passe refusé ne reste pas dans le champ.
      setPassword('')
      setPending(false)
    }
  }

  return (
    <div className="mx-auto grid min-h-screen w-[min(420px,calc(100%-32px))] content-center py-10">
      <div className="mb-5 flex items-center gap-2.5 text-lg font-[650] tracking-[-0.02em]">
        <span className="grid size-7 place-items-center text-mesure [&_svg]:size-[22px]">
          <IconBolt />
        </span>
        <span>EnerVision</span>
      </div>

      <Card className="mt-0">
        <h1 className="m-0 text-[24px] font-[650] tracking-[-0.03em]">Connexion</h1>
        <p className="mt-1 text-[13.5px] text-secondaire">Accès réservé aux comptes EnerVision.</p>

        <form onSubmit={submit} className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className={fieldLabel}>Adresse e-mail</span>
            <input
              className={field}
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="grid gap-1.5">
            <span className={fieldLabel}>Mot de passe</span>
            <input
              className={field}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && (
            <p role="alert" className="m-0 text-[13.5px] text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 rounded-[10px] border-0 bg-accent px-4 py-2.5 text-[15px] font-[650] text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien disabled:opacity-60"
          >
            {pending ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </Card>
    </div>
  )
}

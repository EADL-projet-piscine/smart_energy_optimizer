import { useState } from 'react'
import { Accounts } from './screens/Accounts'
import { Dashboard } from './screens/Dashboard'
import { Login } from './screens/Login'
import { useSession } from './services/useSession'

export default function App() {
  const { state, login, logout } = useSession()
  const [view, setView] = useState<'dashboard' | 'accounts'>('dashboard')

  // Rien tant que l'on ne sait pas s'il faut se connecter : afficher le dashboard
  // une fraction de seconde avant l'écran de connexion serait trompeur.
  if (state.status === 'loading') return null
  if (state.status === 'signed-out') return <Login onSignIn={login} />

  const account = state.account
  const isAdmin = account?.roles.includes('admin') ?? false

  // L'API refuse de toute façon la gestion des comptes à un autre rôle (403) :
  // ne pas proposer l'écran évite seulement une impasse.
  if (view === 'accounts' && account && isAdmin) {
    return <Accounts currentUserId={account.id} onBack={() => setView('dashboard')} />
  }

  return (
    <Dashboard
      account={
        account
          ? {
              name: account.displayName,
              onSignOut: () => void logout(),
              onOpenAccounts: isAdmin ? () => setView('accounts') : undefined,
            }
          : null
      }
    />
  )
}

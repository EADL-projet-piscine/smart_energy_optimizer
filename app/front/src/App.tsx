import { Dashboard } from './screens/Dashboard'
import { Login } from './screens/Login'
import { useSession } from './services/useSession'

export default function App() {
  const { state, login, logout } = useSession()

  // Rien tant que l'on ne sait pas s'il faut se connecter : afficher le dashboard
  // une fraction de seconde avant l'écran de connexion serait trompeur.
  if (state.status === 'loading') return null
  if (state.status === 'signed-out') return <Login onSignIn={login} />

  const account = state.account
  return (
    <Dashboard account={account ? { name: account.displayName, onSignOut: () => void logout() } : null} />
  )
}

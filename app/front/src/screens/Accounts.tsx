import { type FormEvent, useState } from 'react'
import { Card } from '../components/ui/Card'
import { Caption, Label } from '../components/ui/Text'
import {
  type AccountChanges,
  type ManagedAccount,
  type NewAccount,
  ROLE_LABELS,
  ROLES,
  type Role,
  type SiteRef,
} from '../services/accounts'
import { accountError, useAccounts } from '../services/useAccounts'

const field =
  'w-full rounded-[10px] border border-bordure-forte bg-inset px-3 py-2 text-[14px] text-encre outline-none focus-visible:border-lien focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lien disabled:opacity-60'
const fieldLabel = 'text-[11px] font-[650] tracking-[0.08em] text-discret uppercase'
const primary =
  'rounded-[10px] border-0 bg-accent px-4 py-2 text-[14px] font-[650] text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien disabled:opacity-60'
const secondary =
  'rounded-[10px] border border-bordure-forte bg-transparent px-3 py-1.5 text-[13px] text-secondaire hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lien'

type FormValues = {
  email: string
  displayName: string
  password: string
  role: Role
  isActive: boolean
  siteIds: string[]
}

type FormProps = {
  /** Absent : création d'un compte. */
  account?: ManagedAccount
  /** Le compte est celui de l'administrateur connecté : il ne peut pas se retirer ses droits. */
  isSelf?: boolean
  sites: SiteRef[]
  accounts: ManagedAccount[]
  onSubmit: (values: FormValues) => Promise<void>
  onCancel?: () => void
}

function AccountForm({ account, isSelf = false, sites, accounts, onSubmit, onCancel }: FormProps) {
  const initial: FormValues = {
    email: account?.email ?? '',
    displayName: account?.displayName ?? '',
    password: '',
    role: account?.role ?? 'viewer',
    isActive: account?.isActive ?? true,
    siteIds: account?.siteIds ?? [],
  }
  const [values, setValues] = useState<FormValues>(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creating = account === undefined

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function toggleSite(siteId: string) {
    set(
      'siteIds',
      values.siteIds.includes(siteId)
        ? values.siteIds.filter((id) => id !== siteId)
        : [...values.siteIds, siteId],
    )
  }

  /** Nom du client actuel d'un site, s'il en a un autre que ce compte. */
  function otherClient(site: SiteRef): string | null {
    if (site.clientId === null || site.clientId === account?.id) return null
    return accounts.find((candidate) => candidate.id === site.clientId)?.displayName ?? 'un autre compte'
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await onSubmit(values)
      if (creating) setValues(initial)
    } catch (cause) {
      setError(accountError(cause))
    } finally {
      setPending(false)
      set('password', '')
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3">
      <div className="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
        {creating && (
          <label className="grid gap-1.5">
            <span className={fieldLabel}>Adresse e-mail</span>
            <input
              className={field}
              type="email"
              required
              value={values.email}
              onChange={(event) => set('email', event.target.value)}
            />
          </label>
        )}
        <label className="grid gap-1.5">
          <span className={fieldLabel}>Nom affiché</span>
          <input
            className={field}
            required
            value={values.displayName}
            onChange={(event) => set('displayName', event.target.value)}
          />
        </label>
        <label className="grid gap-1.5">
          <span className={fieldLabel}>Rôle</span>
          <select
            className={field}
            value={values.role}
            disabled={isSelf}
            onChange={(event) => set('role', event.target.value as Role)}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className={fieldLabel}>{creating ? 'Mot de passe' : 'Nouveau mot de passe'}</span>
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            minLength={12}
            required={creating}
            placeholder={creating ? '12 caractères au moins' : 'Inchangé si vide'}
            value={values.password}
            onChange={(event) => set('password', event.target.value)}
          />
        </label>
      </div>

      {!creating && (
        <label className="flex items-center gap-2 text-[14px] text-encre">
          <input
            type="checkbox"
            checked={values.isActive}
            disabled={isSelf}
            onChange={(event) => set('isActive', event.target.checked)}
          />
          Compte actif
        </label>
      )}

      {values.role === 'viewer' ? (
        <fieldset className="m-0 grid gap-1.5 border-0 p-0">
          <legend className={fieldLabel}>Sites dont ce compte est le client</legend>
          {sites.length === 0 && <Caption>Aucun site en base.</Caption>}
          {sites.map((site) => {
            const other = otherClient(site)
            return (
              <label key={site.id} className="flex items-center gap-2 text-[14px] text-encre">
                <input
                  type="checkbox"
                  aria-label={site.name}
                  checked={values.siteIds.includes(site.id)}
                  onChange={() => toggleSite(site.id)}
                />
                <span>{site.name}</span>
                {other && <span className="text-[12.5px] text-discret">— client actuel : {other}</span>}
              </label>
            )
          })}
        </fieldset>
      ) : (
        <Caption>Un {ROLE_LABELS[values.role].toLowerCase()} voit tout le parc.</Caption>
      )}

      {error && (
        <p role="alert" className="m-0 text-[13.5px] text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={pending}>
          {creating ? 'Créer le compte' : 'Enregistrer'}
        </button>
        {onCancel && (
          <button type="button" className={secondary} onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
    </form>
  )
}

/** Les champs modifiés, et seulement eux : le serveur journalise ce qui a changé. */
export function changesOf(account: ManagedAccount, values: FormValues): AccountChanges {
  const changes: AccountChanges = {}
  if (values.displayName.trim() !== account.displayName) changes.displayName = values.displayName.trim()
  if (values.isActive !== account.isActive) changes.isActive = values.isActive
  if (values.role !== account.role) changes.role = values.role
  const sites = values.role === 'viewer' ? values.siteIds : []
  if ([...sites].sort().join() !== [...account.siteIds].sort().join()) changes.siteIds = sites
  if (values.password !== '') changes.password = values.password
  return changes
}

function sitesLabel(account: ManagedAccount): string {
  if (account.role !== 'viewer') return 'Tout le parc'
  if (account.siteIds.length === 0) return 'Aucun site'
  return account.siteIds.join(', ')
}

type Props = {
  currentUserId: string
  onBack: () => void
}

export function Accounts({ currentUserId, onBack }: Props) {
  const { data, error, create, update } = useAccounts()
  const [editingId, setEditingId] = useState<string | null>(null)

  async function createFrom(values: FormValues) {
    const account: NewAccount = {
      email: values.email.trim(),
      displayName: values.displayName.trim(),
      password: values.password,
      role: values.role,
      siteIds: values.siteIds,
    }
    await create(account)
  }

  return (
    <div className="mx-auto w-[min(1180px,calc(100%-40px))] pt-[22px] pb-16 max-[680px]:w-[min(1180px,calc(100%-24px))]">
      <header className="mb-7 flex items-center justify-between">
        <h1 className="m-0 text-[28px] font-[650] tracking-[-0.035em]">Comptes</h1>
        <button type="button" className={secondary} onClick={onBack}>
          Retour au tableau de bord
        </button>
      </header>

      {error && (
        <p role="alert" className="m-0 text-[14px] text-danger">
          Comptes indisponibles : {error}
        </p>
      )}
      {!data && !error && <Caption>Chargement des comptes…</Caption>}

      {data && (
        <>
          <Card className="mt-0">
            <Label>Nouveau compte</Label>
            <AccountForm sites={data.sites} accounts={data.accounts} onSubmit={createFrom} />
          </Card>

          <Card>
            <Label>{`${data.accounts.length} compte${data.accounts.length > 1 ? 's' : ''}`}</Label>
            <ul className="m-0 mt-2 list-none p-0">
              {data.accounts.map((account) => (
                <li key={account.id} className="border-t border-bordure py-3 first:border-t-0">
                  <div className="flex items-start justify-between gap-4 max-[680px]:flex-col">
                    <div>
                      <p className="m-0 text-[15px] font-[650] text-encre">
                        {account.displayName}
                        {!account.isActive && (
                          <span className="ml-2 text-[12.5px] font-normal text-danger">désactivé</span>
                        )}
                      </p>
                      <Caption>
                        {account.email} · {account.role ? ROLE_LABELS[account.role] : 'sans rôle'} ·{' '}
                        {sitesLabel(account)}
                      </Caption>
                    </div>
                    {editingId !== account.id && (
                      <button
                        type="button"
                        className={secondary}
                        onClick={() => setEditingId(account.id)}
                        aria-label={`Modifier ${account.displayName}`}
                      >
                        Modifier
                      </button>
                    )}
                  </div>
                  {editingId === account.id && (
                    <AccountForm
                      account={account}
                      isSelf={account.id === currentUserId}
                      sites={data.sites}
                      accounts={data.accounts}
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (values) => {
                        await update(account.id, changesOf(account, values))
                        setEditingId(null)
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

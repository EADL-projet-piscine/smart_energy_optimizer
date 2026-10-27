import { fetchJson } from '../api/client'

export type Role = 'admin' | 'operator' | 'viewer'

export const ROLES: Role[] = ['admin', 'operator', 'viewer']

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  operator: 'Exploitant',
  viewer: 'Lecteur',
}

/** Un compte, tel que le liste `GET /api/comptes`. */
export type ManagedAccount = {
  id: string
  email: string
  displayName: string
  isActive: boolean
  role: Role | null
  /** Sites dont le compte est le client ; ne compte que pour un lecteur. */
  siteIds: string[]
}

export type SiteRef = {
  id: string
  name: string
  /** Compte client du site, ou `null` s'il n'en a pas. */
  clientId: string | null
}

export type AccountsData = { accounts: ManagedAccount[]; sites: SiteRef[] }

export type NewAccount = {
  email: string
  displayName: string
  password: string
  role: Role
  siteIds: string[]
}

export type AccountChanges = Partial<{
  displayName: string
  isActive: boolean
  role: Role
  siteIds: string[]
  password: string
}>

type Raw = Record<string, unknown>

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value)
}

export function normalizeAccount(raw: unknown): ManagedAccount {
  const account = (raw ?? {}) as Raw
  return {
    id: text(account.id),
    email: text(account.email),
    displayName: text(account.display_name) || text(account.email),
    isActive: account.is_active !== false,
    // Un compte a un seul rôle ; une liste vide ou inconnue n'en donne aucun.
    role: texts(account.roles).find(isRole) ?? null,
    siteIds: texts(account.site_ids),
  }
}

/** Lit la réponse de `GET /api/comptes`, sans faire confiance à sa forme. */
export function normalizeAccounts(payload: unknown): AccountsData {
  const body = (payload ?? {}) as Raw
  const accounts = Array.isArray(body.comptes) ? body.comptes.map(normalizeAccount) : []
  const sites = Array.isArray(body.sites)
    ? body.sites.map((raw) => {
        const site = (raw ?? {}) as Raw
        const id = text(site.site_id)
        return { id, name: text(site.site_name) || id, clientId: text(site.client_user_id) || null }
      })
    : []
  return {
    accounts: accounts.filter((account) => account.id !== ''),
    sites: sites.filter((site) => site.id !== ''),
  }
}

export async function loadAccounts(signal?: AbortSignal): Promise<AccountsData> {
  return normalizeAccounts(await fetchJson('/api/comptes', signal))
}

export async function createAccount(account: NewAccount): Promise<ManagedAccount> {
  return normalizeAccount(
    await fetchJson('/api/comptes', undefined, 'POST', {
      email: account.email,
      display_name: account.displayName,
      password: account.password,
      role: account.role,
      // Les sites n'ont de sens que pour un lecteur : les autres voient tout le parc.
      site_ids: account.role === 'viewer' ? account.siteIds : [],
    }),
  )
}

export async function updateAccount(id: string, changes: AccountChanges): Promise<ManagedAccount> {
  const body: Raw = {}
  if (changes.displayName !== undefined) body.display_name = changes.displayName
  if (changes.isActive !== undefined) body.is_active = changes.isActive
  if (changes.role !== undefined) body.role = changes.role
  if (changes.siteIds !== undefined) body.site_ids = changes.siteIds
  if (changes.password !== undefined && changes.password !== '') body.password = changes.password
  return normalizeAccount(await fetchJson(`/api/comptes/${encodeURIComponent(id)}`, undefined, 'PATCH', body))
}

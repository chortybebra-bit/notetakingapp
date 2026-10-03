const STORAGE_KEY = 'folio-spaces'

const COLORS = ['#d06a3a', '#2f6f5e', '#3d5a80', '#8c3d55', '#6b5b2a', '#3f5d3a', '#7a4e2d', '#5b4b8a']
const ADJECTIVES = ['Quiet', 'Amber', 'Swift', 'Hollow', 'Silver', 'Gentle', 'Distant', 'Copper', 'Velvet', 'Lucid', 'Patient', 'Northern']
const NOUNS = ['Heron', 'Lantern', 'Fox', 'Cedar', 'Comet', 'Otter', 'Harbor', 'Moth', 'Raven', 'Willow', 'Badger', 'Signal']

export type Identity = {
  name: string
  color: string
}

/** One saved space. The alias belongs to this space only, so spaces cannot be linked by name. */
export type SavedSpace = {
  vaultId: string
  secret: string
  name: string
  identity: Identity
}

function pick<T>(items: T[]) {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % items.length
  return items[index]
}

export function randomIdentity(): Identity {
  return { name: `${pick(ADJECTIVES)} ${pick(NOUNS)}`, color: pick(COLORS) }
}

export function loadSpaces(): SavedSpace[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as SavedSpace[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((space) => space && space.vaultId && space.secret)
      .map((space) => ({
        ...space,
        identity: space.identity?.name ? space.identity : randomIdentity(),
      }))
  } catch {
    return []
  }
}

function saveSpaces(spaces: SavedSpace[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(spaces))
}

export function findSpace(vaultId: string) {
  return loadSpaces().find((space) => space.vaultId === vaultId) ?? null
}

export function upsertSpace(vaultId: string, secret: string, patch: Partial<Omit<SavedSpace, 'vaultId' | 'secret'>> = {}) {
  const spaces = loadSpaces()
  const existing = spaces.find((space) => space.vaultId === vaultId)
  const next: SavedSpace = {
    vaultId,
    secret,
    name: patch.name ?? existing?.name ?? 'Shared space',
    identity: patch.identity ?? existing?.identity ?? randomIdentity(),
  }
  saveSpaces([next, ...spaces.filter((space) => space.vaultId !== vaultId)])
  return next
}

export function forgetSpace(vaultId: string) {
  saveSpaces(loadSpaces().filter((space) => space.vaultId !== vaultId))
}

export function forgetAll() {
  localStorage.clear()
  sessionStorage.clear()
}

export function generateSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const VAULT_RE = /^[0-9a-f-]{36}$/
const SECRET_RE = /^[A-Za-z0-9_-]{40,90}$/

/** Reads `#v=<id>&k=<key>` (an invite) or `#v=<id>` (a space already saved here). */
export function readHash(hash: string): { vaultId: string; secret: string | null } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const vaultId = params.get('v')
  if (!vaultId || !VAULT_RE.test(vaultId)) return null
  const secret = params.get('k')
  return { vaultId, secret: secret && SECRET_RE.test(secret) ? secret : null }
}

export function inviteLink(vaultId: string, secret: string) {
  return `${location.origin}/#v=${vaultId}&k=${secret}`
}

import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import { deriveKey, open, roomId, seal } from '../../shared/e2ee.mjs'
import { relaySocket } from './relaySocket'

const API = '/relay'

/** Message kinds, carried inside the ciphertext so the relay cannot tell them apart. */
const KIND_UPDATE = 0
const KIND_AWARENESS = 1
const KIND_QUERY = 2

/**
 * Room labels stay on this device (they name the local IndexedDB copy).
 * The relay only ever sees `roomId(secret, label)`.
 */
export function metaRoom(vaultId: string) {
  return `folio:${vaultId}:meta`
}

export function pageRoom(vaultId: string, pageId: string) {
  return `folio:${vaultId}:page:${pageId}`
}

export type Provider = { awareness: Awareness }

export type RoomHandle = {
  doc: Y.Doc
  provider: Provider
  ready: Promise<void>
  release: () => void
}

type Entry = {
  doc: Y.Doc
  provider: Provider
  ready: Promise<void>
  refs: number
  closeTimer: number | null
  close: () => void
}

const pool = new Map<string, Entry>()

const roomUrl = (room: string, action: 'updates' | 'compact') =>
  `${API}/rooms/${encodeURIComponent(room)}/${action}`

async function fetchLog(room: string) {
  const response = await fetch(roomUrl(room, 'updates'), { cache: 'no-store' })
  if (!response.ok) throw new Error(`relay ${response.status}`)
  return (await response.json()) as { length: number; items: string[] }
}

async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function frame(kind: number, payload: Uint8Array) {
  const out = new Uint8Array(payload.length + 1)
  out[0] = kind
  out.set(payload, 1)
  return out
}

function createEntry(label: string, secret: string): Entry {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const persistence = new IndexeddbPersistence(label, doc)
  const socket = relaySocket()
  const idPromise = roomId(secret, label)
  const keyPromise = deriveKey(secret, label)

  const seen = new Set<string>()
  const pending: Uint8Array[] = []
  let flushTimer = 0
  let pollTimer = 0
  let closed = false
  let unsubscribe = () => {}

  const sendLive = async (kind: number, payload: Uint8Array) => {
    const [id, key] = await Promise.all([idPromise, keyPromise])
    socket.publish(id, await seal(key, frame(kind, payload)))
  }

  const compact = async () => {
    const [id, key] = await Promise.all([idPromise, keyPromise])
    const current = await fetchLog(id)
    const blob = await seal(key, Y.encodeStateAsUpdate(doc))
    await postJson(roomUrl(id, 'compact'), { baseCount: current.length, blob })
  }

  const flush = async () => {
    if (closed || pending.length === 0) return
    const merged = Y.mergeUpdates(pending.splice(0))
    try {
      const [id, key] = await Promise.all([idPromise, keyPromise])
      const blob = await seal(key, merged)
      const response = await postJson(roomUrl(id, 'updates'), { blob })
      if (response.status === 409) await compact()
      else if (!response.ok) throw new Error(`relay ${response.status}`)
      seen.add(blob)
    } catch {
      pending.unshift(merged)
      flushTimer = window.setTimeout(() => void flush(), 3000)
    }
  }

  const pull = async () => {
    const [id, key] = await Promise.all([idPromise, keyPromise])
    const log = await fetchLog(id)
    const remote = new Y.Doc()
    for (const blob of log.items) {
      try {
        const bytes = await open(key, blob)
        Y.applyUpdate(remote, bytes)
        if (!seen.has(blob)) Y.applyUpdate(doc, bytes, 'relay')
      } catch {
        // Ciphertext that fails authentication is ignored.
      }
      seen.add(blob)
    }
    if (!Y.equalSnapshots(Y.snapshot(remote), Y.snapshot(doc))) {
      pending.push(Y.encodeStateAsUpdate(doc, Y.encodeStateVector(remote)))
      void flush()
    }
    if (log.length >= 40) void compact().catch(() => {})
    remote.destroy()
  }

  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return
    void sendLive(KIND_UPDATE, update)
    pending.push(update)
    window.clearTimeout(flushTimer)
    flushTimer = window.setTimeout(() => void flush(), 400)
  }

  const onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === 'relay') return
    const changed = added.concat(updated, removed)
    void sendLive(KIND_AWARENESS, encodeAwarenessUpdate(awareness, changed))
  }

  const onMessage = async (blob: string) => {
    try {
      const bytes = await open(await keyPromise, blob)
      const kind = bytes[0]
      const payload = bytes.subarray(1)
      if (kind === KIND_UPDATE) Y.applyUpdate(doc, payload, 'relay')
      else if (kind === KIND_AWARENESS) applyAwarenessUpdate(awareness, payload, 'relay')
      else if (kind === KIND_QUERY) {
        void sendLive(KIND_AWARENESS, encodeAwarenessUpdate(awareness, [doc.clientID]))
      }
    } catch {
      // Wrong key or tampered frame.
    }
  }

  const onUnload = () => removeAwarenessStates(awareness, [doc.clientID], 'unload')

  const ready = Promise.race([
    persistence.whenSynced.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, 4000)),
  ])
    .then(() => pull().catch(() => {}))
    .then(() => idPromise)
    .then((id) => {
      if (closed) return
      doc.on('update', onDocUpdate)
      awareness.on('update', onAwarenessUpdate)
      window.addEventListener('beforeunload', onUnload)
      unsubscribe = socket.subscribe(id, {
        onMessage: (blob) => void onMessage(blob),
        onReconnect: () => {
          void pull().catch(() => {})
          void sendLive(KIND_QUERY, new Uint8Array())
          void sendLive(KIND_AWARENESS, encodeAwarenessUpdate(awareness, [doc.clientID]))
        },
      })
      if (socket.online) {
        void sendLive(KIND_QUERY, new Uint8Array())
      }
      pollTimer = window.setInterval(() => void pull().catch(() => {}), 20000)
    })

  return {
    doc,
    provider: { awareness },
    ready,
    refs: 0,
    closeTimer: null,
    close() {
      closed = true
      window.clearTimeout(flushTimer)
      window.clearInterval(pollTimer)
      onUnload()
      void flush()
      unsubscribe()
      window.removeEventListener('beforeunload', onUnload)
      doc.off('update', onDocUpdate)
      awareness.off('update', onAwarenessUpdate)
      awareness.destroy()
      persistence.destroy()
      doc.destroy()
    },
  }
}

export function openRoom(room: string, secret: string): RoomHandle {
  let entry = pool.get(room)
  if (!entry) {
    entry = createEntry(room, secret)
    pool.set(room, entry)
  }
  if (entry.closeTimer != null) {
    window.clearTimeout(entry.closeTimer)
    entry.closeTimer = null
  }
  entry.refs += 1
  const current = entry
  let released = false
  return {
    doc: current.doc,
    provider: current.provider,
    ready: current.ready,
    release() {
      if (released) return
      released = true
      current.refs -= 1
      if (current.refs > 0) return
      current.closeTimer = window.setTimeout(() => {
        if (current.refs > 0) return
        current.close()
        pool.delete(room)
      }, 80)
    },
  }
}

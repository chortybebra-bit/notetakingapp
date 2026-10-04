/**
 * Folio server: a blind relay plus the static app.
 *
 * Every payload that reaches this process is AES-GCM ciphertext made in a
 * browser. The server never receives keys, names, titles, or page text, and
 * it does not log requests or IP addresses.
 *
 *   GET  /relay/health
 *   GET  /relay/rooms/:room/updates      encrypted Yjs update log
 *   POST /relay/rooms/:room/updates      append one encrypted update
 *   POST /relay/rooms/:room/compact      replace the log with one snapshot
 *   WS   /relay                          live fan-out of encrypted messages
 *
 * With STATIC_DIR set, it also serves the built app from the same origin.
 */

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 4444)
const host = process.env.HOST || '127.0.0.1'
const dataDir = resolve(process.env.DATA_DIR || join(here, 'data'))
const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : null

const MAX_BLOB = 1_500_000
const MAX_LOG = 80
// Room names are HMAC-SHA256(key, label) in hex: random-looking, unlinkable without the key.
const ROOM_RE = /^[0-9a-f]{64}$/
const BLOB_RE = /^[A-Za-z0-9+/=]+$/

const isBlob = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_BLOB && BLOB_RE.test(value)

// Files this process creates (database, WAL, journal) are readable by its owner only.
process.umask(0o077)
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'folio.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS updates (
    seq  INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    blob BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS updates_by_room ON updates (room, seq);
`)

const countUpdates = db.prepare('SELECT COUNT(*) AS n FROM updates WHERE room = ?')
const listUpdates = db.prepare('SELECT blob FROM updates WHERE room = ? ORDER BY seq')
const insertUpdate = db.prepare('INSERT INTO updates (room, blob) VALUES (?, ?)')
const clearRoom = db.prepare('DELETE FROM updates WHERE room = ?')

function transaction(work) {
  db.exec('BEGIN IMMEDIATE')
  try {
    work()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const store = {
  count: (room) => Number(countUpdates.get(room).n),
  list: (room) => listUpdates.all(room).map((row) => Buffer.from(row.blob).toString('base64')),
  append: (room, blob) => insertUpdate.run(room, Buffer.from(blob, 'base64')),
  replace: (room, blob) =>
    transaction(() => {
      clearRoom.run(room)
      insertUpdate.run(room, Buffer.from(blob, 'base64'))
    }),
}

const legacyFile = join(dataDir, 'rooms.json')
if (existsSync(legacyFile)) {
  let legacy = null
  try {
    legacy = JSON.parse(readFileSync(legacyFile, 'utf8'))
  } catch {}
  if (legacy && typeof legacy === 'object') {
    transaction(() => {
      for (const [room, items] of Object.entries(legacy)) {
        if (!ROOM_RE.test(room) || !Array.isArray(items) || store.count(room) > 0) continue
        for (const blob of items) if (isBlob(blob)) store.append(room, blob)
      }
    })
    rmSync(legacyFile)
  }
}

const SECURITY_HEADERS = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BLOB + 10_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function handleRelay(req, res, url) {
  if (url.pathname === '/relay/health') {
    sendJson(res, 200, { ok: true })
    return
  }
  const match = url.pathname.match(/^\/relay\/rooms\/([^/]+)\/(updates|compact)$/)
  if (!match) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  const room = decodeURIComponent(match[1])
  const action = match[2]
  if (!ROOM_RE.test(room)) {
    sendJson(res, 400, { error: 'invalid room' })
    return
  }
  if (req.method === 'GET' && action === 'updates') {
    const items = store.list(room)
    sendJson(res, 200, { length: items.length, items })
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method' })
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    sendJson(res, 400, { error: 'bad body' })
    return
  }
  if (!isBlob(body.blob)) {
    sendJson(res, 400, { error: 'invalid blob' })
    return
  }

  const length = store.count(room)
  if (action === 'updates') {
    if (length >= MAX_LOG) {
      sendJson(res, 409, { error: 'compact', length })
      return
    }
    store.append(room, body.blob)
    sendJson(res, 200, { length: length + 1 })
    return
  }

  if (typeof body.baseCount !== 'number' || body.baseCount !== length) {
    sendJson(res, 409, { error: 'conflict', length })
    return
  }
  store.replace(room, body.blob)
  sendJson(res, 200, { length: 1 })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function serveStatic(req, res, url) {
  if (!staticDir) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method' })
    return
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
  let file = join(staticDir, path)
  if (!file.startsWith(staticDir)) {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }
  if (!path || !existsSync(file) || statSync(file).isDirectory()) {
    path = 'index.html'
    file = join(staticDir, path)
  }
  const immutable = path.startsWith('assets/')
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://folio.local')
  if (url.pathname === '/relay' || url.pathname.startsWith('/relay/')) {
    handleRelay(req, res, url).catch(() => sendJson(res, 500, { error: 'server' }))
    return
  }
  serveStatic(req, res, url)
})

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const topics = new Map()

function onConnection(conn) {
  const subscribed = new Set()
  let alive = true
  const heartbeat = setInterval(() => {
    if (!alive) {
      conn.terminate()
      return
    }
    alive = false
    conn.ping()
  }, 30_000)
  conn.on('pong', () => {
    alive = true
  })
  conn.on('close', () => {
    clearInterval(heartbeat)
    for (const name of subscribed) {
      const subs = topics.get(name)
      subs?.delete(conn)
      if (subs?.size === 0) topics.delete(name)
    }
  })
  conn.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!message || typeof message.type !== 'string') return

    if (message.type === 'subscribe' && Array.isArray(message.topics)) {
      for (const name of message.topics) {
        if (typeof name !== 'string' || !ROOM_RE.test(name)) continue
        if (!topics.has(name)) topics.set(name, new Set())
        topics.get(name).add(conn)
        subscribed.add(name)
      }
      return
    }
    if (message.type === 'unsubscribe' && Array.isArray(message.topics)) {
      for (const name of message.topics) {
        topics.get(name)?.delete(conn)
        subscribed.delete(name)
      }
      return
    }
    if (message.type === 'publish' && subscribed.has(message.topic) && isBlob(message.data)) {
      const out = JSON.stringify({ type: 'publish', topic: message.topic, data: message.data })
      for (const receiver of topics.get(message.topic) || []) {
        if (receiver !== conn && receiver.readyState === receiver.OPEN) receiver.send(out)
      }
    }
  })
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BLOB + 1024 })
wss.on('connection', onConnection)
server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url || '/', 'http://folio.local').pathname
  if (path !== '/relay') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.log(`Port ${port} is already in use`)
    process.exit(0)
  }
  console.error(error)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    db.close()
    process.exit(0)
  })
}

server.listen(port, host, () => {
  console.log(`Folio on http://${host}:${port}${staticDir ? '' : ' (relay only)'}`)
})

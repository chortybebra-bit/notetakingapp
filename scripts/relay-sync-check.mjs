// Checks the relay stores only ciphertext and that only the right key opens it.
// Usage: node scripts/relay-sync-check.mjs [http://127.0.0.1:4444]
import * as Y from 'yjs'
import { deriveKey, open, roomId, seal } from '../shared/e2ee.mjs'

const base = (process.argv[2] || process.env.RELAY_ORIGIN || 'http://127.0.0.1:4444').replace(/\/$/, '')
const label = `folio:${crypto.randomUUID()}:page:${crypto.randomUUID()}`
const secret = 'test-secret-key-with-enough-length-0123456789abcd'
const marker = 'sprint plan secret 9182'
const room = await roomId(secret, label)
const url = `${base}/relay/rooms/${room}/updates`

if (room.includes(label.split(':')[1])) throw new Error('room id leaks the space id')
const health = await fetch(`${base}/relay/health`)
if (!health.ok) throw new Error(`relay not running at ${base}`)

const key = await deriveKey(secret, label)
const doc = new Y.Doc()
doc.getText('t').insert(0, marker)
const blob = await seal(key, Y.encodeStateAsUpdate(doc))
const longer = new Y.Doc()
longer.getText('t').insert(0, marker.repeat(8))
if ((await seal(key, Y.encodeStateAsUpdate(longer))).length !== blob.length) {
  throw new Error('padding does not hide the size difference')
}

const posted = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ blob }),
})
if (!posted.ok) throw new Error(await posted.text())

const { items } = await (await fetch(url)).json()
const stored = items[0]
if (!stored || stored.includes('sprint') || stored.includes('9182')) throw new Error('relay stored plaintext')

const copy = new Y.Doc()
Y.applyUpdate(copy, await open(key, stored))
if (copy.getText('t').toString() !== marker) throw new Error('roundtrip mismatch')

const wrong = await deriveKey('wrong-key-wrong-key-wrong-key-wrong', label)
const opened = await open(wrong, stored).then(() => true, () => false)
if (opened) throw new Error('wrong key was accepted')

console.log('relay check ok: opaque room id, padded ciphertext, right key opens it, wrong key rejected')

/**
 * AES-GCM helpers for Folio's blind relay.
 * The relay stores and forwards these blobs; it never receives the key.
 *
 * Browsers expose crypto.subtle only on https, .onion, and localhost. Elsewhere
 * (plain http) the same algorithms run in pure JavaScript via @noble, producing
 * identical keys, room ids, and ciphertext, so both kinds of client interoperate.
 */

import { gcm } from '@noble/ciphers/aes.js'
import { hmac } from '@noble/hashes/hmac.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'

const ITERATIONS = 100000
const enc = new TextEncoder()
const cache = new Map()

const subtle = () => globalThis.crypto?.subtle

function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function derive(secret, room) {
  const salt = enc.encode(`folio-relay:${room}`)
  const native = subtle()
  if (!native) return pbkdf2Async(sha256, enc.encode(secret), salt, { c: ITERATIONS, dkLen: 32 })
  const material = await native.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return native.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Returns a CryptoKey when crypto.subtle exists, otherwise the raw 32-byte key. */
export function deriveKey(secret, room) {
  const id = `${secret}\0${room}`
  if (!cache.has(id)) cache.set(id, derive(secret, room))
  return cache.get(id)
}

export async function encryptBytes(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher =
    key instanceof Uint8Array
      ? gcm(key, iv).encrypt(data)
      : new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, data))
  const out = new Uint8Array(iv.length + cipher.length)
  out.set(iv, 0)
  out.set(cipher, iv.length)
  return bytesToBase64(out)
}

export async function decryptBytes(key, blob) {
  const raw = base64ToBytes(blob)
  if (raw.length < 13) throw new Error('ciphertext too short')
  const iv = raw.slice(0, 12)
  const cipher = raw.slice(12)
  if (key instanceof Uint8Array) return gcm(key, iv).decrypt(cipher)
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, cipher))
}

/**
 * The server-side name for a room: HMAC-SHA256(secret, label) in hex.
 * Without the key, room names look random and cannot be linked to a space,
 * to each other, or to the page ids inside the space.
 */
export async function roomId(secret, label) {
  const message = enc.encode(`folio-room:${label}`)
  const native = subtle()
  let mac
  if (native) {
    const key = await native.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    mac = new Uint8Array(await native.sign('HMAC', key, message))
  } else {
    mac = hmac(sha256, enc.encode(secret), message)
  }
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const MIN_PADDED = 512

/** Pads to the next power of two (at least 512 bytes) so sizes reveal little. */
function pad(data) {
  let size = MIN_PADDED
  while (size < data.length + 4) size *= 2
  const out = new Uint8Array(size)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(data, 4)
  return out
}

function unpad(data) {
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0)
  if (length > data.length - 4) throw new Error('bad padding')
  return data.slice(4, 4 + length)
}

/** Encrypts with padding. Use for everything that goes to the relay. */
export function seal(key, data) {
  return encryptBytes(key, pad(data))
}

export async function open(key, blob) {
  return unpad(await decryptBytes(key, blob))
}

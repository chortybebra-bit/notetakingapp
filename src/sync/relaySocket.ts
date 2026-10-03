type Listener = {
  onMessage: (blob: string) => void
  onReconnect: () => void
}

/**
 * One WebSocket to the relay, shared by every open room. Rooms are
 * re-subscribed after a reconnect, and listeners are told so they can
 * catch up on anything they missed.
 */
class RelaySocket {
  private ws: WebSocket | null = null
  private rooms = new Map<string, Set<Listener>>()
  private retry = 0
  private timer = 0
  private statusListeners = new Set<(online: boolean) => void>()
  online = false

  constructor(private url: string) {}

  subscribe(room: string, listener: Listener) {
    let set = this.rooms.get(room)
    if (!set) {
      set = new Set()
      this.rooms.set(room, set)
      this.send({ type: 'subscribe', topics: [room] })
    }
    set.add(listener)
    this.ensure()
    return () => {
      const current = this.rooms.get(room)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) {
        this.rooms.delete(room)
        this.send({ type: 'unsubscribe', topics: [room] })
      }
    }
  }

  publish(room: string, blob: string) {
    this.send({ type: 'publish', topic: room, data: blob })
  }

  onStatus(cb: (online: boolean) => void) {
    this.statusListeners.add(cb)
    cb(this.online)
    return () => {
      this.statusListeners.delete(cb)
    }
  }

  private setOnline(online: boolean) {
    if (this.online === online) return
    this.online = online
    this.statusListeners.forEach((cb) => cb(online))
  }

  private send(message: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  private ensure() {
    if (this.ws || this.timer) return
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.setOnline(true)
      this.send({ type: 'subscribe', topics: [...this.rooms.keys()] })
      this.rooms.forEach((set) => set.forEach((listener) => listener.onReconnect()))
    }
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; topic?: string; data?: string }
        if (message.type !== 'publish' || !message.topic || typeof message.data !== 'string') return
        this.rooms.get(message.topic)?.forEach((listener) => listener.onMessage(message.data as string))
      } catch {
        // Ignore malformed frames.
      }
    }
    ws.onclose = () => {
      this.ws = null
      this.setOnline(false)
      const delay = Math.min(15000, 500 * 2 ** this.retry++)
      this.timer = window.setTimeout(() => {
        this.timer = 0
        this.ensure()
      }, delay)
    }
  }
}

let shared: RelaySocket | null = null

export function relaySocket() {
  if (!shared) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    shared = new RelaySocket(`${scheme}://${location.host}/relay`)
  }
  return shared
}

import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { relaySocket } from '../sync/relaySocket'

export type PresenceUser = {
  name?: string
  color?: string
  pageTitle?: string
}

export type Peer = PresenceUser & {
  clientId: number
  self: boolean
}

export function usePeers(awareness: Awareness | null) {
  const [peers, setPeers] = useState<Peer[]>([])
  useEffect(() => {
    if (!awareness) return
    const update = () => {
      const next: Peer[] = []
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as PresenceUser | undefined
        if (!user) return
        next.push({ clientId, self: clientId === awareness.clientID, ...user })
      })
      setPeers(next)
    }
    awareness.on('change', update)
    update()
    return () => awareness.off('change', update)
  }, [awareness])
  return peers
}

export function useRelayOnline() {
  const [online, setOnline] = useState(relaySocket().online)
  useEffect(() => relaySocket().onStatus(setOnline), [])
  return online
}

import { useEffect, useState } from 'react'
import { HomeScreen } from './components/HomeScreen'
import { Workspace } from './components/Workspace'
import { findSpace, readHash, upsertSpace, type SavedSpace } from './lib/storage'

/**
 * Opens the space named in the URL. An invite (`#v=…&k=…`) is saved on this
 * device and the key is then removed from the address bar and history.
 */
function spaceFromUrl(): SavedSpace | null {
  const parsed = readHash(location.hash)
  if (!parsed) return null
  if (parsed.secret) {
    const space = upsertSpace(parsed.vaultId, parsed.secret)
    history.replaceState(null, '', `/#v=${parsed.vaultId}`)
    return space
  }
  return findSpace(parsed.vaultId)
}

export function App() {
  const [space, setSpace] = useState(spaceFromUrl)

  useEffect(() => {
    const onHash = () => setSpace(spaceFromUrl())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!space) return <HomeScreen />
  return <Workspace key={space.vaultId} space={space} />
}

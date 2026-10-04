import { useState } from 'react'
import { forgetAll, forgetSpace, generateSecret, loadSpaces, randomId, readHash, upsertSpace } from '../lib/storage'
import { InstallButton } from './InstallButton'

export function HomeScreen() {
  const [spaceName, setSpaceName] = useState('')
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const [spaces, setSpaces] = useState(loadSpaces)

  function createSpace() {
    const vaultId = randomId()
    const secret = generateSecret()
    const name = spaceName.trim() || 'Untitled space'
    upsertSpace(vaultId, secret, { name })
    sessionStorage.setItem(`folio-creator-${vaultId}`, name)
    location.hash = `v=${vaultId}`
  }

  function join() {
    const hash = invite.trim().match(/#.*$/)?.[0] ?? invite.trim()
    const parsed = readHash(hash)
    if (!parsed?.secret) {
      setError('That link is missing the space id or key. Paste the whole invite link.')
      return
    }
    location.hash = `v=${parsed.vaultId}&k=${parsed.secret}`
  }

  return (
    <main className="home">
      <section className="home-card">
        <p className="eyebrow">Anonymous · end-to-end encrypted</p>
        <h1>Folio</h1>
        <p className="lede">
          Shared notes with no accounts. You get a random alias in every space, and the server only
          ever stores scrambled data it cannot read.
        </p>

        <label className="field">
          <span>New space</span>
          <input
            value={spaceName}
            onChange={(event) => setSpaceName(event.target.value)}
            placeholder="Project notes"
            maxLength={80}
            onKeyDown={(event) => {
              if (event.key === 'Enter') createSpace()
            }}
          />
        </label>
        <button type="button" className="primary" onClick={createSpace}>
          Create encrypted space
        </button>

        <div className="or">or join with an invite</div>
        <label className="field">
          <span>Invite link</span>
          <textarea
            value={invite}
            onChange={(event) => {
              setError('')
              setInvite(event.target.value)
            }}
            placeholder="https://…/#v=…&k=…"
            rows={3}
          />
        </label>
        <button type="button" className="secondary" onClick={join}>
          Join space
        </button>
        {error && <p className="form-error">{error}</p>}

        {spaces.length > 0 && (
          <div className="recent">
            <h2>Saved on this device</h2>
            <ul>
              {spaces.map((space) => (
                <li key={space.vaultId}>
                  <button
                    type="button"
                    className="space-open"
                    onClick={() => {
                      location.hash = `v=${space.vaultId}`
                    }}
                  >
                    <strong>{space.name}</strong>
                    <small>as {space.identity.name}</small>
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      forgetSpace(space.vaultId)
                      setSpaces(loadSpaces())
                    }}
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="text-button wipe"
              onClick={async () => {
                if (!window.confirm('Remove every space, key, and cached note from this device?')) return
                forgetAll()
                const dbs = (await indexedDB.databases?.()) ?? []
                await Promise.all(dbs.map((db) => db.name && indexedDB.deleteDatabase(db.name)))
                setSpaces([])
              }}
            >
              Wipe this device
            </button>
          </div>
        )}
        <InstallButton />
      </section>
    </main>
  )
}

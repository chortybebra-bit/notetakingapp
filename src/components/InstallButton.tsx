import { useEffect, useState } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<void> }

let deferred: InstallPrompt | null = null
const listeners = new Set<() => void>()

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferred = event as InstallPrompt
  listeners.forEach((cb) => cb())
})

/** Shown only when the browser offers to install Folio as an app window. */
export function InstallButton({ className = 'secondary install' }: { className?: string }) {
  const [available, setAvailable] = useState(Boolean(deferred))

  useEffect(() => {
    const update = () => setAvailable(Boolean(deferred))
    listeners.add(update)
    return () => {
      listeners.delete(update)
    }
  }, [])

  if (!available) return null
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await deferred?.prompt()
        deferred = null
        setAvailable(false)
      }}
    >
      Install as app
    </button>
  )
}

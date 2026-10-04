import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { InsecureScreen } from './components/InsecureScreen'
import './styles.css'

class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null }

  static getDerivedStateFromError(error: Error) {
    return { message: error.message }
  }

  render() {
    if (this.state.message) {
      return (
        <main className="home">
          <section className="home-card">
            <h1>Folio hit a problem</h1>
            <p className="lede">{this.state.message}</p>
            <button type="button" className="primary" onClick={() => location.reload()}>
              Reload
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js')
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing root')
const canEncrypt = window.isSecureContext && Boolean(crypto.subtle)

createRoot(root).render(
  <Boundary>{canEncrypt ? <App /> : <InsecureScreen />}</Boundary>,
)

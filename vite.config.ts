import { spawn, type ChildProcess } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

type HasHttpServer = { httpServer?: { once(event: string, cb: () => void): void } | null }

/** Runs the blind relay next to the Vite dev server, so `npm run dev` is all you need. */
function folioRelay() {
  let child: ChildProcess | null = null
  const start = (server: HasHttpServer) => {
    if (!child) {
      child = spawn(process.execPath, ['server/server.mjs'], {
        stdio: 'inherit',
        env: { ...process.env, PORT: '4444', HOST: '127.0.0.1' },
      })
      process.once('exit', () => child?.kill())
    }
    server.httpServer?.once('close', () => {
      child?.kill()
      child = null
    })
  }
  return {
    name: 'folio-relay',
    configureServer: start,
    configurePreviewServer: start,
  }
}

const shared = {
  host: true,
  port: 5173,
  allowedHosts: ['.trycloudflare.com', '.ts.net', '.onion'],
  proxy: {
    '/relay': { target: 'http://127.0.0.1:4444', ws: true },
  },
}

export default defineConfig({
  plugins: [react(), folioRelay()],
  server: shared,
  preview: shared,
  build: { chunkSizeWarningLimit: 1200 },
})

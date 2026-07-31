import express from 'express'
import { fileURLToPath } from 'node:url'
import { createAppStore } from './app-store'
import { registerRoutes } from './routes'
import { isBackendPath } from './spa'

const PORT = Number(process.env.PORT ?? 8080)
const DATA_DIR = process.env.DATA_DIR ?? '.'
const SERVE_STATIC = process.env.SERVE_STATIC
  ? process.env.SERVE_STATIC === 'true'
  : process.env.NODE_ENV === 'production'

async function main() {
  const store = await createAppStore(DATA_DIR)
  const app = express()

  // API / SSE / MCP first, so they always win over static + the SPA fallback.
  registerRoutes(app, store)

  if (SERVE_STATIC) {
    // build/server.js sits at <root>/build/server.js; dist at <root>/dist.
    const dist = fileURLToPath(new URL('../dist', import.meta.url))
    app.use(express.static(dist))
    // SPA fallback: unmatched GETs get index.html so client routes resolve on
    // refresh; backend paths that fell through 404 instead. Pathless middleware
    // (not app.get('*')) because Express 5's path-to-regexp rejects bare '*'.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || isBackendPath(req.path)) return next()
      res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url)))
    })
  }

  app.listen(PORT, () => {
    console.log(`homelab-diagram server on :${PORT} (DATA_DIR=${DATA_DIR}, static=${SERVE_STATIC})`)
  })
}

main().catch((err) => {
  console.error('server failed to start', err)
  process.exit(1)
})

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createStore, type Snapshot, type Store } from './server/store'
import type { Op } from './src/ops'

// Tiny persistence API: GET/PUT /api/graph <-> webapp/graph.json
// Makes the file the source of truth so edits survive reloads and are shared
// across machines that hit this dev server.
function graphApi(): Plugin {
  return {
    name: 'graph-api',
    configureServer(server) {
      const file = resolve(server.config.root, 'graph.json')
      server.middlewares.use('/api/graph', (req, res) => {
        if (req.method === 'GET') {
          readFile(file, 'utf8')
            .then((data) => {
              res.setHeader('Content-Type', 'application/json')
              res.end(data)
            })
            .catch(() => {
              res.statusCode = 204 // no file yet
              res.end()
            })
          return
        }
        if (req.method === 'PUT') {
          const chunks: Buffer[] = []
          req.on('data', (c) => chunks.push(c as Buffer))
          req.on('end', () => {
            writeFile(file, Buffer.concat(chunks).toString('utf8'))
              .then(() => {
                res.statusCode = 200
                res.end('{"ok":true}')
              })
              .catch(() => {
                res.statusCode = 500
                res.end('{"ok":false}')
              })
          })
          return
        }
        res.statusCode = 405
        res.end()
      })
    },
  }
}

// Store-backed API: GET /api/model, POST /api/ops <-> webapp/model.json
// The server is the single writer to model.json: reads return the current
// in-memory snapshot, and writes only ever happen through ops applied to
// the store (which debounces its own saves to disk).
function modelApi(): Plugin {
  return {
    name: 'model-api',
    configureServer(server) {
      const file = resolve(server.config.root, 'model.json')
      const storeReady: Promise<Store> = createStore({
        file,
        load: async () => JSON.parse(await readFile(file, 'utf8')),
        save: (model) => writeFile(file, JSON.stringify(model, null, 2)),
      })

      // Registered before the plain '/api/model' route below: connect mounts
      // paths as prefixes, so '/api/model' would otherwise swallow requests
      // to '/api/model/stream' before this handler ever saw them.
      server.middlewares.use('/api/model/stream', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        const store = await storeReady
        const send = (s: Snapshot) => res.write(`data: ${JSON.stringify(s)}\n\n`)
        send(store.getState())
        const off = store.subscribe(send)
        const ka = setInterval(() => res.write(': keep-alive\n\n'), 25000)
        req.on('close', () => {
          off()
          clearInterval(ka)
        })
      })

      server.middlewares.use('/api/model', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        const s = (await storeReady).getState()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(s))
      })

      server.middlewares.use('/api/ops', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        try {
          const { ops, writerId } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            ops: Op[]
            writerId?: string
          }
          const s = (await storeReady).apply(ops, writerId)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ rev: s.rev }))
        } catch (e) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), graphApi(), modelApi()],
  server: { host: true, port: 5173 },
})

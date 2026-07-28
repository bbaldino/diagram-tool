import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile } from 'node:fs/promises'
import { atomicWriteFile } from './server/persist'
import { resolve } from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createStore, type Snapshot, type Store } from './server/store'
import { createMcpServer, handlers } from './server/mcp'
import { DEFAULT_ENGINE, type LayoutEngine } from './server/layout'
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
      const historyFile = resolve(server.config.root, 'history.json')
      const storeReady: Promise<Store> = createStore({
        file,
        load: async () => JSON.parse(await readFile(file, 'utf8')),
        save: (model) => atomicWriteFile(file, JSON.stringify(model, null, 2)),
        loadHistory: async () => JSON.parse(await readFile(historyFile, 'utf8')),
        saveHistory: (h) => atomicWriteFile(historyFile, JSON.stringify(h)),
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

      // POST /api/layout {diagramId, engine?} — re-run automatic layout on a
      // diagram, defaulting to 'elk' (unknown engine values coerce to the
      // default). The UI "Tidy" button calls this; the resulting
      // placement/group moves apply through the store and stream to every
      // client over SSE.
      server.middlewares.use('/api/layout', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        try {
          const { diagramId, engine } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            diagramId: string
            engine?: string
          }
          const eng: LayoutEngine = engine === 'elk' || engine === 'graphviz' ? engine : DEFAULT_ENGINE
          const result = await handlers.layout(await storeReady, diagramId, eng)
          res.setHeader('Content-Type', 'application/json')
          if ('error' in result) res.statusCode = 400
          res.end(JSON.stringify(result))
        } catch (e) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(e) }))
        }
      })

      // POST /api/undo|redo {diagramId} — walk the diagram's shared history.
      // The reverting change streams to all clients over SSE; the JSON body is
      // only for the caller's immediate button state.
      const historyRoute = (kind: 'undo' | 'redo') =>
        async (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => {
          if (req.method !== 'POST') return next()
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          try {
            const { diagramId } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              diagramId: string
            }
            if (typeof diagramId !== 'string') throw new Error('diagramId required')
            const store = await storeReady
            const s = kind === 'undo' ? store.undo(diagramId) : store.redo(diagramId)
            const flags = s.undo[diagramId] ?? { canUndo: false, canRedo: false }
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ rev: s.rev, ...flags }))
          } catch (e) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(e) }))
          }
        }
      server.middlewares.use('/api/undo', historyRoute('undo'))
      server.middlewares.use('/api/redo', historyRoute('redo'))

      // MCP over Streamable HTTP so agents can drive the app live. Shares the
      // single store above (the one writer). The installed SDK forbids reusing
      // a stateless transport across requests
      // ("Stateless transport cannot be reused across requests"), so we build a
      // fresh McpServer + transport per request; all servers share `store`.
      server.middlewares.use('/mcp', async (req, res, next) => {
        if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
          return next()
        }
        const store = await storeReady
        const mcp = createMcpServer(store)
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        res.on('close', () => {
          void transport.close()
          void mcp.close()
        })
        try {
          await mcp.connect(transport)
          await transport.handleRequest(req, res)
        } catch (e) {
          console.error('[mcp] request error', e)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(e) }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), graphApi(), modelApi()],
  server: { host: true, port: 5173 },
})

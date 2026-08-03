import type { Express } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Snapshot, Store } from './store'
import { createMcpServer, handlers } from './mcp'
import { DEFAULT_ENGINE, type LayoutEngine } from './layout'
import type { Op } from '../src/ops'

// Mount the model/ops/layout/history API, the SSE snapshot stream, and the
// MCP endpoint on an Express app. Ported verbatim from the former Vite
// `modelApi` plugin; the store is now injected rather than created here.
export function registerRoutes(app: Express, store: Store): void {
  // Registered before '/api/model' so the exact-path stream route is
  // unambiguous. SSE: emit the current snapshot, then every store update.
  app.get('/api/model/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const send = (s: Snapshot) => res.write(`data: ${JSON.stringify(s)}\n\n`)
    send(store.getState())
    const off = store.subscribe(send)
    const ka = setInterval(() => res.write(': keep-alive\n\n'), 25000)
    req.on('close', () => {
      off()
      clearInterval(ka)
    })
  })

  app.get('/api/model', (_req, res) => {
    const s = store.getState()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(s))
  })

  app.post('/api/ops', async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    try {
      const { ops, writerId } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        ops: Op[]
        writerId?: string
      }
      const s = store.apply(ops, writerId)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ rev: s.rev }))
    } catch (e) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: String(e) }))
    }
  })

  app.post('/api/layout', async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    try {
      const { diagramId, engine, sizes } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        diagramId: string
        engine?: string
        sizes?: Record<string, { height?: number }>
      }
      const eng: LayoutEngine = engine === 'elk' || engine === 'graphviz' ? engine : DEFAULT_ENGINE
      const result = await handlers.layout(store, diagramId, eng, sizes)
      res.setHeader('Content-Type', 'application/json')
      if ('error' in result) res.statusCode = 400
      res.end(JSON.stringify(result))
    } catch (e) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: String(e) }))
    }
  })

  const historyRoute =
    (kind: 'undo' | 'redo') =>
    async (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      try {
        const { diagramId } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          diagramId: string
        }
        if (typeof diagramId !== 'string') throw new Error('diagramId required')
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
  app.post('/api/undo', historyRoute('undo'))
  app.post('/api/redo', historyRoute('redo'))

  // MCP over Streamable HTTP. Fresh McpServer + transport per request (the SDK
  // forbids reusing a stateless transport), all sharing the single store. Body
  // is read by the transport itself — do NOT add express.json() to this route.
  app.all('/mcp', async (req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      return next()
    }
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
}

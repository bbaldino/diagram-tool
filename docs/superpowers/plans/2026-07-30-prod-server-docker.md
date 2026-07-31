# Production Server + Docker Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the webapp backend out of the Vite dev server into a standalone Express server that serves the built frontend plus all `/api/*` endpoints and `/mcp`, and package it as a Docker image with data on a mounted volume.

**Architecture:** All backend logic already lives in reusable modules under `webapp/server/`; only the *wiring* lives in `vite.config.ts`. We add a shared store factory and an Express route-registration function, then an `index.ts` entry that both dev (via `tsx`) and prod (via an esbuild bundle in Docker) run. Vite's dev server switches to a proxy for `/api` + `/mcp`, so dev and prod run the same server code.

**Tech Stack:** Node 22, Express, esbuild (server bundle), tsx (dev runner), concurrently (dev orchestration), Vite (frontend build), Vitest (tests), Docker (`node:22-slim`).

## Global Constraints

- Node runtime: **`node:22-slim`** base image; local Node is v22.
- Add npm deps with `npm install` (latest versions) — do NOT hand-pin versions in `package.json`.
- Capitalize only the first letter of multi-letter acronyms in identifiers (e.g. `McpServer`, not `MCPServer`).
- Never use `window.alert/prompt/confirm` (not relevant here, but binding project-wide).
- Never commit `webapp/model.json`, `webapp/history.json`, or `webapp/graph.json`.
- Any browser smoke that mutates data uses a throwaway diagram — never the "Homelab (sample)".
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Env var contract: `PORT` (default 8080), `DATA_DIR` (default `.` in dev, `/data` in container), `SERVE_STATIC` (`true` when `NODE_ENV=production`, else `false`).
- The `/api/graph` legacy endpoint is DROPPED — do not port it (no frontend references it).

## File Structure

- **Create** `webapp/server/app-store.ts` — `createAppStore(dataDir)` store factory (shared by dev + prod).
- **Create** `webapp/server/routes.ts` — `registerRoutes(app, store)` mounts `/api/*`, SSE, `/mcp` on an Express app.
- **Create** `webapp/server/spa.ts` — `isBackendPath(path)` pure helper for the SPA fallback guard.
- **Create** `webapp/server/index.ts` — server entry (store creation, routes, optional static serving, `listen`).
- **Create** tests: `webapp/server/app-store.test.ts`, `webapp/server/routes.test.ts`, `webapp/server/spa.test.ts`.
- **Create** `webapp/Dockerfile`, `webapp/.dockerignore`.
- **Modify** `webapp/vite.config.ts` — drop the `graphApi`/`modelApi` plugins, add a dev proxy.
- **Modify** `webapp/package.json` — deps + scripts.

All shell commands below run from `webapp/` unless noted.

---

### Task 1: Add dependencies

**Files:**
- Modify: `webapp/package.json` (dependencies + devDependencies via `npm install`)

**Interfaces:**
- Produces: `express`, `@types/express`, `esbuild`, `tsx`, `concurrently` available for later tasks. No script changes yet (scripts that reference not-yet-existing files are added in the tasks that create those files).

- [ ] **Step 1: Install the runtime + dev dependencies (latest versions)**

Run:
```bash
npm install express
npm install -D @types/express esbuild tsx concurrently
```

- [ ] **Step 2: Verify install and that the tree still typechecks**

Run:
```bash
npm run typecheck
node -e "import('express').then(()=>console.log('express OK'))"
```
Expected: `typecheck` passes (no output / exit 0); prints `express OK`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add express, esbuild, tsx, concurrently for prod server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Store factory `createAppStore(dataDir)`

**Files:**
- Create: `webapp/server/app-store.ts`
- Test: `webapp/server/app-store.test.ts`

**Interfaces:**
- Consumes: `createStore` and `type Store` from `./store`; `atomicWriteFile` from `./persist`.
- Produces: `createAppStore(dataDir: string): Promise<Store>` — builds the store with `model.json` + `history.json` resolved under `dataDir`, using the same load/save callbacks the current Vite plugin uses. A missing data file yields an empty normalized model (guaranteed by `createStore`'s `loadInitialModel`).

- [ ] **Step 1: Write the failing test**

Create `webapp/server/app-store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppStore } from './app-store'

describe('createAppStore', () => {
  it('creates a store seeded empty when the data dir has no model.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'appstore-'))
    const store = await createAppStore(dir)
    const snap = store.getState()
    expect(snap.rev).toBe(0)
    expect(Array.isArray(snap.model.diagrams)).toBe(true)
    expect(snap.model.diagrams.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/app-store.test.ts`
Expected: FAIL — cannot resolve `./app-store`.

- [ ] **Step 3: Implement the factory**

Create `webapp/server/app-store.ts`:
```ts
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createStore, type Store } from './store'
import { atomicWriteFile } from './persist'

// Build the model store with model.json + history.json living under `dataDir`.
// The single source of store construction for both the dev server and the
// production entry. A missing model.json/history.json is tolerated by
// createStore (it seeds an empty normalized model), so a fresh deploy with an
// empty DATA_DIR starts with no diagrams rather than failing to boot.
export function createAppStore(dataDir: string): Promise<Store> {
  const file = resolve(dataDir, 'model.json')
  const historyFile = resolve(dataDir, 'history.json')
  return createStore({
    file,
    load: async () => JSON.parse(await readFile(file, 'utf8')),
    save: (model) => atomicWriteFile(file, JSON.stringify(model, null, 2)),
    loadHistory: async () => JSON.parse(await readFile(historyFile, 'utf8')),
    saveHistory: (h) => atomicWriteFile(historyFile, JSON.stringify(h)),
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/app-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app-store.ts server/app-store.test.ts
git commit -m "feat(server): createAppStore factory keyed on DATA_DIR

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Express route registration `registerRoutes(app, store)`

**Files:**
- Create: `webapp/server/routes.ts`
- Test: `webapp/server/routes.test.ts`

**Interfaces:**
- Consumes: `type Store`, `type Snapshot` from `./store`; `createMcpServer`, `handlers` from `./mcp`; `DEFAULT_ENGINE`, `type LayoutEngine` from `./layout`; `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`; `type Op` from `../src/ops`; `express` (for the `Express` type).
- Produces: `registerRoutes(app: import('express').Express, store: Store): void`. Mounts (in this order): `GET /api/model/stream` (SSE), `GET /api/model`, `POST /api/ops`, `POST /api/layout`, `POST /api/undo`, `POST /api/redo`, and `/mcp` (POST/GET/DELETE). Bodies are read manually from the request stream (NOT via `express.json()`), so `/mcp` — whose transport reads the raw stream itself — is never interfered with.

Notes for the implementer:
- This is a near-verbatim port of the `modelApi` plugin currently in `webapp/vite.config.ts` (lines ~77–201). The only changes: (1) the store is passed in (`store`), not created here, so replace every `await storeReady` with `store`; (2) mount via Express `app.get`/`app.post`/`app.all` instead of `server.middlewares.use` + manual method checks. Keep the manual `req.on('data')` / `for await (const c of req)` body reading exactly as-is.
- `app.get('/api/model/stream', …)` matches the exact path, so it will not be shadowed by `/api/model`; still register it first to match the original intent.
- For `/mcp`, use `app.all('/mcp', handler)` and inside the handler keep the `if (method !== POST/GET/DELETE) return next()` guard, the fresh `createMcpServer(store)` + `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request, and the `res.on('close', …)` cleanup — identical to today.

- [ ] **Step 1: Write the failing test**

Create `webapp/server/routes.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createAppStore } from './app-store'
import { registerRoutes } from './routes'

let server: Server
let base: string

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'routes-'))
  const store = await createAppStore(dir)
  const app = express()
  registerRoutes(app, store)
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server?.close()
})

describe('registerRoutes', () => {
  it('GET /api/model returns the current snapshot', async () => {
    const res = await fetch(`${base}/api/model`)
    expect(res.status).toBe(200)
    const snap = await res.json()
    expect(snap).toHaveProperty('rev')
    expect(snap).toHaveProperty('model')
    expect(snap).toHaveProperty('undo')
  })

  it('POST /api/ops with an empty op list is a no-op returning rev 0', async () => {
    const res = await fetch(`${base}/api/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: [] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rev: 0 })
  })

  it('POST /api/ops with an invalid body returns 400', async () => {
    const res = await fetch(`${base}/api/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/ops is not registered (405/404, not 200)', async () => {
    const res = await fetch(`${base}/api/ops`)
    expect(res.status).not.toBe(200)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/routes.test.ts`
Expected: FAIL — cannot resolve `./routes`.

- [ ] **Step 3: Implement `registerRoutes`**

Create `webapp/server/routes.ts` by porting the `modelApi` handlers. Full content:
```ts
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
      const { diagramId, engine } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        diagramId: string
        engine?: string
      }
      const eng: LayoutEngine =
        engine === 'elk' || engine === 'graphviz' ? engine : DEFAULT_ENGINE
      const result = await handlers.layout(store, diagramId, eng)
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/routes.test.ts`
Expected: PASS (all 4 assertions).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes.ts server/routes.test.ts
git commit -m "feat(server): registerRoutes mounts API/SSE/MCP on Express

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Server entry `index.ts` + SPA fallback guard

**Files:**
- Create: `webapp/server/spa.ts`
- Create: `webapp/server/index.ts`
- Test: `webapp/server/spa.test.ts`
- Modify: `webapp/package.json` (`build` script gains the esbuild step; add `start`)

**Interfaces:**
- Consumes: `createAppStore` (Task 2), `registerRoutes` (Task 3), `express`.
- Produces: `isBackendPath(path: string): boolean` from `./spa` (true for `/api/*` and `/mcp`); a runnable `server/index.ts` that reads env, builds the store, registers routes, optionally serves `dist/`, and listens.

- [ ] **Step 1: Write the failing test for the SPA guard**

Create `webapp/server/spa.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isBackendPath } from './spa'

describe('isBackendPath', () => {
  it('is true for API and MCP paths', () => {
    expect(isBackendPath('/api/model')).toBe(true)
    expect(isBackendPath('/api/model/stream')).toBe(true)
    expect(isBackendPath('/mcp')).toBe(true)
  })
  it('is false for client-routed and asset paths', () => {
    expect(isBackendPath('/')).toBe(false)
    expect(isBackendPath('/dashboard')).toBe(false)
    expect(isBackendPath('/assets/index-abc123.js')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/spa.test.ts`
Expected: FAIL — cannot resolve `./spa`.

- [ ] **Step 3: Implement the guard**

Create `webapp/server/spa.ts`:
```ts
// The SPA fallback serves index.html for any GET that isn't a real static
// file, so client-side routes work on refresh. But backend paths must never
// fall through to index.html — they should 404 if unmatched. This guard marks
// the paths the fallback must skip.
export function isBackendPath(path: string): boolean {
  return path === '/mcp' || path.startsWith('/api/')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/spa.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the server entry**

Create `webapp/server/index.ts`:
```ts
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
    // refresh; backend paths that fell through 404 instead.
    app.get('*', (req, res, next) => {
      if (isBackendPath(req.path)) return next()
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
```

- [ ] **Step 6: Wire the build + start scripts**

In `webapp/package.json`, replace the `build` script and add `start`:
```jsonc
"build": "vite build && esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=build/server.js",
"start": "node build/server.js",
```

- [ ] **Step 7: Verify the production build produces both artifacts**

Run:
```bash
npm run build
ls dist/index.html build/server.js
```
Expected: `npm run build` exits 0; both `dist/index.html` and `build/server.js` exist.

- [ ] **Step 8: Verify the built server boots and serves the app + API**

Run (from `webapp/`, using a throwaway data dir so real files are untouched):
```bash
SCRATCH=$(mktemp -d)
NODE_ENV=production PORT=8099 DATA_DIR="$SCRATCH" node build/server.js &
SRV=$!
sleep 1
curl -sf http://127.0.0.1:8099/ | head -c 40
echo
curl -sf http://127.0.0.1:8099/api/model | head -c 40
echo
kill $SRV
```
Expected: the `/` response starts with `<!doctype html` (the built index); `/api/model` returns JSON beginning `{"rev":0` (or current). No errors.

- [ ] **Step 9: Commit**

```bash
git add server/spa.ts server/spa.test.ts server/index.ts package.json
git commit -m "feat(server): production entry serving dist + API/MCP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Switch dev to the extracted server (Vite proxy)

**Files:**
- Modify: `webapp/vite.config.ts`
- Modify: `webapp/package.json` (`dev` scripts)

**Interfaces:**
- Consumes: `server/index.ts` (Task 4), the proxy target `http://localhost:8080`.
- Produces: `npm run dev` runs the Express backend (`:8080`) and Vite (`:5173`) together; Vite proxies `/api` + `/mcp` to the backend. `localhost:5173/mcp` keeps working.

- [ ] **Step 1: Replace `vite.config.ts` with the proxy config**

Overwrite `webapp/vite.config.ts` with:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend now runs as a standalone Express server (see server/index.ts).
// In dev, that server runs on :8080 and Vite proxies the API + MCP to it, so
// the frontend keeps HMR while dev and prod exercise the same server code.
const API_TARGET = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/mcp': { target: API_TARGET, changeOrigin: true },
    },
  },
})
```

- [ ] **Step 2: Update the dev scripts**

In `webapp/package.json`, replace `"dev": "vite"` with:
```jsonc
"dev": "concurrently -k -n web,api \"npm:dev:web\" \"npm:dev:api\"",
"dev:web": "vite",
"dev:api": "tsx watch server/index.ts",
```
(`dev:api` runs with `DATA_DIR` unset → defaults to `.`, i.e. the webapp dir, so local dev reads/writes the same `model.json` as before. `SERVE_STATIC` is unset and `NODE_ENV` is not `production`, so the dev backend does not serve `dist/` — Vite serves the frontend.)

- [ ] **Step 3: Verify typecheck + full suite still pass**

Run:
```bash
npm run typecheck
npm test
```
Expected: both pass. (`vite.config.ts` no longer imports the server internals; nothing else references the removed plugins.)

- [ ] **Step 4: Manual dev smoke (controller performs in the browser)**

Run `npm run dev`. Then verify:
- App loads at `http://localhost:5173` and HMR works (edit a src file → hot update).
- `curl -sf http://localhost:5173/api/model | head -c 20` returns JSON (proxy → backend).
- The SSE stream flushes incrementally: `curl -N -sf http://localhost:5173/api/model/stream` prints a `data: {…}` line immediately and stays open (Ctrl-C to stop).
- An MCP round-trip through `:5173/mcp` succeeds (e.g. the homelab-diagram MCP `list_diagrams` tool returns; use a throwaway diagram for any mutation).

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts package.json
git commit -m "refactor(dev): serve backend standalone, Vite proxies /api + /mcp

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Dockerfile + .dockerignore

**Files:**
- Create: `webapp/Dockerfile`
- Create: `webapp/.dockerignore`

**Interfaces:**
- Consumes: `npm run build` (Task 4) producing `dist/` + `build/server.js`; the env contract (`PORT`, `DATA_DIR`, `SERVE_STATIC`).
- Produces: a `node:22-slim` image that runs `node build/server.js`, serving the app on `:8080` with data on the `/data` volume.

- [ ] **Step 1: Create `.dockerignore`**

Create `webapp/.dockerignore`:
```
node_modules
dist
build
model.json
history.json
graph.json
.git
*.log
```

- [ ] **Step 2: Create the Dockerfile**

Create `webapp/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1

# --- build stage: install everything, build frontend + bundle server ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Reduce node_modules to production deps only for the runtime image.
RUN npm ci --omit=dev

# --- runtime stage: slim, no dev tooling, no Vite ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    SERVE_STATIC=true
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "build/server.js"]
```

- [ ] **Step 3: Build the image**

Run (from `webapp/`):
```bash
docker build -t homelab-diagram:test .
```
Expected: build succeeds through both stages.

- [ ] **Step 4: Run the container and smoke the app + API**

Run:
```bash
docker volume create hld-test-data
docker run -d --name hld-test -p 8098:8080 -v hld-test-data:/data homelab-diagram:test
sleep 2
curl -sf http://127.0.0.1:8098/ | head -c 40; echo
curl -sf http://127.0.0.1:8098/api/model | head -c 40; echo
```
Expected: `/` returns `<!doctype html…`; `/api/model` returns JSON.

- [ ] **Step 5: Verify persistence across a container restart**

Create a throwaway diagram via MCP (through the container's `/mcp`) or via `/api/ops`, then:
```bash
docker restart hld-test
sleep 2
curl -sf http://127.0.0.1:8098/api/model | head -c 200; echo
```
Expected: the change made before the restart is still present (data lives on the `hld-test-data` volume, not the container layer).

- [ ] **Step 6: Tear down the test container**

Run:
```bash
docker rm -f hld-test
docker volume rm hld-test-data
```

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(deploy): multi-stage Dockerfile serving built app + API/MCP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Extract backend to Express (`routes.ts`, `index.ts`) → Tasks 3, 4. ✔
- Shared store factory on `DATA_DIR` → Task 2. ✔
- Drop legacy `/api/graph` → not ported (Task 3 ports only `modelApi`). ✔
- Dev proxy, one-command dev, same server code → Task 5. ✔
- Multi-stage `node:22-slim` Docker, esbuild bundle, prod-only node_modules, `/data` volume, env config → Tasks 4 (build script) + 6. ✔
- SSE + MCP through the proxy, no body-parser interference on `/mcp` → Task 3 (manual body reads) + Task 5 smoke. ✔
- Existing unit suite stays green → Tasks 3, 5 run `npm test`. ✔
- Container smoke incl. persistence across restart → Task 6. ✔
- Starts empty by default → Task 2 test asserts empty seed. ✔

**Placeholder scan:** none — every step has concrete commands/code.

**Type consistency:** `createAppStore(dataDir): Promise<Store>` (Task 2) is consumed with `await` in Tasks 3 (test) and 4 (`index.ts`). `registerRoutes(app, store)` signature matches its call sites. `isBackendPath(path)` defined in Task 4, used in `index.ts` same task. `Store`/`Snapshot`/`Op`/`LayoutEngine` names match `store.ts`, `layout.ts`, `ops.ts` as read from the current source.

**Deferred/minor:** production reverse-proxy (NPM) buffering config for `/api/model/stream` + `/mcp` is operational and out of code scope (recorded in the spec); not a task here.

# Production Server + Docker Deploy — Design

**Date:** 2026-07-30
**Status:** Approved (design), pending implementation plan

## Goal

Give the homelab-diagram webapp a clean, idiomatic production deployment:
a real Node backend that serves the built frontend plus all `/api/*`
endpoints and `/mcp`, packaged as a Docker image, with diagram data on a
mounted volume. Fronted by the existing Nginx Proxy Manager for
hostname/TLS.

Three explicit priorities driving the design:

1. **Runs cleanly in Docker** — single slim production process, data on a
   volume, no Vite/HMR at runtime.
2. **Future development stays easy** — clear frontend/backend split, the
   backend is a normal testable server, `npm run dev` remains one command.
3. **Idiomatic** — the conventional "Vite React SPA + Node API" structure.

## Background / Problem

Today the entire backend exists only as **Vite dev-server middleware**. In
`webapp/vite.config.ts`, two plugins (`graphApi`, `modelApi`) attach the
API, SSE stream, layout, undo/redo, and `/mcp` to the dev server via
`configureServer`. Consequences:

- `vite build` emits only the static frontend — none of the backend.
- `vite preview` serves the built frontend but does **not** run
  `configureServer` middleware, so it has no working backend.
- There is nothing to deploy for production; the app only runs under the
  dev server.

The actual logic already lives in reusable modules under `webapp/server/`
(`store.ts`, `mcp.ts`, `layout.ts`, `persist.ts`, …); only the *wiring*
lives in `vite.config.ts`. This design extracts that wiring into a real
server and reuses it from both dev and prod.

Note: `graphApi` (`GET/PUT /api/graph` ↔ `graph.json`) is **legacy** — no
frontend code references it. It is dropped, not ported.

## Architecture

Two clear halves sharing one backend implementation:

- **Frontend:** the existing Vite React app. Unchanged. Builds to
  `webapp/dist/`.
- **Backend:** an **Express** server in `webapp/server/`. Owns `/api/*`,
  `/api/model/stream` (SSE), `/mcp`, the store/persistence, layout, and
  undo/redo. In production it *also* serves the built `dist/` (static +
  SPA fallback).

The existing handlers are connect-style `(req, res, next)`, which are
Express-compatible, so they move with minimal change.

### Runtime topologies

**Development** (`npm run dev`, one command via `concurrently`):

```
browser → Vite dev server :5173 (frontend + HMR)
             │  proxy  /api, /mcp
             ▼
          Express backend :8080  → store → DATA_DIR/model.json + history.json
```

Vite's `server.proxy` forwards `/api` and `/mcp` to the backend. The dev
backend does **not** serve static files (Vite owns the frontend). Because
`/mcp` is proxied through `:5173`, the existing MCP registration at
`http://localhost:5173/mcp` keeps working unchanged.

**Production** (`node build/server.js`, one process):

```
browser → NPM (TLS/hostname) → Express :PORT
                                  ├─ static dist/ (SPA fallback → index.html)
                                  ├─ /api/*, /api/model/stream (SSE)
                                  └─ /mcp
                                       → store → DATA_DIR/model.json + history.json
```

## Components (files)

### New

- **`webapp/server/app-store.ts`** — `createAppStore(dataDir: string):
  Promise<Store>`. Wraps the existing `createStore` with
  `model.json`/`history.json` paths under `dataDir`, using the same
  `atomicWriteFile` persistence as today. Single source of the store
  construction for both dev and prod.

- **`webapp/server/routes.ts`** — `registerRoutes(app: express.Express,
  store: Store): void`. Mounts, in this order (SSE before the `/api/model`
  prefix, as today):
  - `GET /api/model/stream` — SSE snapshot stream + keep-alive.
  - `GET /api/model` — current snapshot.
  - `POST /api/ops` — apply ops.
  - `POST /api/layout` — re-run layout (`elk` default; unknown → default).
  - `POST /api/undo`, `POST /api/redo` — history walk.
  - `ALL /mcp` (POST/GET/DELETE) — MCP over Streamable HTTP; fresh
    `McpServer` + transport per request sharing `store`.

  Logic is the same as the current `modelApi` plugin, adapted to Express.

- **`webapp/server/index.ts`** — production/dev entry. Reads env
  (`PORT`, `DATA_DIR`, `SERVE_STATIC`), builds the store via
  `createAppStore`, creates an Express app, calls `registerRoutes`, and
  (when serving static) mounts `express.static(dist)` plus an SPA fallback
  that returns `index.html` for non-API, non-file GETs. Calls
  `app.listen(PORT)` and logs the bound URL.

### Modified

- **`webapp/vite.config.ts`** — remove the `graphApi`/`modelApi` plugins
  and their inline handlers. Keep the `react()` plugin. Add
  `server.proxy` for `/api` and `/mcp` → `http://localhost:8080` (with the
  settings SSE/MCP need — see "SSE & MCP through the proxy"). Keep
  `server: { host: true, port: 5173 }`.

- **`webapp/package.json`** — scripts + dependencies (see below).

### New (repo root, for Docker)

- **`webapp/Dockerfile`** — multi-stage build (see "Docker").
- **`webapp/.dockerignore`** — exclude `node_modules`, `dist`, `build`,
  `model.json`, `history.json`, `graph.json`, `.git`, etc.

## Configuration (environment variables)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8080` | Port the Express server listens on. |
| `DATA_DIR` | `/data` (prod), `.` (dev) | Directory holding `model.json` + `history.json`. |
| `SERVE_STATIC` | `true` when `NODE_ENV=production`, else `false` | Whether the server serves `dist/`. Dev leaves it off (Vite serves the frontend). |

`DATA_DIR` defaults to the webapp directory in dev so current local files
keep working; to `/data` in the container.

## Persistence

`model.json` and `history.json` live in `DATA_DIR`. In the container
`DATA_DIR=/data` and `/data` is declared a `VOLUME`, so diagrams survive
restarts and image upgrades.

**Default: the deployed instance starts empty** — on first write the store
creates the files. To carry over existing diagrams, bind-mount or copy a
`model.json` into the volume. (The store already tolerates missing files:
the `load`/`loadHistory` callbacks fall back to an empty model on read
error.)

## Docker

Base image: **`node:22-slim`** (Debian slim — safe for the wasm layout
deps `elkjs` and `@hpcc-js/wasm-graphviz`; alpine/musl is riskier for
wasm/native bits).

Multi-stage:

**Stage 1 — build** (`node:22-slim`):
1. `npm ci` (all deps).
2. `npm run build` →
   - `vite build` → `dist/` (frontend).
   - `esbuild server/index.ts --bundle --platform=node --format=esm
     --packages=external --outfile=build/server.js`. `--packages=external`
     keeps `node_modules` (incl. the wasm deps) resolved at runtime rather
     than bundled.
3. `npm ci --omit=dev` (or `npm prune --production`) to produce a
   production-only `node_modules`.

**Stage 2 — runtime** (`node:22-slim`):
- Copy `dist/`, `build/server.js`, and the production `node_modules`.
- `ENV NODE_ENV=production PORT=8080 DATA_DIR=/data`
- `VOLUME ["/data"]`
- `EXPOSE 8080`
- `CMD ["node", "build/server.js"]`

Result: a runtime image with **no Vite, no HMR, no dev tooling** — just
Node, production deps, the bundled server, and the built frontend.

## Dependencies & scripts

**Add** (via `npm install`, latest versions):
- `express` (dependency) — the server framework.
- `@types/express` (dev) — types.
- `esbuild` (dev) — bundles the server for production.
- `tsx` (dev) — runs the TypeScript server directly in dev.
- `concurrently` (dev) — runs backend + Vite together for `npm run dev`.

**`package.json` scripts:**
```jsonc
{
  "dev": "concurrently -k -n web,api \"npm:dev:web\" \"npm:dev:api\"",
  "dev:web": "vite",
  "dev:api": "tsx watch server/index.ts",
  "build": "vite build && esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=build/server.js",
  "start": "node build/server.js",
  "typecheck": "tsc --noEmit",
  "preview": "vite preview",
  "test": "vitest run"
}
```

`dev:api` runs with `DATA_DIR` unset → defaults to `.` (the webapp dir), so
local dev reads/writes the same `model.json` it does today.

## SSE & MCP through the dev proxy

Two endpoints need long-lived, unbuffered connections:

- **`/api/model/stream`** (SSE) — Vite's proxy passes streaming HTTP
  through by default; no special config beyond the target. Verify the
  stream flushes (events arrive incrementally, not buffered).
- **`/mcp`** (Streamable HTTP: POST/GET/DELETE, may hold a response open)
  — proxied to the backend. Verify a real MCP request round-trips through
  `:5173/mcp`.

The reverse proxy (NPM) in production must likewise not buffer these:
document that the proxy host for this app needs proxy buffering off / long
read timeout for `/api/model/stream` and `/mcp`. (Config of NPM itself is
operational, outside this code change, but the requirement is recorded
here.)

## Testing

**Unit (existing, must stay green):** the current Vitest suite (~277 pure
tests) is unaffected — no logic moves, only wiring. Run `npm test`.

**New unit coverage (small, pure):**
- `createAppStore` resolves `model.json`/`history.json` under a given
  `DATA_DIR` (assert on the paths passed to the store, or round-trip a
  temp dir).
- Any pure helper extracted for the SPA fallback (e.g. "is this request an
  API/asset path vs. an SPA route") gets a direct unit test rather than
  needing a live server.

**Dev smoke (manual, scripted steps in the plan):**
- `npm run dev` starts both processes; the app loads at `:5173` with HMR.
- `/api/model` and the SSE stream work through the proxy.
- An MCP call to `:5173/mcp` succeeds.

**Container smoke (manual, scripted steps in the plan):**
- `docker build` succeeds.
- `docker run` with a mounted volume serves the app at `:8080`.
- App loads; an edit persists to the volume; **restart the container** and
  the edit is still there.
- `/mcp` responds; layout and undo/redo work.

Per the project rule, any browser smoke that mutates data uses a throwaway
diagram — never the "Homelab (sample)".

## Out of scope

- Image export (PNG/SVG) — deferred separately.
- Authentication / multi-tenant concerns — NPM fronts the app on the LAN.
- CI/CD pipeline, image registry, container orchestration (compose/k8s) —
  this delivers the image + how to run it; wiring it into infra is a
  follow-up.
- Changing the store/persistence/MCP logic itself — this is extraction and
  packaging only.

## Idiomatic-ness check (why this shape)

- **Clean Docker:** one slim prod process, `/data` volume, env config, no
  Vite at runtime. ✔
- **Easy future dev:** obvious frontend/backend split; backend is a normal
  Express app that's unit-testable and runs the *same code* in dev and
  prod; `npm run dev` stays one command. ✔
- **Idiomatic:** the standard React-SPA-served-by-a-Node-API layout, with
  Vite for the build and a dev proxy for local work. ✔

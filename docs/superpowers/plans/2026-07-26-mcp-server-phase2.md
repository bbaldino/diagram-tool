# Phase 2 — MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Phase-1 operation API to agents as an MCP hosted inside the Vite dev server, with server-side flow-directed layout, so agents can create and iterate on diagrams that appear live in the app.

**Architecture:** A pure dagre layout module + a pure authoring module (spec → `Op[]`, reusing Phase-1 `diffToOps`/`applyOps`) + an `McpServer` whose thin tool handlers validate input, build ops, and apply them through the same in-process `store`. The MCP mounts as `/mcp` middleware inside the existing `modelApi` plugin, sharing its `storeReady`.

**Tech Stack:** TypeScript, Node (Vite dev server / Connect middleware), `@dagrejs/dagre`, `@modelcontextprotocol/sdk` (Streamable-HTTP transport), vitest.

## Global Constraints

- `npx tsc --noEmit` (strict) passes at the end of every task; `npx vitest run` stays green (add tests, never remove). Current suite is 62.
- **Server-safety boundary holds:** `src/model.ts`, `src/ops.ts`, `src/diff.ts` must stay free of runtime (value) imports from `@xyflow/react`/`./graph`/`./buildGraph`. New server-only modules (`server/*.ts`) may import `@dagrejs/dagre` and the MCP SDK, but MUST NOT import `@xyflow/react` or client code. Client code (`src/**` except types) must never import the MCP SDK or dagre.
- New identifiers: capitalize only the first letter of a multi-letter acronym (`Mcp`, not `MCP`; `mcp` in file/route names is fine).
- The dev server stays the SINGLE writer to `model.json`; all MCP writes go through `store.apply(ops, 'mcp')`. Agents never write the file directly.
- Concurrency is last-writer-wins (Phase 1); do not add reconciliation. Free entity creation is allowed (new-by-name just creates).
- `tsconfig.json` already includes `["src","server"]`. Don't delete `graph.json`; `model.json` git-ignored. Add npm deps with the package manager (npm), latest versions.

## Reused Phase-1 surface (do not reimplement)

From `webapp/src/model.ts`: types `Model`, `Diagram`, `Entity`, `Placement{entityId,position,parentId?,fieldShow?,note?}`, `Group{id,label,color,position,size}`, `Note`, `DEdge{id,from,to,type,label?,dir?,color?,shape?,sourceHandle?,targetHandle?,...}`, `DiagramType`; functions `addEntity`(dedupes by id), `addDiagram(name,type)→{model,id}`, `entitiesById`, `getDiagram`. From `webapp/src/ops.ts`: `Op` union, `applyOp`, `applyOps`. From `webapp/src/diff.ts`: `diffToOps(prev,next):Op[]`. From `webapp/server/store.ts`: `createStore`, `Store{getState():Snapshot, apply(ops,writerId?):Snapshot, subscribe}`, `Snapshot{rev,model,writerId?}`. `vite.config.ts` `modelApi()` owns `storeReady: Promise<Store>`.

---

## File Structure

- `webapp/server/layout.ts` (**new**) — pure flow-directed layout via dagre.
- `webapp/server/authoring.ts` (**new**) — pure `authorDiagramOps(model, spec)` + granular op-builders; reuses `diffToOps`.
- `webapp/server/mcp.ts` (**new**) — `createMcpServer(store)`: registers reads + granular + author tools; handler bodies live in exported plain functions so they're unit-testable without the transport.
- `webapp/vite.config.ts` (**modify**) — mount `/mcp` in `modelApi`'s `configureServer`, sharing `storeReady`.
- Tests: `webapp/server/layout.test.ts`, `webapp/server/authoring.test.ts`, `webapp/server/mcp.test.ts` (**new**).

---

## Task 1: Layout module (`server/layout.ts`)

**Files:** Create `webapp/server/layout.ts`; Test `webapp/server/layout.test.ts`. Adds dep `@dagrejs/dagre` (+ `@types/dagre` if the package doesn't ship types).

**Interfaces (Produces):**
```ts
// Returns positioned copies of the diagram's placements + groups. Pure; agent
// positions are NOT special-cased here (the authoring layer applies overrides).
export function layoutDiagram(diagram: Diagram): { placements: Placement[]; groups: Group[] }
```

**Approach:** build a dagre compound graph, `rankdir: 'LR'`; a node per placement (fixed size `W=180, H=64`); groups → clusters via `setParent`; edges via `setEdge(from,to)`. Run `dagre.layout`, convert center coords to top-left, size each group box to wrap its members (+ padding), and offset members so their positions are relative to the group (React-Flow child coords are parent-relative — match how `buildDiagramGraph`/`relayout` treat grouped children).

- [ ] **Step 1: add dep** — `npm install @dagrejs/dagre` (and `npm install -D @types/dagre` if `import` doesn't typecheck). Confirm `npx tsc --noEmit` sees it.

- [ ] **Step 2: Write failing tests** (`layout.test.ts`):
```ts
import { layoutDiagram } from './layout'
import type { Diagram } from '../src/model'
const D = (over: Partial<Diagram>): Diagram => ({ id:'d', name:'d', title:'d', type:'canvas', placements:[], groups:[], edges:[], notes:[], ...over })

it('ranks a source left of its target (rankdir LR)', () => {
  const d = D({
    placements: [ {entityId:'a',position:{x:0,y:0}}, {entityId:'b',position:{x:0,y:0}} ],
    edges: [ {id:'e',from:'a',to:'b',type:'talks-to'} ],
  })
  const { placements } = layoutDiagram(d)
  const a = placements.find(p=>p.entityId==='a')!, b = placements.find(p=>p.entityId==='b')!
  expect(a.position.x).toBeLessThan(b.position.x)
})

it('does not overlap two unrelated nodes', () => {
  const d = D({ placements:[{entityId:'a',position:{x:0,y:0}},{entityId:'b',position:{x:0,y:0}}] })
  const { placements } = layoutDiagram(d)
  const [a,b] = placements
  const apart = Math.abs(a.position.x-b.position.x) >= 180 || Math.abs(a.position.y-b.position.y) >= 64
  expect(apart).toBe(true)
})

it('sizes a group to wrap its members', () => {
  const d = D({
    groups: [{ id:'g', label:'G', color:'#000', position:{x:0,y:0}, size:{width:0,height:0} }],
    placements: [ {entityId:'a',position:{x:0,y:0},parentId:'g'}, {entityId:'b',position:{x:0,y:0},parentId:'g'} ],
  })
  const { groups } = layoutDiagram(d)
  expect(groups[0].size.width).toBeGreaterThan(180)
  expect(groups[0].size.height).toBeGreaterThan(64)
})
```

- [ ] **Step 3: Run to see fail** — `npx vitest run server/layout.test.ts` → FAIL.

- [ ] **Step 4: Implement** `layoutDiagram`:
```ts
import dagre from '@dagrejs/dagre'
import type { Diagram, Placement, Group } from '../src/model'

const W = 180, H = 64, PAD = 24, HEADER = 28

export function layoutDiagram(diagram: Diagram): { placements: Placement[]; groups: Group[] } {
  const g = new dagre.graphlib.Graph({ compound: true })
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const grp of diagram.groups) g.setNode(grp.id, {} as any) // cluster
  for (const p of diagram.placements) {
    g.setNode(p.entityId, { width: W, height: H })
    if (p.parentId) g.setParent(p.entityId, p.parentId)
  }
  for (const e of diagram.edges) {
    if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to)
  }
  dagre.layout(g)

  // group bounding boxes (absolute), from dagre cluster nodes
  const groups: Group[] = diagram.groups.map((grp) => {
    const n = g.node(grp.id) as any
    if (!n) return grp
    return {
      ...grp,
      position: { x: Math.round(n.x - n.width / 2), y: Math.round(n.y - n.height / 2) },
      size: { width: Math.round(n.width), height: Math.round(n.height) },
    }
  })
  const groupById = Object.fromEntries(groups.map((x) => [x.id, x]))
  const placements: Placement[] = diagram.placements.map((p) => {
    const n = g.node(p.entityId) as any
    if (!n) return p
    let x = Math.round(n.x - W / 2), y = Math.round(n.y - H / 2)
    if (p.parentId && groupById[p.parentId]) { // make child coords parent-relative
      x -= groupById[p.parentId].position.x
      y -= groupById[p.parentId].position.y
    }
    return { ...p, position: { x, y } }
  })
  return { placements, groups }
}
```
(If dagre's compound cluster sizing needs explicit padding, add `PAD`/`HEADER` to the group node size before layout or expand the box after; the test asserts wrapping, so make it wrap. Keep it Node-safe: only `@dagrejs/dagre` + model types.)

- [ ] **Step 5: Run tests + typecheck** → green.
- [ ] **Step 6: Commit** — `git commit -m "feat(server): flow-directed dagre layout module"`

---

## Task 2: Authoring module (`server/authoring.ts`)

**Files:** Create `webapp/server/authoring.ts`; Test `webapp/server/authoring.test.ts`.

**Interfaces (Produces):**
```ts
export interface AuthorSpec {
  name: string
  type?: DiagramType            // default 'canvas'
  nodes: (string | { new: string; icon?: string })[]  // existing entity id, or new-by-label
  edges?: [string, string, { label?: string; dir?: EdgeDir; color?: string }?][] // [fromId,toId,attrs]
  groups?: { label: string; members: string[] }[]     // members = entity ids
  notes?: Record<string, string>                        // entityId -> note
  positions?: Record<string, { x: number; y: number }>  // optional agent overrides, entityId -> pos
}
// Assemble the ops that create the diagram (+ any new entities), laid out.
// Throws Error on an unresolvable existing entity id. Pure.
export function authorDiagramOps(model: Model, spec: AuthorSpec): { ops: Op[]; diagramId: string }
```

**Approach:** slugify to resolve/create entities; build a fully-populated `Diagram` in a cloned model; run `layoutDiagram`; apply any `spec.positions` overrides; then `diffToOps(model, next)` for the ops. This reuses `addEntity`/`addDiagram`/`diffToOps` — no new mutation logic.

- [ ] **Step 1: Write failing tests** (`authoring.test.ts`):
```ts
import { authorDiagramOps } from './authoring'
import { applyOps } from '../src/ops'
import { addEntity, normalizeModel, getDiagram } from '../src/model'
const base = () => addEntity(normalizeModel({version:1,entities:[],diagrams:[],templates:[]}), {id:'plex',label:'Plex',fields:[]})

it('creates a laid-out diagram with existing + new nodes, an edge, and a note', () => {
  const m = base()
  const { ops, diagramId } = authorDiagramOps(m, {
    name:'Flow', nodes:['plex', {new:'Grafana'}], edges:[['plex','grafana',{label:'metrics'}]], notes:{plex:'4k'}
  })
  const next = applyOps(m, ops)
  const d = getDiagram(next, diagramId)!
  expect(d.placements.map(p=>p.entityId).sort()).toEqual(['grafana','plex'])
  expect(next.entities.some(e=>e.id==='grafana')).toBe(true)       // new entity created
  expect(d.edges).toHaveLength(1)
  expect(d.placements.find(p=>p.entityId==='plex')!.note).toBe('4k')
  const px = d.placements.find(p=>p.entityId==='plex')!.position.x
  const gx = d.placements.find(p=>p.entityId==='grafana')!.position.x
  expect(px).toBeLessThan(gx)                                       // laid out (source left of target)
})

it('throws on an unknown existing entity id', () => {
  expect(() => authorDiagramOps(base(), { name:'X', nodes:['nope'] })).toThrow()
})

it('honors an agent-supplied position override', () => {
  const { ops, diagramId } = authorDiagramOps(base(), { name:'X', nodes:['plex'], positions:{ plex:{x:999,y:5} } })
  const d = getDiagram(applyOps(base(), ops), diagramId)!
  expect(d.placements[0].position).toEqual({x:999,y:5})
})
```

- [ ] **Step 2: Run to see fail** → FAIL.
- [ ] **Step 3: Implement** `authorDiagramOps`: resolve each node (string → must exist in model.entities else throw; `{new}` → slug id, `addEntity` with `{id,label,icon,fields:[]}` if not present); `addDiagram(model, name, type??'canvas')` for the id; build placements (all `{x:0,y:0}` initially), groups (`{id:'g-'+slug(label)+i, label, color:'#64748b', position:{0,0}, size:{0,0}}`, set members' `parentId`), edges (`{id:'e'+i+'-'+from+'-'+to', from, to, type:'talks-to', ...attrs}`), notes (placement.note). Assemble into the diagram in the cloned model; `layoutDiagram` that diagram; override positions from `spec.positions`; write the laid-out diagram back into the cloned model; return `{ ops: diffToOps(model, cloned), diagramId }`.
- [ ] **Step 4: Run tests + typecheck** → green.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): authoring module (author spec -> laid-out ops)"`

---

## Task 3: MCP server module (`server/mcp.ts`)

**Files:** Create `webapp/server/mcp.ts`; Test `webapp/server/mcp.test.ts`. Adds dep `@modelcontextprotocol/sdk`.

**Interfaces (Produces):**
```ts
// Plain, unit-testable handler logic (no transport). Each returns a result object.
export const handlers = {
  listEntities(store): {id;label;icon?;status?}[]
  listDiagrams(store): {id;name;type}[]
  getDiagram(store, id): Diagram | { error: string }
  authorDiagram(store, spec): { diagramId: string } | { error: string }
  placeEntity(store, a): { ok: true } | { error: string }
  connect(store, a): { ok: true } | { error: string }
  setEdge(store, a): { ok: true } | { error: string }
  setNote(store, a): { ok: true } | { error: string }
  remove(store, a): { ok: true } | { error: string }
  layout(store, diagramId): { ok: true } | { error: string }
}
// Build an McpServer that registers each handler as a tool.
export function createMcpServer(store: Store): McpServer
```

**Approach:** each write handler validates against `store.getState().model`, builds `Op[]`, calls `store.apply(ops, 'mcp')`, returns a small result; reads use `store.getState().model`. `authorDiagram` calls `authorDiagramOps`. Tools are registered with zod input schemas; the tool callback wraps the plain handler and returns `{ content: [{ type:'text', text: JSON.stringify(result) }] }`. **Confirm the exact SDK API (`McpServer`, tool/`registerTool`, zod shape) against the installed `@modelcontextprotocol/sdk` version — match it; the shape below is the intended structure.**

- [ ] **Step 1: add dep** — `npm install @modelcontextprotocol/sdk zod`; confirm import + tsc.
- [ ] **Step 2: Write failing tests** (`mcp.test.ts`) against the plain `handlers` (no transport), using a real in-memory store:
```ts
import { handlers } from './mcp'
import { createStore } from './store'
const mkStore = () => createStore({ file:'x', load: async()=>({version:1,entities:[{id:'plex',label:'Plex',fields:[]}],diagrams:[],templates:[]}), save: async()=>{} })

it('authorDiagram creates a laid-out diagram in the store', async () => {
  const store = await mkStore()
  const res = handlers.authorDiagram(store, { name:'Flow', nodes:['plex',{new:'Grafana'}], edges:[['plex','grafana']] }) as {diagramId:string}
  const d = store.getState().model.diagrams.find(x=>x.id===res.diagramId)!
  expect(d.placements.map(p=>p.entityId).sort()).toEqual(['grafana','plex'])
})
it('listEntities returns catalog', async () => {
  const store = await mkStore()
  expect(handlers.listEntities(store).map(e=>e.id)).toContain('plex')
})
it('connect on a missing diagram errors, store unchanged', async () => {
  const store = await mkStore(); const rev0 = store.getState().rev
  const r = handlers.connect(store, { diagramId:'nope', from:'a', to:'b' })
  expect('error' in r).toBe(true); expect(store.getState().rev).toBe(rev0)
})
```
- [ ] **Step 3: Run to see fail** → FAIL.
- [ ] **Step 4: Implement** the `handlers` object (validate → build ops → `store.apply(ops,'mcp')`; reads from `getState()`), then `createMcpServer(store)` registering each as a tool with a zod schema and a `{content:[{type:'text',text:JSON.stringify(...)}]}` wrapper. Keep handler bodies out of the tool closures so the tests above exercise them directly.
- [ ] **Step 5: Run tests + typecheck** → green.
- [ ] **Step 6: Commit** — `git commit -m "feat(server): MCP tool handlers + createMcpServer"`

---

## Task 4: Mount the MCP in the dev server (`vite.config.ts`)

**Files:** Modify `webapp/vite.config.ts` (inside `modelApi`'s `configureServer`, after the existing routes, sharing `storeReady`).

**Approach:** create the `McpServer` once (`createMcpServer(await storeReady)`) and a `StreamableHTTPServerTransport`; mount `server.middlewares.use('/mcp', handler)` that delegates to the transport's `handleRequest(req, res, body)`. **Match the installed SDK's Streamable-HTTP server API** (stateless mode — `sessionIdGenerator: undefined` — is simplest for a single-user dev tool; if the SDK requires a per-request transport, create it per request). Do not create a second store.

- [ ] **Step 1:** wire the `/mcp` middleware sharing `storeReady`; `createMcpServer` once; connect it to the transport per the SDK.
- [ ] **Step 2: Manual verify** — with `npm run dev` running, connect a minimal MCP client (or the SDK's client over Streamable-HTTP) to `http://localhost:5173/mcp`, `list_tools` (expect the read/granular/author tools), call `author_diagram` on a **throwaway** diagram name, confirm via `GET /api/model` that the diagram exists and is laid out, then delete it (via a `remove`/`diagram.delete` op) so `model.json` is left as found. Capture output in the report. Reuse a running server; don't kill one you didn't start.
- [ ] **Step 3: typecheck** → `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** — `git commit -m "feat(server): host MCP at /mcp in the dev server"`

---

## Task 5: End-to-end verification

**Files:** none unless a bug is found (then report it).

- [ ] **Step 1: Live agent-authoring proof.** Back up `webapp/model.json`. With the app open in a browser and `npm run dev` running, drive the MCP (SDK client or the same harness as Task 4) to `author_diagram` a **scratch** diagram, then a granular `connect`/`set_edge`. Assert each appears LIVE in the open app (SSE) and persists to `model.json`. Prefer existing catalog entities; delete any test entities + the scratch diagram in cleanup; confirm `model.json`'s diagram/entity id sets match the backup, then remove the backup. Protect the user's real data exactly as in Phase-1 Task 11.
- [ ] **Step 2: Regression sweep** — `npx vitest run` (all green, ≥ 62 + the new server tests) and `npx tsc --noEmit` clean. Click-through the app once (diagrams/entities) for console errors, **over the LAN IP `http://192.168.1.21:5173`** (non-secure context) as well as localhost, since the app is used over LAN.
- [ ] **Step 3: Commit** — `git commit -m "test: verify live MCP authoring end-to-end"` (or DONE with no code change if verification-only).

---

## Notes for the executor

- **SDK API is version-specific.** Tasks 3-4 give the intended structure; the implementer MUST confirm the exact `@modelcontextprotocol/sdk` server/tool/transport API against the installed version and match it. If the API differs materially from the sketch, adapt (same behavior) and note it — this is expected, not a deviation to escalate.
- **Server-safety:** never import `@xyflow/react`, dagre, or the MCP SDK from `src/**` (client); keep those in `server/**`. If tsc starts pulling dagre/SDK into the client bundle, a client file imported a server module — fix the import direction.
- **Out of scope:** reconciliation, diagram-type rendering, auth, wiring the app Tidy button to the server layout. Grid `relayout` stays client-side.

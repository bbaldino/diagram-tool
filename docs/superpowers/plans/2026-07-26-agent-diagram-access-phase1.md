# Agent Diagram Access — Phase 1 (State Service + App-as-Client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the model's source of truth from the browser into the existing Vite dev-server, which owns the model, applies serialized operations, persists `model.json`, and broadcasts changes over SSE — with the React app migrated to be a client of it.

**Architecture:** A shared, browser+Node-safe operation vocabulary (`Op` union) plus a pure `applyOp(model, op)` reducer built on the existing `model.ts` transforms. The dev server holds the model in memory, applies ops (single writer, `rev`-stamped), persists the file, and pushes an SSE stream. The app sends its edits as ops (derived by diffing its optimistic local model against the last server model) and re-seeds from the SSE stream.

**Tech Stack:** TypeScript, React 18, Vite dev server middleware (Connect), `@xyflow/react` v12 (client only), vitest, Playwright.

## Global Constraints

- `npm run typecheck` (`tsc --noEmit`, strict) MUST pass at the end of every task; `npx vitest run` MUST stay green (add tests, never remove).
- New identifiers: capitalize only the first letter of a multi-letter acronym (`Sse`, not `SSE`; `HttpStore`, not `HTTPStore`).
- **`model.ts` must remain free of any runtime (value) import from `@xyflow/react` or `graph.ts`** after Task 1 — type-only imports (erased) are allowed. This is what makes it importable by the Node dev server. Any task that reintroduces a value import from those into `model.ts` is a defect.
- Persistence stays a JSON file at `webapp/model.json` (existing schema, unchanged). No database. Do not delete `graph.json`. `model.json` stays git-ignored.
- The server is the single writer to `model.json`. The client never writes the file directly (the old `PUT /api/model` whole-file save is removed in Task 10).
- Never use `window.alert/prompt/confirm` (project rule; use the existing `Dialog` system).

## Current model.ts surface (do not rewrite — extend)

Types: `Entity{id,label,icon?,sub?,status?,kind?,template?,fields:EntityField[]}`, `EntityField{key,value,showOnNode?}`, `Template{id,name,icon?,fields:TemplateField[]}`, `TemplateField{key,showOnNode?,default?}`, `Placement{entityId,position,parentId?,fieldShow?,note?}`, `Group{id,label,color,position,size}`, `Note{id,position,size,text}`, `DEdge{id,from,to,type,label?,inferred?,shape?,points?,sourceHandle?,targetHandle?,dir?,color?}`, `Diagram{id,name,title,type,placements,groups,edges,notes}`, `Model{version,entities,diagrams,templates}`, `DiagramType='canvas'|'topology'|'call-flow'`.
Functions: `entitiesById`, `normalizeModel`, `migrateFromGraph`, `buildDiagramGraph` (moves in Task 1), `getDiagram`, `updateEntity`, `addEntity`, `deleteEntity`, `addPlacement`, `removePlacement`, `patchDiagram`, `addDiagram(name,type)→{model,id}`, `renameDiagram`, `deleteDiagram`, `fieldVisible`, `addTemplate(name)→{model,id}`, `updateTemplate`, `deleteTemplate`, `applyTemplate(entity,template)→Entity`, `setEntityFields`, `setFieldShow`. Internal helper `mapDiagram(model,id,fn)` exists.

---

## File Structure

- `webapp/src/buildGraph.ts` (**new**) — client-only render bridge; holds `buildDiagramGraph` moved out of `model.ts` (imports `graph.ts` + `@xyflow/react`).
- `webapp/src/model.ts` (**modify**) — remove `buildDiagramGraph` + its `graph.ts`/`@xyflow` value imports; add granular diagram-part mutators (Task 2).
- `webapp/src/ops.ts` (**new**) — `Op` union + `applyOp(model, op): Model` reducer + `applyOps`. Server-safe (imports only `model.ts`).
- `webapp/src/diff.ts` (**new**) — `diffToOps(prev, next): Op[]`. Server-safe.
- `webapp/server/store.ts` (**new**) — in-memory model authority: load/persist `model.json`, `getState(): {rev, model}`, `apply(ops): {rev}`, subscribe/notify. Node-only.
- `webapp/src/modelClient.ts` (**new**) — browser client: `fetchState()`, `subscribe(cb)`, `sendOps(ops)`.
- `webapp/vite.config.ts` (**modify**) — replace the dumb `/api/model` GET/PUT with store-backed `GET /api/model`, `POST /api/ops`, and `GET /api/model/stream` (SSE).
- `webapp/src/App.tsx` (**modify**) — read path (subscribe/seed/re-seed) and write path (diff→ops); remove whole-file save.
- Tests: `webapp/src/ops.test.ts`, `webapp/src/diff.test.ts`, `webapp/server/store.test.ts` (**new**); `webapp/src/model.test.ts` (**modify** if needed).

---

## Task 1: Make `model.ts` server-safe (extract `buildDiagramGraph`)

**Files:**
- Create: `webapp/src/buildGraph.ts`
- Modify: `webapp/src/model.ts` (remove `buildDiagramGraph` + `graph.ts`/`@xyflow` value imports)
- Modify: `webapp/src/App.tsx`, `webapp/src/nodes.tsx` (any importer of `buildDiagramGraph`) — update import path.

**Interfaces:**
- Produces: `buildDiagramGraph(diagram, byId, templates?)` now exported from `./buildGraph` with the identical signature `(diagram: Diagram, byId: Record<string, Entity>, templates?: Template[]) => { nodes: Node[]; edges: Edge[] }`.
- Produces: `model.ts` with **no** value import from `@xyflow/react` or `./graph`.

- [ ] **Step 1: Write the failing test** — assert `model.ts` has no runtime xyflow/graph import.

Create `webapp/src/model.serversafe.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('model.ts is server-safe', () => {
  it('has no value import from @xyflow/react or ./graph', () => {
    const src = readFileSync(new URL('./model.ts', import.meta.url), 'utf8')
    // value imports look like `import { X } from '...'` WITHOUT a leading `type`
    const badXyflow = /import\s+(?!type\b)\{[^}]*\}\s+from\s+['"]@xyflow\/react['"]/.test(src)
    const badGraph = /import\s+(?!type\b)\{[^}]*\}\s+from\s+['"]\.\/graph['"]/.test(src)
    // a mixed import with inline `type` markers on ALL members is fine; guard the common case
    expect(badXyflow).toBe(false)
    expect(badGraph).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/model.serversafe.test.ts`
Expected: FAIL (model.ts currently value-imports `makeEdge, restyleEdge` from `./graph`).

- [ ] **Step 3: Create `buildGraph.ts` with the moved function**

Move the entire `buildDiagramGraph` function body from `model.ts` into a new file:
```ts
// webapp/src/buildGraph.ts
import { type Node, type Edge } from '@xyflow/react'
import { makeEdge, restyleEdge } from './graph'
import { fieldVisible, type Diagram, type Entity, type Template } from './model'

export function buildDiagramGraph(
  diagram: Diagram,
  byId: Record<string, Entity>,
  templates: Template[] = [],
): { nodes: Node[]; edges: Edge[] } {
  // ...exact body moved verbatim from model.ts (uses makeEdge/restyleEdge/fieldVisible)...
}
```
Ensure `fieldVisible`, `Diagram`, `Entity`, `Template` are exported from `model.ts` (they already are).

- [ ] **Step 4: Strip `buildDiagramGraph` + its imports from `model.ts`**

In `model.ts`: delete the `buildDiagramGraph` function. Change the top import from `import { makeEdge, restyleEdge, type EdgeDir } from './graph'` to `import { type EdgeDir } from './graph'` (type-only, erased). Remove the now-unused `import { type Node, type Edge } from '@xyflow/react'` if present.

- [ ] **Step 5: Update importers**

Repoint every `buildDiagramGraph` import. Search: `grep -rn "buildDiagramGraph" webapp/src`. In `App.tsx` change `import { ..., buildDiagramGraph, ... } from './model'` → import it from `./buildGraph` (drop from the `./model` import list).

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green; `model.serversafe.test.ts` passes.

- [ ] **Step 7: Commit**

```bash
git add webapp/src/buildGraph.ts webapp/src/model.ts webapp/src/App.tsx webapp/src/model.serversafe.test.ts
git commit -m "refactor: extract buildDiagramGraph so model.ts is server-safe"
```

---

## Task 2: Granular diagram-part mutators in `model.ts`

Add the small pure functions the op reducer needs but that don't yet exist. All follow the existing `mapDiagram` pattern (map over `model.diagrams`, replace the matching diagram's array immutably).

**Files:**
- Modify: `webapp/src/model.ts`
- Test: `webapp/src/model.test.ts`

**Interfaces (Produces — exact signatures):**
```ts
export function setPlacement(model: Model, diagramId: string, entityId: string,
  patch: Partial<Pick<Placement,'position'|'parentId'|'note'>>): Model
export function addGroup(model: Model, diagramId: string, group: Group): Model
export function updateGroup(model: Model, diagramId: string, id: string, patch: Partial<Omit<Group,'id'>>): Model
export function removeGroup(model: Model, diagramId: string, id: string): Model // also clears parentId on its child placements
export function addNote(model: Model, diagramId: string, note: Note): Model
export function updateNote(model: Model, diagramId: string, id: string, patch: Partial<Omit<Note,'id'>>): Model
export function removeNote(model: Model, diagramId: string, id: string): Model
export function addEdge(model: Model, diagramId: string, edge: DEdge): Model
export function updateEdge(model: Model, diagramId: string, id: string, patch: Partial<Omit<DEdge,'id'>>): Model
export function removeEdge(model: Model, diagramId: string, id: string): Model
```

- [ ] **Step 1: Write failing tests** (add to `model.test.ts`):
```ts
describe('granular diagram mutators', () => {
  const base = addDiagram(normalizeModel({ version: 1, entities: [], diagrams: [], templates: [] }), 'D', 'canvas')
  const id = base.id
  it('setPlacement upserts position/parent/note on an existing placement', () => {
    let m = addPlacement(base.model, id, { entityId: 'e1', position: { x: 0, y: 0 } })
    m = setPlacement(m, id, 'e1', { position: { x: 10, y: 20 }, note: 'hi' })
    const p = getDiagram(m, id)!.placements[0]
    expect(p.position).toEqual({ x: 10, y: 20 })
    expect(p.note).toBe('hi')
  })
  it('addEdge/updateEdge/removeEdge round-trip', () => {
    let m = addEdge(base.model, id, { id: 'x1', from: 'a', to: 'b', type: 'talks-to' })
    expect(getDiagram(m, id)!.edges).toHaveLength(1)
    m = updateEdge(m, id, 'x1', { label: 'L', color: '#ff0000' })
    expect(getDiagram(m, id)!.edges[0].label).toBe('L')
    m = removeEdge(m, id, 'x1')
    expect(getDiagram(m, id)!.edges).toHaveLength(0)
  })
  it('removeGroup clears parentId on its children', () => {
    let m = addGroup(base.model, id, { id: 'g1', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 200, height: 120 } })
    m = addPlacement(m, id, { entityId: 'e1', position: { x: 0, y: 0 }, parentId: 'g1' })
    m = removeGroup(m, id, 'g1')
    expect(getDiagram(m, id)!.groups).toHaveLength(0)
    expect(getDiagram(m, id)!.placements[0].parentId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to see fail**

Run: `npx vitest run src/model.test.ts -t "granular diagram mutators"`
Expected: FAIL (functions undefined).

- [ ] **Step 3: Implement the mutators** using the existing internal `mapDiagram`. Representative implementations (the rest follow the identical shape with the signatures above):
```ts
export function setPlacement(model, diagramId, entityId, patch) {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    placements: d.placements.map((p) => (p.entityId === entityId ? { ...p, ...patch } : p)),
  }))
}
export function addEdge(model, diagramId, edge) {
  return mapDiagram(model, diagramId, (d) =>
    d.edges.some((e) => e.id === edge.id) ? d : { ...d, edges: [...d.edges, edge] })
}
export function updateEdge(model, diagramId, id, patch) {
  return mapDiagram(model, diagramId, (d) => ({
    ...d, edges: d.edges.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)) }))
}
export function removeEdge(model, diagramId, id) {
  return mapDiagram(model, diagramId, (d) => ({ ...d, edges: d.edges.filter((e) => e.id !== id) }))
}
export function removeGroup(model, diagramId, id) {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    groups: d.groups.filter((g) => g.id !== id),
    placements: d.placements.map((p) => (p.parentId === id ? { ...p, parentId: undefined } : p)),
  }))
}
// addGroup/updateGroup, addNote/updateNote/removeNote: identical shapes over d.groups / d.notes.
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** — `git commit -m "feat(model): granular diagram-part mutators"`

---

## Task 3: `Op` union + `applyOp` reducer

**Files:**
- Create: `webapp/src/ops.ts`
- Test: `webapp/src/ops.test.ts`

**Interfaces (Produces):**
```ts
export type Op =
  | { t: 'entity.add'; entity: Entity }
  | { t: 'entity.update'; id: string; patch: Partial<Omit<Entity,'id'>> }
  | { t: 'entity.delete'; id: string }
  | { t: 'entity.setFields'; id: string; fields: EntityField[] }
  | { t: 'entity.applyTemplate'; id: string; templateId: string }
  | { t: 'template.add'; name: string }
  | { t: 'template.update'; id: string; patch: Partial<Omit<Template,'id'>> }
  | { t: 'template.delete'; id: string }
  | { t: 'diagram.add'; name: string; kind: DiagramType }
  | { t: 'diagram.rename'; id: string; name: string }
  | { t: 'diagram.delete'; id: string }
  | { t: 'placement.add'; diagramId: string; placement: Placement }
  | { t: 'placement.remove'; diagramId: string; entityId: string }
  | { t: 'placement.set'; diagramId: string; entityId: string; patch: Partial<Pick<Placement,'position'|'parentId'|'note'>> }
  | { t: 'placement.fieldShow'; diagramId: string; entityId: string; key: string; value: boolean | undefined }
  | { t: 'group.add'; diagramId: string; group: Group }
  | { t: 'group.update'; diagramId: string; id: string; patch: Partial<Omit<Group,'id'>> }
  | { t: 'group.remove'; diagramId: string; id: string }
  | { t: 'note.add'; diagramId: string; note: Note }
  | { t: 'note.update'; diagramId: string; id: string; patch: Partial<Omit<Note,'id'>> }
  | { t: 'note.remove'; diagramId: string; id: string }
  | { t: 'edge.add'; diagramId: string; edge: DEdge }
  | { t: 'edge.update'; diagramId: string; id: string; patch: Partial<Omit<DEdge,'id'>> }
  | { t: 'edge.remove'; diagramId: string; id: string }

export function applyOp(model: Model, op: Op): Model
export function applyOps(model: Model, ops: Op[]): Model // reduce(applyOp)
```
Note: `diagram.add`/`template.add` ignore the generated id in the reducer return (id-carrying ops are only used by the client's own creation flow, which reads the id it generated locally; the diff path never emits them). `applyOp` is total: unknown `t` throws `Error('unknown op: '+t)`.

- [ ] **Step 1: Write failing tests** (`ops.test.ts`): one assertion per op family; e.g.
```ts
import { applyOp, applyOps } from './ops'
import { addDiagram, normalizeModel, getDiagram } from './model'
const empty = normalizeModel({ version: 1, entities: [], diagrams: [], templates: [] })
it('entity.add then entity.update', () => {
  let m = applyOp(empty, { t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } })
  m = applyOp(m, { t: 'entity.update', id: 'e1', patch: { label: 'E2' } })
  expect(m.entities[0].label).toBe('E2')
})
it('edge.add/update/remove via applyOps', () => {
  const d = addDiagram(empty, 'D', 'canvas')
  const m = applyOps(d.model, [
    { t: 'edge.add', diagramId: d.id, edge: { id: 'x', from: 'a', to: 'b', type: 'talks-to' } },
    { t: 'edge.update', diagramId: d.id, id: 'x', patch: { dir: 'both' } },
  ])
  expect(getDiagram(m, d.id)!.edges[0].dir).toBe('both')
})
it('throws on unknown op', () => {
  expect(() => applyOp(empty, { t: 'bogus' } as any)).toThrow(/unknown op/)
})
```
Cover at least: entity add/update/delete/setFields/applyTemplate, template add/update/delete, diagram add/rename/delete, placement add/remove/set/fieldShow, group add/update/remove, note add/update/remove, edge add/update/remove.

- [ ] **Step 2: Run to see fail** — `npx vitest run src/ops.test.ts` → FAIL.

- [ ] **Step 3: Implement `applyOp`** as a `switch (op.t)` dispatching to the `model.ts` functions:
```ts
import * as M from './model'
import type { Model, Entity, EntityField, Template, Placement, Group, Note, DEdge, DiagramType } from './model'
export function applyOp(model: Model, op: Op): Model {
  switch (op.t) {
    case 'entity.add': return M.addEntity(model, op.entity)
    case 'entity.update': return M.updateEntity(model, op.id, op.patch)
    case 'entity.delete': return M.deleteEntity(model, op.id)
    case 'entity.setFields': return M.setEntityFields(model, op.id, op.fields)
    case 'entity.applyTemplate': {
      const t = model.templates.find((x) => x.id === op.templateId)
      const e = model.entities.find((x) => x.id === op.id)
      if (!t || !e) return model
      return M.updateEntity(model, op.id, M.applyTemplate(e, t))
    }
    case 'template.add': return M.addTemplate(model, op.name).model
    case 'template.update': return M.updateTemplate(model, op.id, op.patch)
    case 'template.delete': return M.deleteTemplate(model, op.id)
    case 'diagram.add': return M.addDiagram(model, op.name, op.kind).model
    case 'diagram.rename': return M.renameDiagram(model, op.id, op.name)
    case 'diagram.delete': return M.deleteDiagram(model, op.id)
    case 'placement.add': return M.addPlacement(model, op.diagramId, op.placement)
    case 'placement.remove': return M.removePlacement(model, op.diagramId, op.entityId)
    case 'placement.set': return M.setPlacement(model, op.diagramId, op.entityId, op.patch)
    case 'placement.fieldShow': return M.setFieldShow(model, op.diagramId, op.entityId, op.key, op.value)
    case 'group.add': return M.addGroup(model, op.diagramId, op.group)
    case 'group.update': return M.updateGroup(model, op.diagramId, op.id, op.patch)
    case 'group.remove': return M.removeGroup(model, op.diagramId, op.id)
    case 'note.add': return M.addNote(model, op.diagramId, op.note)
    case 'note.update': return M.updateNote(model, op.diagramId, op.id, op.patch)
    case 'note.remove': return M.removeNote(model, op.diagramId, op.id)
    case 'edge.add': return M.addEdge(model, op.diagramId, op.edge)
    case 'edge.update': return M.updateEdge(model, op.diagramId, op.id, op.patch)
    case 'edge.remove': return M.removeEdge(model, op.diagramId, op.id)
    default: throw new Error('unknown op: ' + (op as any).t)
  }
}
export const applyOps = (model: Model, ops: Op[]) => ops.reduce(applyOp, model)
```

- [ ] **Step 4: Run tests + typecheck** → green.
- [ ] **Step 5: Commit** — `git commit -m "feat(ops): Op union + applyOp reducer over model transforms"`

---

## Task 4: `diffToOps(prev, next)`

Compute the minimal op list that turns `prev` into `next`. Match by id; the app calls this at its write-back boundary so it can keep mutating its local model and still speak ops.

**Files:**
- Create: `webapp/src/diff.ts`
- Test: `webapp/src/diff.test.ts`

**Interfaces (Produces):** `export function diffToOps(prev: Model, next: Model): Op[]`

Semantics (order matters — emit in this order so the result applies cleanly):
1. Entities: for id in next not in prev → `entity.add`; in both but changed (deep-unequal) → `entity.update` with the full non-id fields as patch; in prev not in next → `entity.delete`.
2. Templates: same add/update/delete by id (`template.*`). Note `template.add` carries only `name`; if a template's fields changed, emit `template.update`.
3. Diagrams: id in next not prev → `diagram.add` (name, type); missing → `diagram.delete`; name changed → `diagram.rename`.
4. Per diagram present in both: diff `placements` (by `entityId`: add/remove/`placement.set` on any of position/parentId/note/fieldShow — fieldShow diffs emit `placement.fieldShow` per changed key), `groups`/`notes`/`edges` (by `id`: add/remove/update).

Keep it a pure function; deep-equality via `JSON.stringify` comparison of the relevant slice is acceptable (objects are plain JSON).

- [ ] **Step 1: Write failing tests** (`diff.test.ts`) — round-trip property + targeted cases:
```ts
import { diffToOps } from './diff'
import { applyOps } from './ops'
import { addDiagram, addPlacement, addEntity, normalizeModel, getDiagram, setPlacement } from './model'
const empty = normalizeModel({ version: 1, entities: [], diagrams: [], templates: [] })

it('round-trips: applyOps(prev, diffToOps(prev,next)) deep-equals next', () => {
  const prev = addEntity(empty, { id: 'e1', label: 'E', fields: [] })
  const d = addDiagram(prev, 'D', 'canvas')
  let next = addPlacement(d.model, d.id, { entityId: 'e1', position: { x: 5, y: 5 } })
  next = addEntity(next, { id: 'e2', label: 'E2', fields: [] })
  const ops = diffToOps(prev, next)
  expect(applyOps(prev, ops)).toEqual(next)
})

it('a node move emits exactly one placement.set', () => {
  const created = addDiagram(empty, 'D', 'canvas')
  const did = created.id
  const prev = addPlacement(created.model, did, { entityId: 'e1', position: { x: 0, y: 0 } })
  const next = setPlacement(prev, did, 'e1', { position: { x: 40, y: 10 } })
  const ops = diffToOps(prev, next)
  expect(ops).toEqual([{ t: 'placement.set', diagramId: did, entityId: 'e1', patch: { position: { x: 40, y: 10 } } }])
})

it('empty diff for identical models', () => {
  expect(diffToOps(empty, empty)).toEqual([])
})
```

- [ ] **Step 2: Run to see fail** — `npx vitest run src/diff.test.ts` → FAIL.
- [ ] **Step 3: Implement `diffToOps`** per the semantics above (pure; helper `changed(a,b)=>JSON.stringify(a)!==JSON.stringify(b)`; for `placement.set` include only the sub-keys among position/parentId/note that changed; for fieldShow emit `placement.fieldShow` per key whose boolean differs, `value: undefined` when a key was removed).
- [ ] **Step 4: Run tests + typecheck** → green (the round-trip test is the primary guard).
- [ ] **Step 5: Commit** — `git commit -m "feat(diff): diffToOps derives ops from two model snapshots"`

---

## Task 5: Server store (`webapp/server/store.ts`)

The in-memory authority. Node-only; imports `ops.ts`/`model.ts` (server-safe after Task 1).

**Files:**
- Create: `webapp/server/store.ts`
- Test: `webapp/server/store.test.ts`

**Interfaces (Produces):**
```ts
export interface Snapshot { rev: number; model: Model }
export interface Store {
  getState(): Snapshot
  apply(ops: Op[]): Snapshot            // applies, bumps rev, schedules persist, notifies
  subscribe(cb: (s: Snapshot) => void): () => void  // returns unsubscribe
}
export function createStore(opts: { file: string; load: () => Promise<any>; save: (m: Model) => Promise<void> }): Promise<Store>
```
Behavior: on create, `load()` the file (or seed an empty normalized model if missing), `normalizeModel` it, `rev=0`. `apply(ops)` runs `applyOps`, `rev++`, debounced `save(model)` (250ms), synchronously notifies subscribers with the new snapshot. Writes are serialized simply because Node runs `apply` synchronously on the event loop.

- [ ] **Step 1: Write failing tests** (`store.test.ts`) using an in-memory fake for load/save:
```ts
import { createStore } from './store'
it('apply bumps rev, updates model, notifies, and persists', async () => {
  let saved: any = null
  const store = await createStore({
    file: 'x', load: async () => ({ version: 1, entities: [], diagrams: [], templates: [] }),
    save: async (m) => { saved = m },
  })
  const seen: number[] = []
  store.subscribe((s) => seen.push(s.rev))
  const s1 = store.apply([{ t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } }])
  expect(s1.rev).toBe(1)
  expect(store.getState().model.entities).toHaveLength(1)
  expect(seen).toEqual([1])
  await new Promise((r) => setTimeout(r, 300))
  expect(saved.entities).toHaveLength(1)
})
```

- [ ] **Step 2: Run to see fail** → FAIL.
- [ ] **Step 3: Implement `createStore`** (in-memory model + rev; subscriber Set; debounced save via a timer reset on each apply).
- [ ] **Step 4: Run tests + typecheck** → green.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): in-memory model store with rev + debounced persist"`

---

## Task 6: Wire store into dev-server endpoints (`GET /api/model`, `POST /api/ops`)

**Files:**
- Modify: `webapp/vite.config.ts`

**Interfaces (Produces — HTTP):**
- `GET /api/model` → `200 { rev, model }` (JSON snapshot).
- `POST /api/ops` body `{ ops: Op[] }` → `200 { rev }`; on apply error → `400 { error }`.

- [ ] **Step 1: Add a store instance in `configureServer`** — create the store once (module-scoped promise), backed by `readFile('webapp/model.json')` / `writeFile(...)` (reuse the existing file path + `normalizeModel` on load). Replace the current `/api/model` GET/PUT handler.

- [ ] **Step 2: Implement the routes** (Connect middleware):
```ts
server.middlewares.use('/api/model', async (req, res, next) => {
  if (req.method !== 'GET') return next()
  const s = (await storeReady).getState()
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(s))
})
server.middlewares.use('/api/ops', async (req, res, next) => {
  if (req.method !== 'POST') return next()
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c)
  try {
    const { ops } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const s = (await storeReady).apply(ops)
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ rev: s.rev }))
  } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e) })) }
})
```

- [ ] **Step 3: Manual verify** — `npm run dev` in one shell; in another:
```bash
curl -s localhost:5173/api/model | head -c 120        # {"rev":0,"model":{...}}
curl -s -X POST localhost:5173/api/ops -H 'content-type: application/json' \
  -d '{"ops":[{"t":"diagram.add","name":"Probe","kind":"canvas"}]}'   # {"rev":1}
curl -s localhost:5173/api/model | python3 -c 'import sys,json;print([d["name"] for d in json.load(sys.stdin)["model"]["diagrams"]])'
```
Expected: the `Probe` diagram appears; `model.json` on disk contains it. Then delete the probe diagram via another op to clean up.

- [ ] **Step 4: Commit** — `git commit -m "feat(server): store-backed GET /api/model + POST /api/ops"`

---

## Task 7: SSE broadcast (`GET /api/model/stream`)

**Files:**
- Modify: `webapp/vite.config.ts`

**Interfaces (Produces — HTTP):** `GET /api/model/stream` → `text/event-stream`; emits `data: {rev, model}\n\n` immediately on connect and on every store change; keep-alive comment every 25s.

- [ ] **Step 1: Add the SSE route** using `store.subscribe`:
```ts
server.middlewares.use('/api/model/stream', async (req, res, next) => {
  if (req.method !== 'GET') return next()
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const store = await storeReady
  const send = (s) => res.write(`data: ${JSON.stringify(s)}\n\n`)
  send(store.getState())
  const off = store.subscribe(send)
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 25000)
  req.on('close', () => { off(); clearInterval(ka) })
})
```

- [ ] **Step 2: Manual verify** — `curl -N localhost:5173/api/model/stream` streams an initial snapshot; POST an op in another shell → a new `data:` frame arrives. Clean up any probe op.
- [ ] **Step 3: Commit** — `git commit -m "feat(server): SSE model stream"`

---

## Task 8: Browser model client (`webapp/src/modelClient.ts`)

**Files:**
- Create: `webapp/src/modelClient.ts`

**Interfaces (Produces):**
```ts
export interface Snapshot { rev: number; model: Model }
export function fetchState(): Promise<Snapshot>                 // GET /api/model
export function subscribe(cb: (s: Snapshot) => void): () => void // EventSource on /api/model/stream
export function sendOps(ops: Op[]): Promise<{ rev: number }>    // POST /api/ops
```

- [ ] **Step 1: Implement** with `fetch` + `EventSource`. `subscribe` opens `new EventSource('/api/model/stream')`, parses `e.data` JSON, calls `cb`; returns `() => es.close()`. `sendOps` no-ops on empty array (`if (!ops.length) return { rev: -1 }`).
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → green. (No unit test; exercised by Task 11 E2E.)
- [ ] **Step 3: Commit** — `git commit -m "feat(client): model client (fetch/subscribe/sendOps)"`

---

## Task 9: App read path — seed + live re-seed from the server

Migrate `App` from `loadModel()` to the client. The app keeps a local `model` state for optimistic rendering, but it is now **seeded and reconciled from the server**.

**Files:**
- Modify: `webapp/src/App.tsx`

**Interfaces (Consumes):** `fetchState`, `subscribe` from `./modelClient`.

- [ ] **Step 1: Replace initial load** — where `App` currently calls `loadModel()` into `model`/`activeId`, call `fetchState()` once, set `model` from `snap.model`, and store `lastServerRev`/`lastServerModel` refs.
- [ ] **Step 2: Subscribe to the stream** — add an effect: `subscribe((s) => { lastServerRev.current = s.rev; lastServerModel.current = s.model; if (s.rev > ownRev.current) setModel(s.model) })`. `ownRev.current` is the highest rev returned by our own `sendOps` (Task 10) — used to ignore the echo of our own writes so we don't clobber in-flight local edits.
- [ ] **Step 3: Keep the re-seed effect** that rebuilds the canvas when `model` changes (already exists) — it now also fires on remote updates, which is correct.
- [ ] **Step 4: Typecheck + smoke** — `npx tsc --noEmit`; `npm run dev`, open the app: the current diagram loads from the server exactly as before.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): seed and live-reconcile model from the server"`

---

## Task 10: App write path — send ops instead of saving the whole file

Replace the debounced whole-file `saveModel` PUT with: compute the next model locally (as today), `diffToOps(lastServerModel, next)`, `sendOps(ops)`, and advance `ownRev`.

**Files:**
- Modify: `webapp/src/App.tsx`
- Modify: `webapp/src/model.ts` (remove now-dead `saveModel`, and `loadModel`'s save half if unused)

**Interfaces (Consumes):** `diffToOps` from `./diff`, `sendOps` from `./modelClient`.

- [ ] **Step 1: Replace the autosave effect.** Today a debounced effect PUTs the whole model. Change it to:
```ts
// debounced, on model settle:
const next = model // the current optimistic model (already includes flushCanvasInto results)
const ops = diffToOps(lastServerModel.current, next)
if (ops.length) {
  const { rev } = await sendOps(ops)
  if (rev > 0) { ownRev.current = rev; lastServerModel.current = next }
}
```
Keep the existing `flushCanvasInto` calls that run before model mutations, so `model` already reflects canvas geometry when the diff runs.

- [ ] **Step 2: Confirm all mutation sites funnel through `setModel`.** Canvas edits, `onFieldShow`, placement note, diagram CRUD, entity/template edits all already call `setModel`/model mutators, so the single diff-based sync covers them. No per-handler rewrite needed. (Verify by grep: every `setModel(` is a local optimistic update; the sync effect turns the net change into ops.)
- [ ] **Step 3: Remove dead file-save code** — delete `saveModel` and the `PUT /api/model` usage. Leave `migrateFromGraph`/`normalizeModel` (still used server-side and for migration).
- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): route edits through ops (diff-to-ops) instead of whole-file save"`

---

## Task 11: End-to-end verification, no-clobber, cleanup

**Files:**
- Modify: (only if verification surfaces a fix)

- [ ] **Step 1: Single-client round-trip (Playwright).** Start `npm run dev`. In the app, make a representative edit (drag a node, add an edge, edit a field, add an inline note). Confirm `model.json` on disk reflects each (via a `python3` read), i.e. the op path persists.
- [ ] **Step 2: Live two-client test.** Open two browser contexts on `localhost:5173`. Make an edit in A; assert it appears in B within ~1s (SSE re-seed) without a manual reload. Make a *different* edit in B; assert A converges. This is the core "live + no clobber" proof — the failure the whole phase targets.
- [ ] **Step 3: External-writer test.** With the app open, `POST /api/ops` a `diagram.add` via `curl`; assert the new diagram appears live in the open app and persists. (This is the seam Phase 2's MCP will use.)
- [ ] **Step 4: Regression sweep.** `npx vitest run` (all green) + `npx tsc --noEmit`. Click through: diagram switch, palette place, group resize, edge color/direction, templates page, entities page — all still function.
- [ ] **Step 5: Commit** — `git commit -m "test: verify live op-based sync round-trip + no-clobber"`

---

## Notes for the executor

- **Out of scope for Phase 1 (do not build):** the MCP server (Phase 2), server-side auto-layout (Phase 2 — in Phase 1 `Tidy` stays client-computed and its resulting moves flow through `diffToOps` as `placement.set`/`group.update` ops), diagram-type-specific rendering, any database.
- **Conflict policy (v1):** last-writer-wins per field; the `ownRev` echo-guard prevents a client clobbering its own in-flight edits, and cross-client edits to the *same* field are rare and acceptable to lose. Do not build operational-transform/merge machinery.
- **Server-safety is load-bearing:** if `tsc`/vitest starts pulling `@xyflow/react` into the Node store, re-check Task 1 — something re-added a value import to `model.ts`/`ops.ts`.

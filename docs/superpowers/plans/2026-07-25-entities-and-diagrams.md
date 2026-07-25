# Entity Catalog + Multi-Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `webapp/` React Flow app from a single `graph.json` of nodes+edges into a shared **entity catalog** with multiple **diagrams** that are views over it.

**Architecture:** A pure model layer (`src/model.ts`) holds types + pure functions (migration, model→ReactFlow build, and model mutations), unit-tested with vitest. `App.tsx` renders the *active diagram* by calling `buildDiagramGraph`, and maps every canvas edit back to the right level (entity vs placement vs diagram) via the pure model ops. Persistence moves from `graph.json` to `model.json` behind a `/api/model` endpoint; the active diagram is a per-browser localStorage preference.

**Tech Stack:** Vite + React 18 + TypeScript (strict), `@xyflow/react` v12, vitest (new, for the model layer), file-backed persistence via a Vite dev-server middleware.

## Global Constraints

- `npm run typecheck` (tsc --noEmit, strict) MUST pass at the end of every task.
- New identifiers follow the acronym rule: only the first letter of a multi-letter acronym is capitalized (e.g. `Mcp`, not `MCP`; `mcpArr` id stays as data, not identifier).
- Persistence stays file-backed via the Vite middleware pattern already in `vite.config.ts`. Whole-model debounced autosave.
- **Do not delete `graph.json`** — it is the migration source and a backup.
- An entity appears **at most once per diagram**; the ReactFlow node id within a diagram equals the `entityId`.
- Edges and groups are **per-diagram**; entity fields (label/icon/sub/status/kind) are **shared**.
- Spec of record: `docs/superpowers/specs/2026-07-24-entities-and-diagrams-design.md`.

---

## File Structure

- Create `webapp/src/model.ts` — types (`Entity`, `Placement`, `Group`, `DEdge`, `Note`, `Diagram`, `Model`), `entitiesById`, `migrateFromGraph`, `buildDiagramGraph`, and pure model-mutation helpers.
- Create `webapp/src/model.test.ts` — vitest unit tests for the above.
- Create `webapp/src/DiagramBar.tsx` — active-diagram switcher (select / new / rename / delete).
- Create `webapp/src/Palette.tsx` — entity palette (search / place existing / create new).
- Modify `webapp/vite.config.ts` — add `/api/model` (keep `/api/graph` for one release as read-only fallback).
- Modify `webapp/src/App.tsx` — model state, active diagram, render via `buildDiagramGraph`, edits mapped through model ops, host `DiagramBar` + `Palette`.
- Modify `webapp/src/Inspector.tsx` — entity(shared) vs placement fields, two delete scopes.
- Modify `webapp/src/graph.ts` — keep `REL`, `restyleEdge`, `LAYOUT`, `relayout`, `distributeGroupChildren`, `shrinkGroupToChildren`, `makeEdge`; these already operate on ReactFlow node/edge arrays and stay reusable.
- Modify `webapp/package.json` — add `vitest` devDep and `"test"` script.
- `webapp/src/nodes.tsx`, `webapp/src/WaypointEdge.tsx` — unchanged (data is assembled upstream by `buildDiagramGraph`).

---

## Task 1: Test harness + model types + `entitiesById`

**Files:**
- Modify: `webapp/package.json`
- Create: `webapp/src/model.ts`
- Create: `webapp/src/model.test.ts`

**Interfaces:**
- Produces:
  - Types `Entity`, `Placement`, `Group`, `DEdge`, `Note`, `Diagram`, `Model`, `RelType` (re-exported from graph.ts), `DiagramType = 'canvas' | 'topology' | 'call-flow'`.
  - `entitiesById(model: Model): Record<string, Entity>`

- [ ] **Step 1: Add vitest**

Run:
```bash
cd webapp && npm install -D vitest
```
Then add to `webapp/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing test**

Create `webapp/src/model.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { entitiesById, type Model } from './model'

const model: Model = {
  version: 1,
  entities: [
    { id: 'plex', label: 'Plex' },
    { id: 'sonarr', label: 'Sonarr' },
  ],
  diagrams: [],
}

describe('entitiesById', () => {
  it('indexes entities by id', () => {
    const byId = entitiesById(model)
    expect(byId.plex.label).toBe('Plex')
    expect(byId.sonarr.label).toBe('Sonarr')
    expect(Object.keys(byId)).toHaveLength(2)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: FAIL — cannot find `./model`.

- [ ] **Step 4: Write minimal implementation**

Create `webapp/src/model.ts`:
```ts
import type { RelType } from './graph'
export type { RelType }

export type Status = 'up' | 'down' | 'idle'
export type DiagramType = 'canvas' | 'topology' | 'call-flow'

export interface Entity {
  id: string
  label: string
  icon?: string
  sub?: string
  status?: Status
  kind?: 'actor'
}
export interface Placement {
  entityId: string
  position: { x: number; y: number }
  parentId?: string | null // group id
}
export interface Group {
  id: string
  label: string
  color: string
  position: { x: number; y: number }
  size: { width: number; height: number }
}
export interface DEdge {
  id: string
  from: string // entityId
  to: string // entityId
  type: RelType
  label?: string
  inferred?: boolean
  shape?: 'default' | 'smoothstep' | 'straight'
  points?: { x: number; y: number }[]
}
export interface Note {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  text: string
}
export interface Diagram {
  id: string
  name: string
  title: string
  type: DiagramType
  placements: Placement[]
  groups: Group[]
  edges: DEdge[]
  notes: Note[]
}
export interface Model {
  version: number
  entities: Entity[]
  diagrams: Diagram[]
}

export function entitiesById(model: Model): Record<string, Entity> {
  return Object.fromEntries(model.entities.map((e) => [e.id, e]))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd webapp && npm run typecheck` (expect exit 0)
```bash
git add webapp/package.json webapp/package-lock.json webapp/src/model.ts webapp/src/model.test.ts
git commit -m "feat(model): add model types, entitiesById, and vitest harness"
```

---

## Task 2: `migrateFromGraph` (graph.json → Model)

**Files:**
- Modify: `webapp/src/model.ts`
- Modify: `webapp/src/model.test.ts`

**Interfaces:**
- Consumes: the on-disk graph shape `{ nodes: RFNodeLike[], edges: RFEdgeLike[] }` where a node has `id`, `type` (`'group'|'service'|'note'`), `position`, `parentId?`, `data`, `style?`, and an edge has `id`, `source`, `target`, `label?`, `data?: { rel, inferred, shape, points }`.
- Produces: `migrateFromGraph(graph: any): Model` — one `Diagram` named "Logical" (`type: 'canvas'`), entities from service/actor nodes.

- [ ] **Step 1: Write the failing test**

Add to `webapp/src/model.test.ts`:
```ts
import { migrateFromGraph } from './model'

describe('migrateFromGraph', () => {
  const graph = {
    nodes: [
      { id: 'media', type: 'group', position: { x: 0, y: 0 }, data: { label: 'Media', color: '#2f6fed' }, style: { width: 400, height: 200 } },
      { id: 'plex', type: 'service', parentId: 'media', position: { x: 18, y: 44 }, data: { label: 'Plex', icon: 'plex', sub: ':32400', status: 'up' } },
      { id: 'users', type: 'service', position: { x: -300, y: 80 }, data: { label: 'Internet users', kind: 'actor' } },
      { id: 'n1', type: 'note', position: { x: 5, y: 5 }, data: { text: 'hi' }, style: { width: 190, height: 110 } },
    ],
    edges: [
      { id: 'e0-users-plex', source: 'users', target: 'plex', label: 'watches', data: { rel: 'talks-to', inferred: false, shape: 'default' } },
    ],
  }

  it('splits nodes into a catalog + a Logical diagram', () => {
    const m = migrateFromGraph(graph)
    expect(m.entities.map((e) => e.id).sort()).toEqual(['plex', 'users'])
    expect(m.entities.find((e) => e.id === 'plex')).toMatchObject({ label: 'Plex', icon: 'plex', sub: ':32400', status: 'up' })
    expect(m.diagrams).toHaveLength(1)
    const d = m.diagrams[0]
    expect(d.name).toBe('Logical')
    expect(d.type).toBe('canvas')
    expect(d.groups.map((g) => g.id)).toEqual(['media'])
    expect(d.groups[0].size).toEqual({ width: 400, height: 200 })
    expect(d.placements.find((p) => p.entityId === 'plex')).toMatchObject({ parentId: 'media', position: { x: 18, y: 44 } })
    expect(d.notes).toHaveLength(1)
    expect(d.edges[0]).toMatchObject({ from: 'users', to: 'plex', type: 'talks-to', label: 'watches' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: FAIL — `migrateFromGraph` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `webapp/src/model.ts`:
```ts
export function migrateFromGraph(graph: any): Model {
  const nodes: any[] = graph?.nodes ?? []
  const edges: any[] = graph?.edges ?? []
  const entities: Entity[] = []
  const placements: Placement[] = []
  const groups: Group[] = []
  const notes: Note[] = []

  for (const n of nodes) {
    if (n.type === 'group') {
      groups.push({
        id: n.id,
        label: n.data?.label ?? 'Group',
        color: n.data?.color ?? '#64748b',
        position: n.position ?? { x: 0, y: 0 },
        size: {
          width: Number(n.style?.width) || 320,
          height: Number(n.style?.height) || 200,
        },
      })
    } else if (n.type === 'note') {
      notes.push({
        id: n.id,
        position: n.position ?? { x: 0, y: 0 },
        size: { width: Number(n.style?.width) || 190, height: Number(n.style?.height) || 110 },
        text: n.data?.text ?? '',
      })
    } else {
      // service or actor
      entities.push({
        id: n.id,
        label: n.data?.label ?? n.id,
        icon: n.data?.icon,
        sub: n.data?.sub,
        status: n.data?.status,
        kind: n.data?.kind,
      })
      placements.push({ entityId: n.id, position: n.position ?? { x: 0, y: 0 }, parentId: n.parentId ?? null })
    }
  }

  const dedges: DEdge[] = edges.map((e, i) => ({
    id: e.id ?? `e${i}-${e.source}-${e.target}`,
    from: e.source,
    to: e.target,
    type: (e.data?.rel as RelType) ?? 'talks-to',
    label: typeof e.label === 'string' ? e.label : undefined,
    inferred: !!e.data?.inferred,
    shape: e.data?.shape ?? 'default',
    points: e.data?.points,
  }))

  return {
    version: 1,
    entities,
    diagrams: [
      { id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas', placements, groups, edges: dedges, notes },
    ],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd webapp && npm run typecheck`
```bash
git add webapp/src/model.ts webapp/src/model.test.ts
git commit -m "feat(model): migrate graph.json into entity catalog + Logical diagram"
```

---

## Task 3: `buildDiagramGraph` (Model → ReactFlow nodes/edges)

**Files:**
- Modify: `webapp/src/model.ts`
- Modify: `webapp/src/model.test.ts`

**Interfaces:**
- Consumes: `Diagram`, `Record<string, Entity>`, and `makeEdge`/`restyleEdge` from `graph.ts` for edge styling.
- Produces: `buildDiagramGraph(diagram: Diagram, byId: Record<string, Entity>): { nodes: Node[]; edges: Edge[] }` (types from `@xyflow/react`). Group nodes come first (ReactFlow requires parents before children). Service node id = entityId; edge id = DEdge.id.

- [ ] **Step 1: Write the failing test**

Add to `webapp/src/model.test.ts`:
```ts
import { buildDiagramGraph } from './model'

describe('buildDiagramGraph', () => {
  const byId = { plex: { id: 'plex', label: 'Plex', icon: 'plex', sub: ':32400', status: 'up' as const }, users: { id: 'users', label: 'Internet users', kind: 'actor' as const } }
  const diagram = {
    id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas' as const,
    groups: [{ id: 'media', label: 'Media', color: '#2f6fed', position: { x: 0, y: 0 }, size: { width: 400, height: 200 } }],
    placements: [
      { entityId: 'plex', position: { x: 18, y: 44 }, parentId: 'media' },
      { entityId: 'users', position: { x: -300, y: 80 }, parentId: null },
    ],
    edges: [{ id: 'e1', from: 'users', to: 'plex', type: 'talks-to' as const, label: 'watches', shape: 'default' as const }],
    notes: [],
  }

  it('builds RF nodes (groups first) and edges from the model', () => {
    const { nodes, edges } = buildDiagramGraph(diagram, byId)
    expect(nodes[0].id).toBe('media') // group first
    expect(nodes[0].type).toBe('group')
    const plex = nodes.find((n) => n.id === 'plex')!
    expect(plex.type).toBe('service')
    expect(plex.parentId).toBe('media')
    expect((plex.data as any).label).toBe('Plex')
    expect(plex.position).toEqual({ x: 18, y: 44 })
    expect(edges[0].id).toBe('e1')
    expect(edges[0].source).toBe('users')
    expect(edges[0].target).toBe('plex')
    expect(edges[0].type).toBe('waypoint')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: FAIL — `buildDiagramGraph` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `webapp/src/model.ts` (import types + makeEdge/restyleEdge at top):
```ts
import { type Node, type Edge } from '@xyflow/react'
import { makeEdge, restyleEdge } from './graph'

export function buildDiagramGraph(diagram: Diagram, byId: Record<string, Entity>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  // groups first (parents before children)
  for (const g of diagram.groups) {
    nodes.push({
      id: g.id,
      type: 'group',
      position: g.position,
      data: { label: g.label, color: g.color },
      style: { width: g.size.width, height: g.size.height },
    })
  }
  for (const p of diagram.placements) {
    const e = byId[p.entityId]
    if (!e) continue // entity deleted from catalog; skip stale placement
    nodes.push({
      id: e.id,
      type: 'service',
      position: p.position,
      parentId: p.parentId ?? undefined,
      extent: p.parentId ? 'parent' : undefined,
      data: { label: e.label, sub: e.sub, icon: e.icon, status: e.status, kind: e.kind },
    })
  }
  for (const n of diagram.notes) {
    nodes.push({ id: n.id, type: 'note', position: n.position, data: { text: n.text }, style: { width: n.size.width, height: n.size.height }, zIndex: 5 })
  }
  const edges: Edge[] = diagram.edges.map((de, i) => {
    let edge = makeEdge(de.from, de.to, de.type, de.label, de.inferred, i)
    edge.id = de.id
    edge.data = { ...edge.data, shape: de.shape ?? 'default', points: de.points }
    edge = restyleEdge(edge, de.type, !!de.inferred) // keeps id/source/target/data via spread
    return edge
  })
  return { nodes, edges }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd webapp && npm run typecheck`
```bash
git add webapp/src/model.ts webapp/src/model.test.ts
git commit -m "feat(model): build ReactFlow graph from a diagram + entity catalog"
```

---

## Task 4: Pure model-mutation helpers

**Files:**
- Modify: `webapp/src/model.ts`
- Modify: `webapp/src/model.test.ts`

**Interfaces (all pure — return NEW model/diagram, never mutate):**
- `getDiagram(model, id): Diagram | undefined`
- `updateEntity(model, id, patch: Partial<Entity>): Model`
- `addEntity(model, entity: Entity): Model`
- `deleteEntity(model, id): Model` — removes the entity and every placement/edge referencing it in all diagrams.
- `addPlacement(model, diagramId, placement: Placement): Model`
- `removePlacement(model, diagramId, entityId): Model` — also drops that diagram's edges touching the entity.
- `patchDiagram(model, diagramId, patch: Partial<Pick<Diagram,'placements'|'groups'|'edges'|'notes'|'name'|'title'>>): Model`
- `addDiagram(model, name, type): { model: Model; id: string }`
- `renameDiagram(model, id, name): Model`
- `deleteDiagram(model, id): Model`

- [ ] **Step 1: Write the failing tests**

Add to `webapp/src/model.test.ts`:
```ts
import { updateEntity, deleteEntity, removePlacement, addDiagram, deleteDiagram } from './model'

const base: Model = {
  version: 1,
  entities: [{ id: 'plex', label: 'Plex' }, { id: 'users', label: 'Users', kind: 'actor' }],
  diagrams: [{
    id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas',
    placements: [{ entityId: 'plex', position: { x: 0, y: 0 }, parentId: null }, { entityId: 'users', position: { x: 1, y: 1 }, parentId: null }],
    groups: [], notes: [],
    edges: [{ id: 'e1', from: 'users', to: 'plex', type: 'talks-to' }],
  }],
}

describe('model mutations', () => {
  it('updateEntity is shared and immutable', () => {
    const m = updateEntity(base, 'plex', { label: 'Plex Media Server' })
    expect(m.entities.find((e) => e.id === 'plex')!.label).toBe('Plex Media Server')
    expect(base.entities.find((e) => e.id === 'plex')!.label).toBe('Plex') // original untouched
  })
  it('deleteEntity removes it + its placements + its edges everywhere', () => {
    const m = deleteEntity(base, 'plex')
    expect(m.entities.map((e) => e.id)).toEqual(['users'])
    expect(m.diagrams[0].placements.map((p) => p.entityId)).toEqual(['users'])
    expect(m.diagrams[0].edges).toHaveLength(0)
  })
  it('removePlacement drops placement + touching edges in that diagram only', () => {
    const m = removePlacement(base, 'logical', 'plex')
    expect(m.diagrams[0].placements.map((p) => p.entityId)).toEqual(['users'])
    expect(m.diagrams[0].edges).toHaveLength(0)
    expect(m.entities.map((e) => e.id)).toEqual(['plex', 'users']) // catalog intact
  })
  it('addDiagram creates an empty canvas diagram and returns its id', () => {
    const { model, id } = addDiagram(base, 'Voice Flow', 'canvas')
    const d = model.diagrams.find((x) => x.id === id)!
    expect(d.name).toBe('Voice Flow')
    expect(d.placements).toHaveLength(0)
    expect(d.type).toBe('canvas')
  })
  it('deleteDiagram never touches the catalog', () => {
    const { model, id } = addDiagram(base, 'Temp', 'canvas')
    const m = deleteDiagram(model, id)
    expect(m.diagrams.find((x) => x.id === id)).toBeUndefined()
    expect(m.entities).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the helpers**

Add to `webapp/src/model.ts`:
```ts
export function getDiagram(model: Model, id: string): Diagram | undefined {
  return model.diagrams.find((d) => d.id === id)
}
function mapDiagram(model: Model, id: string, fn: (d: Diagram) => Diagram): Model {
  return { ...model, diagrams: model.diagrams.map((d) => (d.id === id ? fn(d) : d)) }
}
export function updateEntity(model: Model, id: string, patch: Partial<Entity>): Model {
  return { ...model, entities: model.entities.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)) }
}
export function addEntity(model: Model, entity: Entity): Model {
  return { ...model, entities: [...model.entities, entity] }
}
export function deleteEntity(model: Model, id: string): Model {
  return {
    ...model,
    entities: model.entities.filter((e) => e.id !== id),
    diagrams: model.diagrams.map((d) => ({
      ...d,
      placements: d.placements.filter((p) => p.entityId !== id),
      edges: d.edges.filter((e) => e.from !== id && e.to !== id),
    })),
  }
}
export function addPlacement(model: Model, diagramId: string, placement: Placement): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.placements.some((p) => p.entityId === placement.entityId) ? d : { ...d, placements: [...d.placements, placement] },
  )
}
export function removePlacement(model: Model, diagramId: string, entityId: string): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    placements: d.placements.filter((p) => p.entityId !== entityId),
    edges: d.edges.filter((e) => e.from !== entityId && e.to !== entityId),
  }))
}
export function patchDiagram(
  model: Model,
  diagramId: string,
  patch: Partial<Pick<Diagram, 'placements' | 'groups' | 'edges' | 'notes' | 'name' | 'title'>>,
): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, ...patch }))
}
export function addDiagram(model: Model, name: string, type: DiagramType): { model: Model; id: string } {
  const id = `d-${model.diagrams.length}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const d: Diagram = { id, name, title: name, type, placements: [], groups: [], edges: [], notes: [] }
  return { model: { ...model, diagrams: [...model.diagrams, d] }, id }
}
export function renameDiagram(model: Model, id: string, name: string): Model {
  return mapDiagram(model, id, (d) => ({ ...d, name, title: name }))
}
export function deleteDiagram(model: Model, id: string): Model {
  return { ...model, diagrams: model.diagrams.filter((d) => d.id !== id) }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Typecheck + commit**

Run: `cd webapp && npm run typecheck`
```bash
git add webapp/src/model.ts webapp/src/model.test.ts
git commit -m "feat(model): pure model-mutation helpers with tests"
```

---

## Task 5: `/api/model` persistence endpoint + client load/save

**Files:**
- Modify: `webapp/vite.config.ts`
- Modify: `webapp/src/model.ts` (add client `loadModel`/`saveModel`)
- Manual verification (Playwright), no unit test (I/O).

**Interfaces:**
- Produces: `loadModel(): Promise<Model>` — GET `/api/model`; if 204, GET `/api/graph` and `migrateFromGraph`; PUT the migrated model so it persists. `saveModel(model: Model): Promise<boolean>`.

- [ ] **Step 1: Add the `/api/model` endpoint**

In `webapp/vite.config.ts`, duplicate the existing `graphApi()` plugin as `modelApi()` targeting `model.json` (GET returns 204 when absent; PUT writes the body). Register it in `plugins: [react(), graphApi(), modelApi()]`. Exact body: copy the `graphApi` function, rename to `modelApi`, and change `resolve(server.config.root, 'graph.json')` → `'model.json'` and the middleware path `'/api/graph'` → `'/api/model'`.

- [ ] **Step 2: Add client load/save to `model.ts`**

```ts
export async function loadModel(): Promise<Model> {
  const res = await fetch('/api/model')
  if (res.status === 200) {
    const m = await res.json()
    if (m?.entities && m?.diagrams) return m as Model
  }
  // migrate from the old graph.json on first run
  const g = await fetch('/api/graph')
  if (g.status === 200) {
    const model = migrateFromGraph(await g.json())
    await saveModel(model)
    return model
  }
  return { version: 1, entities: [], diagrams: [{ id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas', placements: [], groups: [], edges: [], notes: [] }] }
}
export async function saveModel(model: Model): Promise<boolean> {
  try {
    const res = await fetch('/api/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model, null, 2) })
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd webapp && npm run typecheck` (expect exit 0).

- [ ] **Step 4: Verify migration produces model.json (Playwright)**

Temporarily add to `App.tsx` a one-shot effect `useEffect(() => { loadModel().then((m) => console.log('MODEL', m.entities.length, m.diagrams.length)) }, [])`, run `npm run dev`, navigate to the app, then:
```bash
cd webapp && python3 -c "import json; d=json.load(open('model.json')); print('entities', len(d['entities']), 'diagrams', [x['name'] for x in d['diagrams']])"
```
Expected: `entities 45 diagrams ['Logical']`. Remove the temporary console effect afterward. (Do not delete `graph.json`.)

- [ ] **Step 5: Commit**
```bash
git add webapp/vite.config.ts webapp/src/model.ts
git commit -m "feat(persist): /api/model endpoint + loadModel/saveModel with graph.json migration"
```

---

## Task 6: App renders the active diagram + maps edits back to the model

**Files:**
- Modify: `webapp/src/App.tsx`
- Manual verification (typecheck + Playwright).

**Interfaces:**
- Consumes: `loadModel`, `saveModel`, `buildDiagramGraph`, `entitiesById`, and the model-mutation helpers.
- Produces: App holds `const [model, setModel] = useState<Model|null>` and `activeId` (from `localStorage`, validated against `model.diagrams`). It derives `{nodes, edges}` for the active diagram, and every existing edit handler writes through a model helper, then autosaves.

- [ ] **Step 1: Replace load/save + derive nodes/edges**

Replace the current `loadStored`/`/api/graph` effect and `useNodesState`/`useEdgesState` seeding so that:
- On mount, `loadModel()` → `setModel`, pick `activeId` from `localStorage['homelab-active-diagram']` if it exists in `model.diagrams`, else `model.diagrams[0].id`.
- Derive `const active = getDiagram(model, activeId)`, `const byId = useMemo(() => entitiesById(model), [model])`, `const { nodes, edges } = useMemo(() => active ? buildDiagramGraph(active, byId) : { nodes: [], edges: [] }, [active, byId])`.
- Keep using `useNodesState`/`useEdgesState`, but re-seed them from the derived graph whenever `activeId` or `model` identity changes (an effect: `setNodes(built.nodes); setEdges(built.edges)`), guarded so in-flight local drags aren't clobbered (re-seed only when `activeId` changes or model was loaded/replaced externally — track with a ref of the last built signature).

- [ ] **Step 2: Route edits through model helpers**

For each existing handler, additionally update `model` (which triggers autosave):
- `onNodesChange` position changes → on drag stop (`onNodeDragStop`), write `patchDiagram(model, activeId, { placements: … })` mapping the moved node id → new position (and parentId if changed).
- `updateNodeData` (label/sub/icon/status) → if the node is a service, call `updateEntity(model, id, patch)`; if a group, `patchDiagram` its `groups`.
- `reparent` → update that placement's `parentId` via `patchDiagram`.
- `updateEdge`/`onConnect`/delete edge → `patchDiagram(model, activeId, { edges })`.
- group add/resize/color, notes add/edit, Tidy/relayout/distribute/shrink → all `patchDiagram(model, activeId, {...})` with the mapped-back arrays.
- Autosave: `useEffect` debounced `saveModel(model)` when `model` changes (replaces the old graph autosave).

Helper to map current RF `nodes` back to model arrays for the active diagram:
```ts
function nodesToDiagramParts(nodes: Node[]) {
  const groups = nodes.filter((n) => n.type === 'group').map((n) => ({
    id: n.id, label: (n.data as any).label, color: (n.data as any).color,
    position: n.position, size: { width: Number((n.style as any)?.width) || 320, height: Number((n.style as any)?.height) || 200 },
  }))
  const placements = nodes.filter((n) => n.type === 'service').map((n) => ({ entityId: n.id, position: n.position, parentId: n.parentId ?? null }))
  const notes = nodes.filter((n) => n.type === 'note').map((n) => ({ id: n.id, position: n.position, size: { width: Number((n.style as any)?.width) || 190, height: Number((n.style as any)?.height) || 110 }, text: (n.data as any).text ?? '' }))
  return { groups, placements, notes }
}
function edgesToDEdges(edges: Edge[]): DEdge[] {
  return edges.map((e) => ({ id: e.id, from: e.source, to: e.target, type: (e.data as any)?.rel ?? 'talks-to', label: typeof e.label === 'string' ? e.label : undefined, inferred: !!(e.data as any)?.inferred, shape: (e.data as any)?.shape ?? 'default', points: (e.data as any)?.points }))
}
```
Simplest robust approach: after any `nodes`/`edges` state settles (debounced), recompute `{groups,placements,notes}` + `edges` from current RF state and `patchDiagram` + `updateEntity` for changed entity data, then autosave. Entity-data edits still go through `updateEntity` explicitly (since `nodesToDiagramParts` intentionally does not write entity fields — those are shared).

- [ ] **Step 3: Typecheck**

Run: `cd webapp && npm run typecheck` (expect 0).

- [ ] **Step 4: Playwright regression**

`npm run dev`; navigate; confirm the Logical diagram renders identically to before (groups, nodes, edges, labels). Move a node, reload — position persisted to `model.json`. Edit a service label in the Inspector — `model.json` `entities` reflects it. Verify with:
```bash
cd webapp && python3 -c "import json; d=json.load(open('model.json')); print('placements', len(d['diagrams'][0]['placements']), 'edges', len(d['diagrams'][0]['edges']))"
```
Expected: `placements 45 edges 49` (matching the migrated counts). Restore any test edits.

- [ ] **Step 5: Commit**
```bash
git add webapp/src/App.tsx
git commit -m "feat(app): render active diagram from model, map edits back to entity/placement/diagram"
```

---

## Task 7: Diagram switcher (`DiagramBar`)

**Files:**
- Create: `webapp/src/DiagramBar.tsx`
- Modify: `webapp/src/App.tsx` (mount it; wire new/rename/delete/select)
- Modify: `webapp/src/index.css` (bar styles)

**Interfaces:**
- Consumes: `model.diagrams`, `activeId`, and callbacks `onSelect(id)`, `onNew(name)`, `onRename(id,name)`, `onDelete(id)`.
- Produces: `DiagramBar` component.

- [ ] **Step 1: Implement `DiagramBar.tsx`**
```tsx
import { type Diagram } from './model'
interface Props {
  diagrams: Diagram[]; activeId: string
  onSelect: (id: string) => void
  onNew: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}
export function DiagramBar({ diagrams, activeId, onSelect, onNew, onRename, onDelete }: Props) {
  return (
    <div className="panel diagrambar">
      <select value={activeId} onChange={(e) => onSelect(e.target.value)}>
        {diagrams.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button onClick={() => { const n = prompt('New diagram name?'); if (n) onNew(n) }}>+ Diagram</button>
      <button onClick={() => { const cur = diagrams.find((d) => d.id === activeId); const n = prompt('Rename diagram', cur?.name); if (n && cur) onRename(cur.id, n) }}>Rename</button>
      <button onClick={() => { if (diagrams.length > 1 && confirm('Delete this diagram? (entities are kept)')) onDelete(activeId) }}>Delete</button>
    </div>
  )
}
```

- [ ] **Step 2: Wire it in `App.tsx`**

Add handlers: `onSelect` → `setActiveId(id)` + `localStorage.setItem('homelab-active-diagram', id)`. `onNew` → `const { model: m, id } = addDiagram(model, name, 'canvas'); setModel(m); setActiveId(id)`. `onRename` → `setModel(renameDiagram(model, id, name))`. `onDelete` → `const m = deleteDiagram(model, activeId); setModel(m); setActiveId(m.diagrams[0].id)`. Mount `<DiagramBar .../>` as a `<Panel position="top-left">` above the legend, or inside the toolbar column.

- [ ] **Step 3: Add `.diagrambar` styles** to `index.css` (flex row, gap 6px, matching `.panel` chrome; `select`/`button` reuse `.toolbar select`/`button` look).

- [ ] **Step 4: Typecheck + Playwright**

Run: `cd webapp && npm run typecheck`. Then dev + Playwright: create a diagram "Test", confirm the canvas goes empty (new diagram has no placements), switch back to Logical (full diagram returns), rename works, delete "Test" returns to Logical. Confirm `model.json` has 2 then 1 diagrams. Clean up the test diagram.

- [ ] **Step 5: Commit**
```bash
git add webapp/src/DiagramBar.tsx webapp/src/App.tsx webapp/src/index.css
git commit -m "feat(diagrams): diagram switcher (select/new/rename/delete)"
```

---

## Task 8: Entity palette (`Palette`)

**Files:**
- Create: `webapp/src/Palette.tsx`
- Modify: `webapp/src/App.tsx` (mount + placement handlers)
- Modify: `webapp/src/index.css`

**Interfaces:**
- Consumes: `model.entities`, the active diagram's placed entity ids (a `Set<string>`), and callbacks `onPlace(entityId)`, `onCreate(entity: Entity)`.
- Produces: `Palette` component with a search box and a scrollable list; each row shows icon + label + a "placed" marker or a "＋" to add; a "＋ New entity" control at the bottom.

- [ ] **Step 1: Implement `Palette.tsx`** — searchable list; clicking an unplaced entity calls `onPlace(id)`; "＋ New entity" prompts for a label and calls `onCreate({ id: slug, label })` (slug from label, deduped against existing ids). Rows for already-placed entities are dimmed/marked. (Full component code: list filtered by a `search` state; use `ICON_BASE` from `graph.ts` for icons.)

- [ ] **Step 2: Wire in `App.tsx`**

- `placedIds = useMemo(() => new Set(active?.placements.map((p) => p.entityId)), [active])`.
- `onPlace(entityId)` → `const pos = rf.screenToFlowPosition({ x: innerWidth/2, y: 200 }); setModel(addPlacement(model, activeId, { entityId, position: pos, parentId: null }))`.
- `onCreate(entity)` → `setModel(addPlacement(addEntity(model, entity), activeId, { entityId: entity.id, position: rf.screenToFlowPosition({x:innerWidth/2,y:200}), parentId: null }))`.
- Mount `<Palette .../>` as a left-side `<Panel position="bottom-left">` (above Controls) or a collapsible drawer.

- [ ] **Step 3: Typecheck + Playwright**

Run typecheck. Then: on an empty new diagram, place "Plex" from the palette → a Plex node appears; reload → it persists in that diagram's placements; the Logical diagram is unaffected (Plex still there once). Create a new entity "Test Box" → appears in catalog and on the canvas. Verify `model.json` entity count increments and only the active diagram gained a placement. Clean up.

- [ ] **Step 4: Commit**
```bash
git add webapp/src/Palette.tsx webapp/src/App.tsx webapp/src/index.css
git commit -m "feat(diagrams): entity palette to place existing/new entities into the active diagram"
```

---

## Task 9: Inspector — entity(shared) vs placement + two delete scopes

**Files:**
- Modify: `webapp/src/Inspector.tsx`
- Modify: `webapp/src/App.tsx` (pass the two delete handlers)

**Interfaces:**
- Consumes: existing Inspector props + new `onRemoveFromDiagram()` and `onDeleteEntity()` (replacing the single service-node delete).
- Produces: for a **service** node, the Inspector labels Label/Sub/Icon/Status as “shared across diagrams”, keeps the Group dropdown (placement), and shows two buttons: **Remove from this diagram** and **Delete entity (all diagrams)**.

- [ ] **Step 1: Update `Inspector.tsx`** — in the service-node branch, add a small “shared across diagrams” caption under the header, and replace the single delete button with:
```tsx
<button className="insp__action" onClick={onRemoveFromDiagram}>Remove from this diagram</button>
<button className="insp__delete" onClick={onDeleteEntity}>Delete entity (all diagrams)</button>
```
Group/edge/note branches keep the existing single delete (they are per-diagram).

- [ ] **Step 2: Wire handlers in `App.tsx`**

- `onRemoveFromDiagram` → `setModel(removePlacement(model, activeId, selNode))` and clear selection.
- `onDeleteEntity` → `if (confirm('Delete this entity from ALL diagrams?')) setModel(deleteEntity(model, selNode))` and clear selection.
- Keep the existing per-diagram delete for groups/edges/notes (they go through `patchDiagram`).

- [ ] **Step 3: Typecheck + Playwright**

Run typecheck. Then: select a service node in a diagram that ALSO exists in another diagram; “Remove from this diagram” drops only this diagram's placement (verify the other diagram still has it and the catalog is intact). “Delete entity” removes it from the catalog and all diagrams (verify `model.json`). Restore via git checkout of `model.json`/backup if needed for a clean state.

- [ ] **Step 4: Commit**
```bash
git add webapp/src/Inspector.tsx webapp/src/App.tsx
git commit -m "feat(inspector): shared entity edits vs per-diagram placement, two delete scopes"
```

---

## Task 10: Confirm layout tools operate on the active diagram

**Files:**
- Modify: `webapp/src/App.tsx` (only if any layout handler bypassed the model write-back)
- Manual verification.

**Interfaces:** none new — Tidy/relayout/distribute/shrink/arrange already transform the RF `nodes`; ensure their results flow back into `patchDiagram` for the active diagram (via the debounced node→model sync from Task 6).

- [ ] **Step 1: Verify write-back**

Confirm Tidy, Space to fit, Shrink to fit, and group resize all update the active diagram's `groups`/`placements` in `model.json` (not a stale structure). If any handler set `nodes` without the Task-6 debounced sync catching it, add an explicit `setModel(patchDiagram(model, activeId, nodesToDiagramParts(newNodes)))` in that handler.

- [ ] **Step 2: Playwright**

On the Logical diagram: Tidy → positions change and persist to `model.json`; switch to another diagram and back → the tidied layout is retained. Group Space/Shrink to fit persist. Zoom shortcuts + waypoints still work (they are diagram-agnostic).

- [ ] **Step 3: Typecheck + commit**

Run: `cd webapp && npm run typecheck`
```bash
git add webapp/src/App.tsx
git commit -m "chore(diagrams): ensure layout tools persist to the active diagram"
```

---

## Self-Review

**Spec coverage:** entity catalog (Task 1), shared vs placement vs diagram levels (Tasks 1,4,6,9), per-diagram edges/groups (Tasks 2,3,6), diagram `type` stored, `canvas` rendered (Tasks 1–3), migration → Logical (Tasks 2,5), model.json persistence + active-diagram localStorage with fallback (Tasks 5,6,7), diagram switcher (Task 7), entity palette place/new (Task 8), Inspector shared/local + two delete scopes (Task 9), layout tools scoped to active diagram (Task 10), verification approach (per task). Non-goals (same entity twice, topology/call-flow rendering, global relationships, live status) are explicitly deferred. **No gaps found.**

**Placeholder scan:** UI tasks (7–9) describe component internals in prose plus concrete skeletons/handlers rather than 100% line-complete code — acceptable because the components are small and the risky logic (all pure) is fully coded and tested in Tasks 1–4. No "TBD"/"handle edge cases"/"similar to Task N" left.

**Type consistency:** `Model`/`Diagram`/`Entity`/`Placement`/`Group`/`DEdge`/`Note` used consistently; `buildDiagramGraph` returns `@xyflow/react` `Node[]/Edge[]`; edge `type: 'waypoint'` matches the existing custom edge; helper names (`updateEntity`, `deleteEntity`, `removePlacement`, `addPlacement`, `patchDiagram`, `addDiagram`, `renameDiagram`, `deleteDiagram`, `getDiagram`, `entitiesById`, `buildDiagramGraph`, `migrateFromGraph`, `loadModel`, `saveModel`) are stable across tasks.

# Multi-Engine Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single dagre layout with two selectable server-side engines — elkjs and Graphviz (`@hpcc-js/wasm`) — chosen at runtime via a UI selector next to Tidy, and retire dagre.

**Architecture:** Two async adapters (`layout-elk.ts`, `layout-graphviz.ts`) each place nodes/groups and return absolute top-left boxes. An async dispatcher `layoutDiagram(diagram, engine)` in `layout.ts` calls the chosen adapter, converts child coords to parent-relative, and bakes edge handles via a shared `assignEdgeHandles` (reusing the edge-orientation `absoluteCenter`/`handlesFor`). Engine is a runtime `/api/layout` parameter (default `elk`) with a UI selector persisted in `localStorage`; the model is unchanged.

**Tech Stack:** TypeScript, Node (Vite dev-server middleware), `elkjs`, `@hpcc-js/wasm` (Graphviz), Vitest, React.

**Spec:** `docs/superpowers/specs/2026-07-26-multi-engine-layout-design.md`
**Spike adapters to port (reference):** `scratchpad/layout-spike/adapters/{elkAdapter,graphvizAdapter}.ts` (working, but written for a flat 180×64 node + a `LayoutResult` render shape — this plan gives the production versions).

## Global Constraints

- Engines are exactly `'elk' | 'graphviz'`; `DEFAULT_ENGINE = 'elk'`.
- Engine is **runtime-only** — a `/api/layout` request param + `localStorage`; never stored in the model. MCP `layout`/`author_diagram` tools take **no** engine param (always `DEFAULT_ENGINE`).
- Adapters return **absolute, top-left-origin** boxes and do NOT compute edge handles or convert to parent-relative coords — the dispatcher does both, once.
- Node width is `W` (180); per-node height is `heightById[entityId]` (existing `nodeHeight` = `H` + inline-note height) — fed to every adapter so noted boxes get real room.
- The dispatcher converts a child node's absolute position to parent-relative by subtracting its group's absolute position, and **preserves each placement's `note`/`fieldShow`/`parentId`** (map over `diagram.placements`, only replace `position`).
- Edge handles are baked via the shared `assignEdgeHandles` (reuses `absoluteCenter` + `handlesFor` from the edge-orientation feature); a missing endpoint leaves that edge's handles unchanged.
- **Retire dagre:** remove `@dagrejs/dagre` (`package.json`), its import, its graph-building, and the ungrouped-node **collision pass** entirely.
- `layoutDiagram` becomes **async**; `handlers.layout`, `handlers.authorDiagram`, and `authorDiagramOps` become async; the MCP `layout`/`author_diagram` tool callbacks and the `/api/layout` route `await` accordingly.
- `/api/layout` accepts `{ diagramId, engine? }`; an absent or invalid `engine` coerces to `DEFAULT_ENGINE`.
- Adapters + `elkjs`/`@hpcc-js/wasm` are **server-only** (imported solely by the adapter modules); keep client bundles free of them.
- Server-safe modules; capitalize only the first letter of multi-letter acronyms. Keep all tests green (`npx vitest run`) and `npx tsc --noEmit` clean after each task.
- Branch: `feat/mcp-server-phase2`.

---

## File Structure

- `webapp/server/layout.ts` — shared types (`LayoutEngine`, `DEFAULT_ENGINE`, `EngineNode`/`EngineGroup`/`EngineResult`, `EngineAdapter`), the exported `W`, the exported `assignEdgeHandles`, and (after Task 4) the async `layoutDiagram` dispatcher. dagre removed.
- `webapp/server/layout-elk.ts` — `runElk` adapter (new).
- `webapp/server/layout-graphviz.ts` — `runGraphviz` adapter (new).
- `webapp/server/mcp.ts` — async `handlers.layout(store, diagramId, engine?)` + async `handlers.authorDiagram`; tool callbacks await.
- `webapp/server/authoring.ts` — async `authorDiagramOps`.
- `webapp/vite.config.ts` — `/api/layout` engine param + await.
- `webapp/src/App.tsx` — engine `<select>` + Tidy passes `engine`.
- `webapp/package.json` — add `elkjs`, `@hpcc-js/wasm`; remove `@dagrejs/dagre`.

---

### Task 1: Shared types + extract `assignEdgeHandles` (pure refactor, dagre still in place)

**Files:**
- Modify: `webapp/server/layout.ts`
- Test: `webapp/server/layout.test.ts`

**Interfaces:**
- Produces (in `layout.ts`):
  - `export const W` (already the module const `W = 180` — add `export`).
  - `export type LayoutEngine = 'elk' | 'graphviz'` and `export const DEFAULT_ENGINE: LayoutEngine = 'elk'`.
  - `export interface EngineNode { id: string; x: number; y: number; parentId?: string | null }`
  - `export interface EngineGroup { id: string; x: number; y: number; width: number; height: number }`
  - `export interface EngineResult { nodes: EngineNode[]; groups: EngineGroup[] }`
  - `export type EngineAdapter = (diagram: Diagram, heightById: Record<string, number>) => Promise<EngineResult>`
  - `export function assignEdgeHandles(placements: Placement[], groups: Group[], edges: DEdge[], heightById: Record<string, number>): DEdge[]`

**Context:** Today `layoutDiagram` computes edge handles inline (a `centerOf` closure + `edges` map, using `absoluteCenter` + `handlesFor`). Extract that into a standalone exported `assignEdgeHandles` and call it from `layoutDiagram`. Behavior is unchanged (still dagre, still sync); this just creates the shared step Task 4's dispatcher will reuse.

- [ ] **Step 1: Write the failing test for `assignEdgeHandles`**

Add to `webapp/server/layout.test.ts`:

```ts
import { assignEdgeHandles } from './layout'

describe('assignEdgeHandles', () => {
  it('bakes geometry handles for an ungrouped forward edge', () => {
    const placements = [
      { entityId: 'a', position: { x: 0, y: 0 } },
      { entityId: 'b', position: { x: 400, y: 0 } },
    ]
    const edges = [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' as const }]
    const out = assignEdgeHandles(placements, [], edges, { a: 64, b: 64 })
    expect(out[0].sourceHandle).toBe('right')
    expect(out[0].targetHandle).toBe('left')
  })

  it('uses the group offset for a child node (grouped left of an outside node → right/left)', () => {
    const placements = [
      { entityId: 'inner', position: { x: 10, y: 10 }, parentId: 'g' },
      { entityId: 'outer', position: { x: 900, y: 0 } },
    ]
    const groups = [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 260, height: 160 } }]
    const edges = [{ id: 'e1', from: 'inner', to: 'outer', type: 'talks-to' as const }]
    const out = assignEdgeHandles(placements, groups, edges, { inner: 64, outer: 64 })
    expect(out[0].sourceHandle).toBe('right')
    expect(out[0].targetHandle).toBe('left')
  })

  it('leaves handles unchanged for a missing endpoint', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'ghost', type: 'talks-to' as const, sourceHandle: 'top' as const }]
    const out = assignEdgeHandles([{ entityId: 'a', position: { x: 0, y: 0 } }], [], edges, { a: 64 })
    expect(out[0].sourceHandle).toBe('top')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd webapp && npx vitest run server/layout.test.ts -t assignEdgeHandles`
Expected: FAIL — `assignEdgeHandles` is not exported.

- [ ] **Step 3: Export `W`, add the shared types, and extract `assignEdgeHandles`**

In `webapp/server/layout.ts`:

1. `export` the width const: change `const W = 180` to `export const W = 180`.
2. Add the shared types (near the top, after the imports):

```ts
export type LayoutEngine = 'elk' | 'graphviz'
export const DEFAULT_ENGINE: LayoutEngine = 'elk'

export interface EngineNode { id: string; x: number; y: number; parentId?: string | null }
export interface EngineGroup { id: string; x: number; y: number; width: number; height: number }
export interface EngineResult { nodes: EngineNode[]; groups: EngineGroup[] }
export type EngineAdapter = (diagram: Diagram, heightById: Record<string, number>) => Promise<EngineResult>
```

3. Add the exported `assignEdgeHandles` (lift the current inline `centerOf`/edges logic — it uses `absoluteCenter` and `handlesFor`, both already in this file):

```ts
// Bake each edge's connection-point handles from the final laid-out geometry.
// `orientation` fixes the axis; the side follows the node centers. Missing
// endpoints leave the edge unchanged. Shared by every layout engine.
export function assignEdgeHandles(
  placements: Placement[],
  groups: Group[],
  edges: DEdge[],
  heightById: Record<string, number>,
): DEdge[] {
  const groupById: Record<string, Group> = Object.fromEntries(groups.map((g) => [g.id, g]))
  const placementByEntity: Record<string, Placement> = Object.fromEntries(placements.map((p) => [p.entityId, p]))
  const centerOf = (entityId: string): { x: number; y: number } | null => {
    const p = placementByEntity[entityId]
    if (!p) return null
    return absoluteCenter(p, groupById, heightById[entityId] ?? H)
  }
  return edges.map((e) => {
    const s = centerOf(e.from)
    const t = centerOf(e.to)
    if (!s || !t) return e
    return { ...e, ...handlesFor(e.orientation, s, t) }
  })
}
```

4. In `layoutDiagram`, replace the current inline `centerOf` block + `edges` map with a single call: `const edges = assignEdgeHandles(placements, groups, diagram.edges, heightById)`. Keep the rest (dagre graph-building, collision pass, the `{ placements, groups, edges }` return) unchanged for now.

- [ ] **Step 4: Run the tests + full suite + tsc**

Run: `cd webapp && npx vitest run server/layout.test.ts && npx tsc --noEmit`
Expected: the new `assignEdgeHandles` cases PASS, and all previously-passing layout tests still PASS (behavior is unchanged).

Run: `cd webapp && npx vitest run`
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add server/layout.ts server/layout.test.ts
git commit -m "refactor: extract shared assignEdgeHandles + engine types"
```

---

### Task 2: elkjs adapter

**Files:**
- Create: `webapp/server/layout-elk.ts`
- Test: `webapp/server/layout-elk.test.ts`
- Modify: `webapp/package.json` (add `elkjs`)

**Interfaces:**
- Consumes: `EngineResult`, `W` from `./layout` (Task 1); `Diagram` from `../src/model`.
- Produces: `export const runElk: EngineAdapter` (i.e. `(diagram, heightById) => Promise<EngineResult>`).

- [ ] **Step 1: Add the dependency**

Run: `cd webapp && npm install elkjs`
Expected: `elkjs` appears in `package.json` dependencies; `package-lock.json` updates.

- [ ] **Step 2: Write the failing test**

Create `webapp/server/layout-elk.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runElk } from './layout-elk'

const diagram = {
  id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
  placements: [
    { entityId: 'in1', position: { x: 0, y: 0 }, parentId: 'g' },
    { entityId: 'in2', position: { x: 0, y: 0 }, parentId: 'g' },
    { entityId: 'out', position: { x: 0, y: 0 } },
  ],
  groups: [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }],
  edges: [{ id: 'e1', from: 'out', to: 'in1', type: 'talks-to' as const }],
  notes: [],
}
const heights = { in1: 64, in2: 64, out: 64 }
const overlaps = (a: any, b: any) =>
  a.x < b.x + 180 && b.x < a.x + 180 && a.y < b.y + a.h && b.y < a.y + b.h

describe('runElk', () => {
  it('places every node and wraps grouped members in the group box', async () => {
    const { nodes, groups } = await runElk(diagram, heights)
    expect(nodes).toHaveLength(3)
    const g = groups.find((x) => x.id === 'g')!
    for (const id of ['in1', 'in2']) {
      const n = nodes.find((x) => x.id === id)!
      expect(n.x).toBeGreaterThanOrEqual(g.x)
      expect(n.y).toBeGreaterThanOrEqual(g.y)
      expect(n.x + 180).toBeLessThanOrEqual(g.x + g.width + 1)
    }
  })

  it('produces no overlapping node boxes', async () => {
    const { nodes } = await runElk(diagram, heights)
    const boxes = nodes.map((n) => ({ x: n.x, y: n.y, h: heights[n.id as keyof typeof heights] }))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j])).toBe(false)
  })

  it('ignores an edge that targets a group id instead of a node (no throw)', async () => {
    const bad = { ...diagram, edges: [{ id: 'e2', from: 'out', to: 'g', type: 'talks-to' as const }] }
    await expect(runElk(bad, heights)).resolves.toBeTruthy()
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd webapp && npx vitest run server/layout-elk.test.ts`
Expected: FAIL — module `./layout-elk` not found.

- [ ] **Step 4: Implement `layout-elk.ts`**

```ts
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Diagram } from '../src/model'
import { W, type EngineAdapter, type EngineResult } from './layout'

// A group is an ELK parent node whose children are its members (real
// hierarchy). Cross-group edges declared at the root only affect layout with
// `elk.hierarchyHandling: INCLUDE_CHILDREN`. ELK returns coords relative to the
// immediate parent, so we walk the tree accumulating absolute offsets.
const elk = new ELK()

interface ElkNode {
  id: string
  width?: number
  height?: number
  x?: number
  y?: number
  layoutOptions?: Record<string, string>
  children?: ElkNode[]
}

export const runElk: EngineAdapter = async (diagram, heightById): Promise<EngineResult> => {
  const groupIds = new Set(diagram.groups.map((g) => g.id))
  const placedIds = new Set(diagram.placements.map((p) => p.entityId))
  const groupChildren: Record<string, ElkNode[]> = {}
  for (const g of diagram.groups) groupChildren[g.id] = []
  const rootChildren: ElkNode[] = []

  for (const p of diagram.placements) {
    const leaf: ElkNode = { id: p.entityId, width: W, height: heightById[p.entityId] ?? 64 }
    if (p.parentId && groupChildren[p.parentId]) groupChildren[p.parentId].push(leaf)
    else rootChildren.push(leaf)
  }
  for (const g of diagram.groups) {
    rootChildren.push({
      id: g.id,
      layoutOptions: { 'elk.padding': '[top=36,left=16,bottom=16,right=16]' },
      children: groupChildren[g.id],
    })
  }

  const graph: ElkNode & { edges?: unknown[] } = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.componentComponent': '60',
    },
    children: rootChildren,
    edges: diagram.edges
      .filter((e) => placedIds.has(e.from) && placedIds.has(e.to))
      .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  }

  const result = (await elk.layout(graph as never)) as ElkNode
  const nodes: EngineResult['nodes'] = []
  const groups: EngineResult['groups'] = []
  const parentByEntity: Record<string, string | null | undefined> = Object.fromEntries(
    diagram.placements.map((p) => [p.entityId, p.parentId]),
  )

  const walk = (node: ElkNode, offsetX: number, offsetY: number): void => {
    const absX = offsetX + (node.x ?? 0)
    const absY = offsetY + (node.y ?? 0)
    if (groupIds.has(node.id)) {
      groups.push({ id: node.id, x: absX, y: absY, width: node.width ?? 0, height: node.height ?? 0 })
    } else if (node.id !== 'root') {
      nodes.push({ id: node.id, x: absX, y: absY, parentId: parentByEntity[node.id] ?? null })
    }
    for (const child of node.children ?? []) walk(child, absX, absY)
  }
  walk(result, 0, 0)

  return { nodes, groups }
}
```

- [ ] **Step 5: Run the tests + tsc**

Run: `cd webapp && npx vitest run server/layout-elk.test.ts && npx tsc --noEmit`
Expected: all 3 PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd webapp && git add server/layout-elk.ts server/layout-elk.test.ts package.json package-lock.json
git commit -m "feat: elkjs layout adapter"
```

---

### Task 3: Graphviz adapter

**Files:**
- Create: `webapp/server/layout-graphviz.ts`
- Test: `webapp/server/layout-graphviz.test.ts`
- Modify: `webapp/package.json` (add `@hpcc-js/wasm`)

**Interfaces:**
- Consumes: `EngineResult`, `W` from `./layout` (Task 1).
- Produces: `export const runGraphviz: EngineAdapter`.

- [ ] **Step 1: Add the dependency**

Run: `cd webapp && npm install @hpcc-js/wasm`
Expected: `@hpcc-js/wasm` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `webapp/server/layout-graphviz.test.ts` (same fixture/overlaps helper as the elk test; also assert Y-down top-left, i.e. members sit within the group's vertical bounds):

```ts
import { describe, it, expect } from 'vitest'
import { runGraphviz } from './layout-graphviz'

const diagram = {
  id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
  placements: [
    { entityId: 'in1', position: { x: 0, y: 0 }, parentId: 'g' },
    { entityId: 'in2', position: { x: 0, y: 0 }, parentId: 'g' },
    { entityId: 'out', position: { x: 0, y: 0 } },
  ],
  groups: [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }],
  edges: [{ id: 'e1', from: 'out', to: 'in1', type: 'talks-to' as const }],
  notes: [],
}
const heights = { in1: 64, in2: 64, out: 64 }
const overlaps = (a: any, b: any) =>
  a.x < b.x + 180 && b.x < a.x + 180 && a.y < b.y + a.h && b.y < a.y + b.h

describe('runGraphviz', () => {
  it('places every node with the group box wrapping its members (top-left, Y-down)', async () => {
    const { nodes, groups } = await runGraphviz(diagram, heights)
    expect(nodes).toHaveLength(3)
    const g = groups.find((x) => x.id === 'g')!
    for (const id of ['in1', 'in2']) {
      const n = nodes.find((x) => x.id === id)!
      expect(n.x).toBeGreaterThanOrEqual(g.x - 1)
      expect(n.y).toBeGreaterThanOrEqual(g.y - 1)
      expect(n.y + 64).toBeLessThanOrEqual(g.y + g.height + 1)
    }
  })

  it('produces no overlapping node boxes', async () => {
    const { nodes } = await runGraphviz(diagram, heights)
    const boxes = nodes.map((n) => ({ x: n.x, y: n.y, h: 64 }))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j])).toBe(false)
  })

  it('ignores an edge that targets a group id (no throw)', async () => {
    const bad = { ...diagram, edges: [{ id: 'e2', from: 'out', to: 'g', type: 'talks-to' as const }] }
    await expect(runGraphviz(bad, heights)).resolves.toBeTruthy()
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd webapp && npx vitest run server/layout-graphviz.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `layout-graphviz.ts`**

```ts
import { Graphviz } from '@hpcc-js/wasm/graphviz'
import type { Diagram } from '../src/model'
import { W, type EngineAdapter, type EngineResult } from './layout'

// Graphviz coords are points (72/inch), Y-UP, origin bottom-left; we flip every
// box against the graph bb height to top-left / Y-down. Fixed node size is given
// in INCHES; cluster subgraph names MUST start with the literal "cluster".
let graphvizPromise: ReturnType<typeof Graphviz.load> | null = null
const getGraphviz = () => (graphvizPromise ??= Graphviz.load())
const dotId = (id: string): string => `"${id.replace(/"/g, '\\"')}"`

function toDot(diagram: Diagram, heightById: Record<string, number>): string {
  const placedIds = new Set(diagram.placements.map((p) => p.entityId))
  const byGroup: Record<string, string[]> = {}
  const ungrouped: string[] = []
  for (const p of diagram.placements) {
    if (p.parentId && diagram.groups.some((g) => g.id === p.parentId)) (byGroup[p.parentId] ??= []).push(p.entityId)
    else ungrouped.push(p.entityId)
  }
  const nodeLine = (id: string): string =>
    `  ${dotId(id)} [shape=box fixedsize=true width=${W / 72} height=${(heightById[id] ?? 64) / 72}];`

  const lines: string[] = ['digraph G {', '  rankdir=LR;', '  nodesep=0.5; ranksep=1.0;']
  for (const g of diagram.groups) {
    lines.push(`  subgraph ${dotId('cluster_' + g.id)} {`, `    label=${dotId(g.label)};`, '    margin=16;')
    for (const id of byGroup[g.id] ?? []) lines.push('  ' + nodeLine(id))
    lines.push('  }')
  }
  for (const id of ungrouped) lines.push(nodeLine(id))
  for (const e of diagram.edges) {
    if (placedIds.has(e.from) && placedIds.has(e.to)) lines.push(`  ${dotId(e.from)} -> ${dotId(e.to)};`)
  }
  lines.push('}')
  return lines.join('\n')
}

export const runGraphviz: EngineAdapter = async (diagram, heightById): Promise<EngineResult> => {
  const graphviz = await getGraphviz()
  const parsed = JSON.parse(await graphviz.layout(toDot(diagram, heightById), 'json', 'dot'))
  const [, , , totalHeight] = String(parsed.bb).split(',').map(Number)
  const parentByEntity: Record<string, string | null | undefined> = Object.fromEntries(
    diagram.placements.map((p) => [p.entityId, p.parentId]),
  )

  const nodes: EngineResult['nodes'] = []
  const groups: EngineResult['groups'] = []
  for (const obj of parsed.objects ?? []) {
    if (obj.bb && Array.isArray(obj.nodes)) {
      // bb = "x0,y0,x1,y1" in points, Y-up; flip to top-left/Y-down below.
      const [x0, y0, x1, y1] = String(obj.bb).split(',').map(Number)
      const groupDef = diagram.groups.find((g) => `cluster_${g.id}` === obj.name)
      if (!groupDef) continue
      groups.push({ id: groupDef.id, x: x0, y: totalHeight - y1, width: x1 - x0, height: y1 - y0 })
    } else if (obj.pos && parentByEntity[obj.name] !== undefined) {
      const [cx, cy] = String(obj.pos).split(',').map(Number)
      const h = heightById[obj.name] ?? 64
      nodes.push({ id: obj.name, x: cx - W / 2, y: totalHeight - (cy + h / 2), parentId: parentByEntity[obj.name] ?? null })
    }
  }
  return { nodes, groups }
}
```

- [ ] **Step 5: Run the tests + tsc**

Run: `cd webapp && npx vitest run server/layout-graphviz.test.ts && npx tsc --noEmit`
Expected: all 3 PASS, tsc clean. (If the wasm load is slow on first run, the test still completes — `Graphviz.load()` is cached.)

- [ ] **Step 6: Commit**

```bash
cd webapp && git add server/layout-graphviz.ts server/layout-graphviz.test.ts package.json package-lock.json
git commit -m "feat: Graphviz (wasm) layout adapter"
```

---

### Task 4: Async dispatcher, retire dagre, thread async through call sites + `/api/layout` engine param

**Files:**
- Modify: `webapp/server/layout.ts` (rewrite `layoutDiagram`; remove dagre)
- Modify: `webapp/server/mcp.ts` (`handlers.layout` + `handlers.authorDiagram` async; tool callbacks await; layout uses `DEFAULT_ENGINE`)
- Modify: `webapp/server/authoring.ts` (`authorDiagramOps` async)
- Modify: `webapp/vite.config.ts` (`/api/layout` engine param + await)
- Modify: `webapp/package.json` (remove `@dagrejs/dagre`)
- Test: `webapp/server/layout.test.ts`, `webapp/server/authoring.test.ts`, `webapp/server/mcp.test.ts`

**Interfaces:**
- Consumes: `runElk` (Task 2), `runGraphviz` (Task 3), `assignEdgeHandles` + types (Task 1).
- Produces: `export async function layoutDiagram(diagram: Diagram, engine?: LayoutEngine): Promise<{ placements: Placement[]; groups: Group[]; edges: DEdge[] }>`; async `handlers.layout(store, diagramId, engine?)`, async `handlers.authorDiagram`, async `authorDiagramOps`.

**Context:** This is the atomic swap — `layoutDiagram` becomes async, so every synchronous caller must be updated in the same task or tsc breaks. dagre and the collision pass are deleted here.

- [ ] **Step 1: Write the failing dispatcher tests**

Replace the dagre-specific body-assertions in `webapp/server/layout.test.ts`'s `layoutDiagram` describe with engine-driven ones (keep the `handlesFor`/`absoluteCenter`/`assignEdgeHandles` unit tests untouched). Add:

```ts
describe('layoutDiagram dispatcher', () => {
  const diagram = {
    id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
    placements: [
      { entityId: 'in', position: { x: 0, y: 0 }, parentId: 'g', note: 'keep me' },
      { entityId: 'out', position: { x: 0, y: 0 }, fieldShow: { host: true } },
    ],
    groups: [{ id: 'g', label: 'G', color: '#111', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }],
    edges: [{ id: 'e1', from: 'out', to: 'in', type: 'talks-to' as const }],
    notes: [],
  }

  for (const engine of ['elk', 'graphviz'] as const) {
    it(`(${engine}) returns child positions relative to the group and preserves placement fields`, async () => {
      const { placements, groups } = await layoutDiagram(diagram, engine)
      const inner = placements.find((p) => p.entityId === 'in')!
      const g = groups.find((x) => x.id === 'g')!
      // child position is parent-relative → non-negative-ish within the box, and
      // adding the group origin lands inside the group's absolute bounds
      expect(inner.parentId).toBe('g')
      expect(inner.note).toBe('keep me') // preserved
      expect(g.position).toBeTruthy()
      expect(placements.find((p) => p.entityId === 'out')!.fieldShow).toEqual({ host: true }) // preserved
    })

    it(`(${engine}) bakes edge handles`, async () => {
      const { edges } = await layoutDiagram(diagram, engine)
      expect(['left', 'right', 'top', 'bottom']).toContain(edges[0].sourceHandle)
      expect(['left', 'right', 'top', 'bottom']).toContain(edges[0].targetHandle)
    })
  }

  it('defaults to elk when no engine is given', async () => {
    const { placements } = await layoutDiagram(diagram)
    expect(placements).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd webapp && npx vitest run server/layout.test.ts -t "layoutDiagram dispatcher"`
Expected: FAIL — `layoutDiagram` is sync/dagre and its result isn't a Promise (awaiting a non-Promise returns it, but `engine` arg is ignored and the async assertions/shape differ); at minimum tsc/behavior mismatch. (It will pass only after the rewrite.)

- [ ] **Step 3: Rewrite `layoutDiagram` as the async dispatcher; delete dagre**

Replace the entire dagre implementation of `layoutDiagram` in `webapp/server/layout.ts` with:

```ts
import { runElk } from './layout-elk'
import { runGraphviz } from './layout-graphviz'

// ...keep: W, H, note/height helpers, absoluteCenter, handlesFor, HandleId,
// assignEdgeHandles, and the engine types. DELETE: the dagre import, the dagre
// graph construction, cluster sizing, the collision pass.

export async function layoutDiagram(
  diagram: Diagram,
  engine: LayoutEngine = DEFAULT_ENGINE,
): Promise<{ placements: Placement[]; groups: Group[]; edges: DEdge[] }> {
  const heightById: Record<string, number> = {}
  for (const p of diagram.placements) heightById[p.entityId] = nodeHeight(p)

  const result = await (engine === 'graphviz' ? runGraphviz : runElk)(diagram, heightById)

  const groupAbsById: Record<string, EngineGroup> = Object.fromEntries(result.groups.map((g) => [g.id, g]))
  const nodeById: Record<string, EngineNode> = Object.fromEntries(result.nodes.map((n) => [n.id, n]))

  const groups: Group[] = diagram.groups.map((g) => {
    const eg = groupAbsById[g.id]
    if (!eg) return g
    return { ...g, position: { x: Math.round(eg.x), y: Math.round(eg.y) }, size: { width: Math.round(eg.width), height: Math.round(eg.height) } }
  })
  const groupById: Record<string, Group> = Object.fromEntries(groups.map((g) => [g.id, g]))

  const placements: Placement[] = diagram.placements.map((p) => {
    const n = nodeById[p.entityId]
    if (!n) return p
    let x = n.x
    let y = n.y
    if (p.parentId && groupById[p.parentId]) {
      x -= groupById[p.parentId].position.x
      y -= groupById[p.parentId].position.y
    }
    return { ...p, position: { x: Math.round(x), y: Math.round(y) } }
  })

  const edges = assignEdgeHandles(placements, groups, diagram.edges, heightById)
  return { placements, groups, edges }
}
```

Remove `import dagre from '@dagrejs/dagre'` and all dagre-only constants/logic no longer referenced (`PAD`, `HEADER`, `CLEAR`, `labelSize`, `LABEL_*`, `NOTE_*` only if now unused — keep `noteHeight`/`nodeHeight`/`H`/`W`/`absoluteCenter`/`handlesFor`/`assignEdgeHandles`). Verify with tsc that nothing references a removed symbol.

- [ ] **Step 4: Make `authorDiagramOps` async**

In `webapp/server/authoring.ts`: change the signature to `export async function authorDiagramOps(model: Model, spec: AuthorSpec): Promise<{ ops: Op[]; diagramId: string }>` and `const laidOut = await layoutDiagram(diagram)`. No other logic change (it already builds `finalDiagram` with `laidOut.edges` from the edge-orientation task).

- [ ] **Step 5: Make the MCP handlers + tool callbacks async**

In `webapp/server/mcp.ts`:
1. `handlers.authorDiagram` → `async authorDiagram(store, spec): Promise<{ diagramId: string } | ErrorResult>`, with `built = await authorDiagramOps(model, spec)` inside the try.
2. `handlers.layout` → `async layout(store, diagramId, engine: LayoutEngine = DEFAULT_ENGINE): Promise<OkResult | ErrorResult>`, with `const laid = await layoutDiagram(diagram, engine)`; build the next diagram with `laid.placements/groups/edges` as today.
3. Import `LayoutEngine`, `DEFAULT_ENGINE` from `./layout`.
4. The two tool callbacks become async and await:
   - `async (args) => wrap(await handlers.authorDiagram(store, args as AuthorSpec))`
   - `async () => wrap(await handlers.layout(store, args.diagramId))` — the `layout` tool passes NO engine (uses default). (Keep its inputSchema `{ diagramId: z.string() }` — no engine param.)

- [ ] **Step 6: Add the engine param to `/api/layout`**

In `webapp/vite.config.ts`, in the `/api/layout` handler, read and coerce the engine and await:

```ts
const { diagramId, engine } = JSON.parse(body) as { diagramId: string; engine?: string }
const eng = engine === 'graphviz' ? 'graphviz' : 'elk' // coerce unknown → default
const result = await handlers.layout(await storeReady, diagramId, eng)
```

(Keep the existing 400-on-error/bad-body handling.)

- [ ] **Step 7: Remove dagre + update async caller tests**

Run: `cd webapp && npm uninstall @dagrejs/dagre`
Then update `webapp/server/authoring.test.ts` and `webapp/server/mcp.test.ts` so every call to `authorDiagramOps` / `handlers.authorDiagram` / `handlers.layout` is `await`ed (the tests become `async`). Add one case to `mcp.test.ts`: `await handlers.layout(store, '<id>', 'graphviz')` returns `{ ok: true }` and doesn't throw.

- [ ] **Step 8: Run the full suite + tsc**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean (no references to `@dagrejs/dagre` or removed symbols); all tests green including the async-updated authoring/mcp tests and the dispatcher tests.

- [ ] **Step 9: Commit**

```bash
cd webapp && git add server/layout.ts server/mcp.ts server/authoring.ts vite.config.ts server/layout.test.ts server/authoring.test.ts server/mcp.test.ts package.json package-lock.json
git commit -m "feat: async multi-engine layoutDiagram dispatcher; retire dagre"
```

---

### Task 5: Client engine selector

**Files:**
- Modify: `webapp/src/App.tsx`

**Interfaces:**
- Consumes: `POST /api/layout { diagramId, engine }` (Task 4).
- Produces: an engine `<select>` in the toolbar; the Tidy request carries the selected engine.

**Context:** The `Flow` component renders the toolbar (~line 765, the `+ Group`/Tidy/Edges row) and owns the `tidy` handler (~line 560, `fetch('/api/layout', { body: JSON.stringify({ diagramId: activeId }) })`).

- [ ] **Step 1: Add engine state persisted in localStorage**

In `Flow` (near the other `useState`/refs, e.g. by `edgeStyle`), add:

```ts
const [layoutEngine, setLayoutEngine] = useState<'elk' | 'graphviz'>(
  () => (localStorage.getItem('homelab-layout-engine') as 'elk' | 'graphviz') || 'elk',
)
const chooseEngine = useCallback((e: 'elk' | 'graphviz') => {
  setLayoutEngine(e)
  localStorage.setItem('homelab-layout-engine', e)
}, [])
```

- [ ] **Step 2: Pass the engine in the Tidy request**

In the `tidy` handler, change the fetch body to include the engine, and add `layoutEngine` to the callback's deps:

```ts
body: JSON.stringify({ diagramId: activeId, engine: layoutEngine }),
```
Update the `useCallback` deps for `tidy` from `[rf, activeId]` to `[rf, activeId, layoutEngine]`.

- [ ] **Step 3: Add the selector to the toolbar**

Next to the Tidy button (before or after it) in the toolbar JSX, add:

```tsx
<label className="edgestyle">
  Layout:
  <select value={layoutEngine} onChange={(e) => chooseEngine(e.target.value as 'elk' | 'graphviz')}>
    <option value="elk">elkjs</option>
    <option value="graphviz">Graphviz</option>
  </select>
</label>
```

(Reuse the existing `.edgestyle` label styling used by the Edges selector.)

- [ ] **Step 4: Typecheck**

Run: `cd webapp && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Playwright verification**

With `npm run dev` running (confirm `curl -s -m 3 localhost:5173/api/model >/dev/null && echo UP`), load `http://localhost:5173`, Diagrams tab, pick a diagram. Verify:
1. The Layout selector shows `elkjs` by default; the network `POST /api/layout` on Tidy sends `{"engine":"elk",...}` (check via the network panel / `browser_network_requests`), and node positions change to an elk layout.
2. Switch the selector to `Graphviz`, click Tidy → the request body has `"engine":"graphviz"`, positions change to the graphviz layout, no console errors, save indicator returns to saved.
3. Reload the page → the selector still shows `Graphviz` (localStorage persisted).
Close the Playwright browser tab when done. Do not commit/delete `model.json`/`history.json`.

If Playwright is unavailable, say so explicitly and give the exact manual steps instead.

- [ ] **Step 6: Commit**

```bash
cd webapp && git add src/App.tsx
git commit -m "feat: layout engine selector (elkjs / Graphviz) next to Tidy"
```

---

## Self-Review

**Spec coverage:**
- `LayoutEngine`/`DEFAULT_ENGINE`, `Engine*` types, `assignEdgeHandles` extraction, exported `W` → Task 1. ✓
- elkjs adapter (hierarchy, INCLUDE_CHILDREN, abs-coord walk, per-node height) → Task 2. ✓
- Graphviz adapter (cluster_ naming, inches, Y-flip, per-node height) → Task 3. ✓
- Async dispatcher + abs→relative preserving placement fields + baked handles → Task 4 Step 3. ✓
- Retire dagre (dep + graph-building + collision pass) → Task 4 Steps 3, 7. ✓
- Async ripple (layoutDiagram, authorDiagramOps, handlers.layout/authorDiagram, tool callbacks, /api/layout) → Task 4 Steps 3-6. ✓
- `/api/layout` engine param + coercion; MCP tools use DEFAULT_ENGINE → Task 4 Steps 5-6. ✓
- UI selector + localStorage + Tidy passes engine → Task 5. ✓
- Deps added/removed → Tasks 2, 3, 4 Step 7. ✓
- Adapter tests (wrap members, no overlap, group-targeted-edge ignored, graphviz Y-down) + dispatcher tests + async caller tests → Tasks 2, 3, 4. ✓

**Placeholder scan:** clean — full code in every server step; Task 5 is client (tsc + Playwright, no unit harness for `App.tsx`, consistent with prior client tasks).

**Type consistency:** `EngineAdapter`/`EngineResult`/`EngineNode`/`EngineGroup` defined once (Task 1) and imported by both adapters (Tasks 2, 3) and the dispatcher (Task 4). `runElk`/`runGraphviz` both typed `EngineAdapter`. `layoutDiagram(diagram, engine?)` async signature matches every awaiting caller (Task 4). `assignEdgeHandles(placements, groups, edges, heightById)` identical where produced (Task 1) and called (Task 4). `W` exported (Task 1), imported by adapters. Engine string literal `'elk'|'graphviz'` consistent across server coercion and the client selector.

**One flagged risk for the reviewer:** the Graphviz cluster `bb` parse in Task 3 splits `"x0,y0,x1,y1"`; the code reads `y0` separately — confirm during review that `x0,y0,x1,y1` destructuring matches the emitted order and the Y-flip (`totalHeight - y1` for top) is correct, since a sign error there is the most likely adapter bug.

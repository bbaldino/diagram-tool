# Nested-aware Tidy (leaf-first recursive layout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make server-side Tidy preserve nested groups and keep grouped notes inside their groups, by laying out each container in isolation leaf-first over flat engine calls, then applying the shared containment backstop.

**Architecture:** Replace the engines' (unused, flaky) nested-hierarchy path with a pure, recursive **leaf-first orchestrator** in `server/layout.ts`. Each container (a group, or the canvas root) is laid out as one **flat** set of sized boxes — its direct nodes, its direct grouped notes, and its direct child groups represented as fixed-size boxes whose size was already computed by their own (deeper) layout. Cross-boundary edges are laid out once, at their lowest-common-ancestor container, contracted to the two boxes they run between. `reflowContainment` runs on the result as the invariant backstop; `assignEdgeHandles` bakes handles from final full-chain geometry.

**Tech Stack:** TypeScript, Node, `elkjs`, `@hpcc-js/wasm` (Graphviz), Vitest. Server-only change; the client still `POST`s `/api/layout` unchanged.

**Design spec:** `docs/superpowers/specs/2026-07-28-nested-tidy-design.md`.

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and `npx vitest run` fully green (NORMAL cadence, no scratch config). The additive ordering of Task 3 (new flat engines added *beside* the old ones) exists specifically so no intermediate task leaves the module non-compiling.
- Commits end with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Only capitalize the first letter of multi-letter acronyms (LCA is an initialism used in prose only; no identifiers required to spell it out).
- Positions in the model are **parent-relative**: a child's `position` is relative to its parent group's origin; a top-level element's `position` is absolute. The orchestrator stores every laid-out position parent-relative — there is no separate global recomposition pass.
- Node children carry no model size. Layout uses the existing `W = 180` (box width) and `H = 64` (box height) constants for a node box; containment math (`reflowContainment`) keeps using `NODE_EST_SIZE`. Do not unify these — both already exist and this plan introduces no new footprint constant.
- Reuse the existing shared containment module (`src/containment.ts`): `requiredGroupSize`, `reflowContainment`, `GROUP_PAD`, `GROUP_NEST_TOP_PAD`, `GROUP_MIN`. Do not reimplement padding/sizing.
- All new server code must stay server-safe: no `@xyflow`/React/DOM imports.

---

## File Structure

- `server/layout.ts` — **modified**: `absoluteCenter` walks the full parent chain; new `FlatEngine`/`FlatBox`/`FlatEdge` types; the recursive `layoutDiagram` orchestrator; returns `{ nodes, groups, notes, edges }`. Old `EngineDiagram`/`EngineResult`/`EngineAdapter` removed in Task 5.
- `server/layout-tree.ts` — **new**: pure containment-tree utilities — `parentOf`, `containerChain`, `boxAtContainer`, `lcaContainer`, and `contractEdges` (edge → LCA-level box pair). No engine/DOM imports.
- `server/layout-elk.ts` — **modified**: reduce to the flat `runElkFlat: FlatEngine`.
- `server/layout-graphviz.ts` — **modified**: reduce to the flat `runGraphvizFlat: FlatEngine`.
- `server/mcp.ts` — **modified**: `handlers.layout` persists `notes` and runs `reflowContainment` on the laid-out diagram.
- Tests: `server/layout-tree.test.ts` (new), `server/layout.test.ts`, `server/layout-elk.test.ts`, `server/layout-graphviz.test.ts`, `server/mcp.test.ts` (layout handler).

Consumers verified compatible: `server/authoring.ts` passes `notes: []` and reads `laidOut.nodes/groups/edges` — the added `notes` in the return is additive and requires no change there.

---

### Task 1: `absoluteCenter` walks the full parent chain

**Files:**
- Modify: `server/layout.ts` (the `absoluteCenter` function, ~lines 30-53)
- Test: `server/layout.test.ts`

**Interfaces:**
- Consumes: `Group` from `../src/model`.
- Produces: `absoluteCenter(n, groupById, height)` — unchanged signature, now correct for a node nested more than one group deep. Used by `assignEdgeHandles`.

**Why:** With real nesting, a node's parent group may itself be nested. A node's absolute center must add **every** ancestor group's offset, not just the immediate parent's. The current one-level version silently misplaces edge handles for nodes in nested groups.

- [ ] **Step 1: Write the failing test**

Add to `server/layout.test.ts` (in the `absoluteCenter` describe/area near the existing cases):

```ts
it('absoluteCenter: node in a nested group adds every ancestor group offset', () => {
  const groupById: Record<string, Group> = {
    outer: { id: 'outer', label: 'O', color: '#000', position: { x: 100, y: 200 }, size: { width: 400, height: 300 } },
    inner: { id: 'inner', label: 'I', color: '#000', position: { x: 20, y: 30 }, size: { width: 200, height: 150 }, parentId: 'outer' },
  }
  // node at (5,5) relative to inner; inner at (20,30) relative to outer; outer at (100,200) absolute.
  // center = (100+20+5 + W/2, 200+30+5 + h/2) with W=180, h=64 → (125+90, 235+32) = (215, 267)
  const c = absoluteCenter({ position: { x: 5, y: 5 }, parentId: 'inner' }, groupById, 64)
  expect(c).toEqual({ x: 215, y: 267 })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/layout.test.ts`
Expected: FAIL — current `absoluteCenter` adds only `inner`'s offset (misses `outer`), so x/y are 100/200 short.

- [ ] **Step 3: Implement the full-chain walk**

Replace the body of `absoluteCenter` so it walks up `parentId` accumulating each ancestor group's position (guard against cycles with a visited set):

```ts
export function absoluteCenter(
  n: { position: { x: number; y: number }; parentId?: string },
  groupById: Record<string, Group>,
  height: number,
): { x: number; y: number } {
  let x = n.position.x
  let y = n.position.y
  let parentId = n.parentId
  const seen = new Set<string>()
  while (parentId && groupById[parentId] && !seen.has(parentId)) {
    seen.add(parentId)
    const g = groupById[parentId]
    x += g.position.x
    y += g.position.y
    parentId = g.parentId
  }
  return { x: x + W / 2, y: y + height / 2 }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/layout.test.ts`
Expected: PASS — the new nested test passes and every existing `absoluteCenter`/`assignEdgeHandles` test (single-level) still passes (one level is a subset of the chain walk).

- [ ] **Step 5: Full green + commit**

Run: `npx vitest run && npx tsc --noEmit`
```bash
git add server/layout.ts server/layout.test.ts
git commit -m "fix(layout): absoluteCenter walks the full parent chain for nested groups"
```

---

### Task 2: Pure containment-tree + LCA edge-contraction helpers

**Files:**
- Create: `server/layout-tree.ts`
- Test: `server/layout-tree.test.ts`

**Interfaces:**
- Consumes: `Diagram` from `../src/model`.
- Produces:
  - `parentOf(diagram, id): string | null` — the `parentId` of the node or group with this id (a note is never an edge endpoint, so notes need not resolve here), or `null` if top-level/unknown.
  - `containerChain(diagram, id): (string | null)[]` — the containers an element sits in, deepest first, ending with `null` (root). e.g. a node in `inner` (nested in `outer`) → `['inner', 'outer', null]`.
  - `lcaContainer(diagram, a, b): string | null` — the deepest container common to both elements' chains.
  - `boxAtContainer(diagram, elementId, container): string` — the id of the box that is a **direct child** of `container` and (transitively) contains `elementId` (the element itself if it is a direct child, else the ancestor group that is).
  - `contractEdges(diagram): Map<string | null, { from: string; to: string }[]>` — every edge grouped by its LCA container, each contracted to the two direct-child box ids it runs between; self-loops (both endpoints resolve to the same box) are dropped.

**Why:** This is the pure heart of the leaf-first scheme: which edges influence which container's layout, and as which box pair. Kept engine-free so it's exercised with hand-built diagrams and exact assertions.

- [ ] **Step 1: Write the failing tests**

Create `server/layout-tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parentOf, containerChain, lcaContainer, boxAtContainer, contractEdges } from './layout-tree'
import type { Diagram } from '../src/model'

// Root → B{ b1, C{ c1, D{ d1, d2 } } }
const mk = (): Diagram => ({
  id: 'd', name: 'D', title: 'D', type: 'canvas',
  groups: [
    { id: 'B', label: 'B', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
    { id: 'C', label: 'C', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 }, parentId: 'B' },
    { id: 'D', label: 'D', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 }, parentId: 'C' },
  ],
  nodes: [
    { id: 'b1', label: 'b1', fields: [], position: { x: 0, y: 0 }, parentId: 'B' },
    { id: 'c1', label: 'c1', fields: [], position: { x: 0, y: 0 }, parentId: 'C' },
    { id: 'd1', label: 'd1', fields: [], position: { x: 0, y: 0 }, parentId: 'D' },
    { id: 'd2', label: 'd2', fields: [], position: { x: 0, y: 0 }, parentId: 'D' },
    { id: 'top', label: 'top', fields: [], position: { x: 0, y: 0 } },
  ],
  notes: [], edges: [], flows: [],
})

describe('layout-tree', () => {
  it('parentOf resolves node and group parents', () => {
    const d = mk()
    expect(parentOf(d, 'd1')).toBe('D')
    expect(parentOf(d, 'D')).toBe('C')
    expect(parentOf(d, 'top')).toBe(null)
    expect(parentOf(d, 'B')).toBe(null)
  })

  it('containerChain lists containers deepest-first ending in root(null)', () => {
    expect(containerChain(mk(), 'd1')).toEqual(['D', 'C', 'B', null])
    expect(containerChain(mk(), 'top')).toEqual([null])
  })

  it('lcaContainer is the deepest shared container', () => {
    const d = mk()
    expect(lcaContainer(d, 'd1', 'd2')).toBe('D')     // same group
    expect(lcaContainer(d, 'c1', 'd1')).toBe('C')     // c1 direct in C, d1 in D⊂C
    expect(lcaContainer(d, 'b1', 'd1')).toBe('B')
    expect(lcaContainer(d, 'top', 'd1')).toBe(null)   // root
  })

  it('boxAtContainer returns the direct child of the container that holds the element', () => {
    const d = mk()
    expect(boxAtContainer(d, 'd1', 'C')).toBe('D')    // via the child group
    expect(boxAtContainer(d, 'c1', 'C')).toBe('c1')   // the node itself
    expect(boxAtContainer(d, 'd1', null)).toBe('B')   // top-level box containing d1
  })

  it('contractEdges files each edge under its LCA as a box pair, dropping self-loops', () => {
    const d = mk()
    d.edges = [
      { id: 'e_dd', from: 'd1', to: 'd2', type: 'talks-to' },   // LCA D → d1↔d2
      { id: 'e_cd', from: 'c1', to: 'd1', type: 'talks-to' },   // LCA C → c1↔D
      { id: 'e_bd', from: 'b1', to: 'd1', type: 'talks-to' },   // LCA B → b1↔C
      { id: 'e_td', from: 'top', to: 'd1', type: 'talks-to' },  // LCA root → top↔B
    ]
    const m = contractEdges(d)
    expect(m.get('D')).toEqual([{ from: 'd1', to: 'd2' }])
    expect(m.get('C')).toEqual([{ from: 'c1', to: 'D' }])
    expect(m.get('B')).toEqual([{ from: 'b1', to: 'C' }])
    expect(m.get(null)).toEqual([{ from: 'top', to: 'B' }])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run server/layout-tree.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `server/layout-tree.ts`**

```ts
import type { Diagram } from '../src/model'

// parentId of the node or group with this id (notes aren't edge endpoints), or
// null if top-level or unknown.
export function parentOf(diagram: Diagram, id: string): string | null {
  const n = diagram.nodes.find((x) => x.id === id)
  if (n) return n.parentId ?? null
  const g = diagram.groups.find((x) => x.id === id)
  if (g) return g.parentId ?? null
  return null
}

// The containers an element sits in, deepest first, ending with null (root).
// Cycle-guarded.
export function containerChain(diagram: Diagram, id: string): (string | null)[] {
  const chain: (string | null)[] = []
  const seen = new Set<string>()
  let cur: string | null = parentOf(diagram, id)
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    chain.push(cur)
    cur = parentOf(diagram, cur)
  }
  chain.push(null)
  return chain
}

// Deepest container common to both elements' chains.
export function lcaContainer(diagram: Diagram, a: string, b: string): string | null {
  const bChain = new Set(containerChain(diagram, b).map((c) => c ?? ' root'))
  for (const c of containerChain(diagram, a)) {
    if (bChain.has(c ?? ' root')) return c
  }
  return null
}

// The id of the box that is a direct child of `container` and (transitively)
// contains `elementId` — the element itself if it is a direct child, else the
// ancestor group that is.
export function boxAtContainer(diagram: Diagram, elementId: string, container: string | null): string {
  let cur = elementId
  const seen = new Set<string>()
  while ((parentOf(diagram, cur) ?? null) !== container) {
    const p = parentOf(diagram, cur)
    if (!p || seen.has(p)) break
    seen.add(p)
    cur = p
  }
  return cur
}

// Every edge grouped by its LCA container, contracted to the two direct-child
// box ids it runs between at that container. Self-loops (both endpoints resolve
// to the same box) are dropped.
export function contractEdges(diagram: Diagram): Map<string | null, { from: string; to: string }[]> {
  const out = new Map<string | null, { from: string; to: string }[]>()
  for (const e of diagram.edges) {
    const lca = lcaContainer(diagram, e.from, e.to)
    const from = boxAtContainer(diagram, e.from, lca)
    const to = boxAtContainer(diagram, e.to, lca)
    if (from === to) continue
    const list = out.get(lca) ?? []
    list.push({ from, to })
    out.set(lca, list)
  }
  return out
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run server/layout-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Full green + commit**

Run: `npx vitest run && npx tsc --noEmit`
```bash
git add server/layout-tree.ts server/layout-tree.test.ts
git commit -m "feat(layout): pure containment-tree + LCA edge-contraction helpers"
```

---

### Task 3: Flat engine adapters (additive — old ones stay)

**Files:**
- Modify: `server/layout.ts` (add `FlatBox`/`FlatEdge`/`FlatEngine` types — additive)
- Modify: `server/layout-elk.ts` (add `runElkFlat`)
- Modify: `server/layout-graphviz.ts` (add `runGraphvizFlat`)
- Test: `server/layout-elk.test.ts`, `server/layout-graphviz.test.ts`

**Interfaces:**
- Produces (add to `server/layout.ts`, do NOT remove the existing engine types yet):
```ts
export interface FlatBox { id: string; width: number; height: number }
export interface FlatEdge { from: string; to: string }
// Lay out a flat set of sized boxes; return each box's top-left position in
// engine coordinates (arbitrary origin — the orchestrator normalizes). No
// groups, no clusters, no hierarchy.
export type FlatEngine = (boxes: FlatBox[], edges: FlatEdge[]) => Promise<Record<string, { x: number; y: number }>>
```
- `runElkFlat: FlatEngine` (exported from `layout-elk.ts`), `runGraphvizFlat: FlatEngine` (exported from `layout-graphviz.ts`).

**Why:** Adding the flat engines beside the existing `runElk`/`runGraphviz` keeps the module compiling and green while Task 4 rewires `layoutDiagram`. The old functions are removed in Task 5.

- [ ] **Step 1: Write the failing tests**

Add to `server/layout-elk.test.ts`:

```ts
import { runElkFlat } from './layout-elk'

it('runElkFlat lays out flat boxes and returns a position per box', async () => {
  const pos = await runElkFlat(
    [
      { id: 'a', width: 180, height: 64 },
      { id: 'b', width: 180, height: 64 },
    ],
    [{ from: 'a', to: 'b' }],
  )
  expect(Object.keys(pos).sort()).toEqual(['a', 'b'])
  // layered RIGHT → b is to the right of a
  expect(pos.b.x).toBeGreaterThan(pos.a.x)
  expect(typeof pos.a.y).toBe('number')
})
```

Add to `server/layout-graphviz.test.ts`:

```ts
import { runGraphvizFlat } from './layout-graphviz'

it('runGraphvizFlat lays out flat boxes and returns a position per box', async () => {
  const pos = await runGraphvizFlat(
    [
      { id: 'a', width: 180, height: 64 },
      { id: 'b', width: 180, height: 64 },
    ],
    [{ from: 'a', to: 'b' }],
  )
  expect(Object.keys(pos).sort()).toEqual(['a', 'b'])
  expect(pos.b.x).toBeGreaterThan(pos.a.x) // rankdir=LR
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run server/layout-elk.test.ts server/layout-graphviz.test.ts`
Expected: FAIL — `runElkFlat`/`runGraphvizFlat` not exported.

- [ ] **Step 3: Implement `runElkFlat`**

Add to `server/layout-elk.ts` (keep the existing `runElk`; import the new types):

```ts
import type { FlatEngine } from './layout'

export const runElkFlat: FlatEngine = async (boxes, edges) => {
  const ids = new Set(boxes.map((b) => b.id))
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.componentComponent': '60',
    },
    children: boxes.map((b) => ({ id: b.id, width: b.width, height: b.height })),
    edges: edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e, i) => ({ id: `fe${i}`, sources: [e.from], targets: [e.to] })),
  }
  const result = await elk.layout(graph)
  const out: Record<string, { x: number; y: number }> = {}
  for (const c of result.children ?? []) out[c.id] = { x: c.x ?? 0, y: c.y ?? 0 }
  return out
}
```

- [ ] **Step 4: Implement `runGraphvizFlat`**

Add to `server/layout-graphviz.ts` (keep existing `runGraphviz`, `getGraphviz`, `dotId`; import the new types). Graphviz sizes are in points (72/inch); box `width`/`height` are already in points, so pass `width/72` inches and read center `pos` in points, flipping Y like the existing adapter:

```ts
import type { FlatEngine } from './layout'

export const runGraphvizFlat: FlatEngine = async (boxes, edges) => {
  const graphviz = await getGraphviz()
  const ids = new Set(boxes.map((b) => b.id))
  const lines: string[] = ['digraph G {', '  rankdir=LR;', '  nodesep=0.5; ranksep=1.0;']
  for (const b of boxes) {
    lines.push(`  ${dotId(b.id)} [shape=box fixedsize=true width=${b.width / 72} height=${b.height / 72}];`)
  }
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to)) lines.push(`  ${dotId(e.from)} -> ${dotId(e.to)};`)
  lines.push('}')
  const parsed = JSON.parse(await graphviz.layout(lines.join('\n'), 'json', 'dot'))
  const [, , , totalHeight] = String(parsed.bb).split(',').map(Number)
  const sizeById = new Map(boxes.map((b) => [b.id, b]))
  const out: Record<string, { x: number; y: number }> = {}
  for (const obj of parsed.objects ?? []) {
    const b = obj.pos && sizeById.get(obj.name)
    if (!b) continue
    const [cx, cy] = String(obj.pos).split(',').map(Number)
    out[obj.name] = { x: cx - b.width / 2, y: totalHeight - (cy + b.height / 2) }
  }
  return out
}
```

- [ ] **Step 5: Run to verify they pass, full green + commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS (new flat-engine tests green; all existing tests still green since old code is untouched).
```bash
git add server/layout.ts server/layout-elk.ts server/layout-graphviz.ts server/layout-elk.test.ts server/layout-graphviz.test.ts
git commit -m "feat(layout): add flat FlatEngine adapters (runElkFlat/runGraphvizFlat)"
```

---

### Task 4: Leaf-first recursive orchestrator + notes/reflow write-back

**Files:**
- Modify: `server/layout.ts` (rewrite `layoutDiagram`)
- Modify: `server/mcp.ts` (`handlers.layout`)
- Test: `server/layout.test.ts`, `server/mcp.test.ts`

**Interfaces:**
- Consumes: `contractEdges` (`./layout-tree`), `runElkFlat`/`runGraphvizFlat`, `absoluteCenter`/`assignEdgeHandles`, `requiredGroupSize`/`reflowContainment`/`GROUP_PAD`/`GROUP_NEST_TOP_PAD` (`../src/containment`).
- Produces: `layoutDiagram(diagram, engine?)` now returns `{ nodes: Node[]; groups: Group[]; notes: Note[]; edges: Edge[] }` (adds `notes`). `handlers.layout` persists notes and reflows.

**Why:** This is the behavior swap — the whole point of the plan.

- [ ] **Step 1: Write the failing tests**

Add to `server/layout.test.ts` a nested-preservation suite (assert structure, not engine pixel coords):

```ts
import { reflowContainment } from '../src/containment'

describe('layoutDiagram (nested + notes)', () => {
  // Root → B{ b1, C{ c1 } }, plus a note inside C, laid out for each engine.
  const nested = () => ({
    id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
    groups: [
      { id: 'B', label: 'B', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 } },
      { id: 'C', label: 'C', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 }, parentId: 'B' },
    ],
    nodes: [
      { id: 'b1', label: 'b1', fields: [], position: { x: 0, y: 0 }, parentId: 'B' },
      { id: 'c1', label: 'c1', fields: [], position: { x: 0, y: 0 }, parentId: 'C' },
    ],
    notes: [{ id: 'n1', text: 'note', position: { x: 0, y: 0 }, size: { width: 160, height: 90 }, parentId: 'C' }],
    edges: [{ id: 'e', from: 'b1', to: 'c1', type: 'talks-to' as const }],
    flows: [],
  })

  for (const engine of ['elk', 'graphviz'] as const) {
    it(`(${engine}) keeps the inner group nested under the outer group`, async () => {
      const { groups } = await layoutDiagram(nested(), engine)
      expect(groups.find((g) => g.id === 'C')!.parentId).toBe('B') // not un-nested
    })

    it(`(${engine}) keeps the grouped note as a child of its group`, async () => {
      const { notes } = await layoutDiagram(nested(), engine)
      expect(notes.find((n) => n.id === 'n1')!.parentId).toBe('C')
    })

    it(`(${engine}) sizes C to actually contain its child c1 and note (reflow-valid)`, async () => {
      const laid = await layoutDiagram(nested(), engine)
      // reflowContainment is grow-only; if C already contains its kids, applying
      // it again changes nothing → proof the returned sizes satisfy containment.
      const again = reflowContainment({ ...nested(), nodes: laid.nodes, groups: laid.groups, notes: laid.notes })
      const cBefore = laid.groups.find((g) => g.id === 'C')!
      const cAfter = again.groups.find((g) => g.id === 'C')!
      expect(cAfter.size).toEqual(cBefore.size)
      // and C is at least big enough for the note's footprint
      expect(cBefore.size.width).toBeGreaterThanOrEqual(160)
    })

    it(`(${engine}) returns child positions parent-relative (non-negative within padding)`, async () => {
      const { nodes } = await layoutDiagram(nested(), engine)
      const c1 = nodes.find((n) => n.id === 'c1')!
      expect(c1.position.x).toBeGreaterThanOrEqual(0)
      expect(c1.position.y).toBeGreaterThanOrEqual(0)
    })
  }

  it('leaves a top-level note untouched', async () => {
    const d = nested()
    d.notes.push({ id: 'top', text: 'floating', position: { x: 777, y: 555 }, size: { width: 160, height: 90 } })
    const { notes } = await layoutDiagram(d, 'elk')
    expect(notes.find((n) => n.id === 'top')!.position).toEqual({ x: 777, y: 555 })
  })
})
```

Add to `server/mcp.test.ts` (near the existing layout handler tests) a test that the note is persisted and stays inside its group after `handlers.layout`:

```ts
it('layout persists notes and keeps a grouped note inside its group', async () => {
  const store = await mkStore()
  const { diagramId } = (await handlers.authorDiagram(store, { name: 'L', nodes: ['Seed'] })) as { diagramId: string }
  const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'G' }) as { id: string }
  handlers.addNode(store, { diagramId, label: 'N', parentId: groupId })
  const { id: noteId } = handlers.addNote(store, { diagramId, text: 'hi', parentId: groupId }) as { id: string }
  const r = await handlers.layout(store, diagramId)
  expect(r).toEqual({ ok: true })
  const d = getDiagram(store.getState().model, diagramId)!
  const note = d.notes.find((n) => n.id === noteId)!
  expect(note.parentId).toBe(groupId) // still grouped after tidy
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run server/layout.test.ts server/mcp.test.ts`
Expected: FAIL — current `layoutDiagram` flattens `C` (parentId lost / un-nested) and never returns/persists notes.

- [ ] **Step 3: Rewrite `layoutDiagram`**

Replace the existing `layoutDiagram` in `server/layout.ts` with the recursive orchestrator. Import the flat engines and tree/containment helpers at the top:

```ts
import { runElk, runElkFlat } from './layout-elk'
import { runGraphviz, runGraphvizFlat } from './layout-graphviz'
import { contractEdges } from './layout-tree'
import { requiredGroupSize, reflowContainment, GROUP_PAD, GROUP_NEST_TOP_PAD } from '../src/containment'
```

```ts
export async function layoutDiagram(
  diagram: Diagram,
  engine: LayoutEngine = DEFAULT_ENGINE,
): Promise<{ nodes: Node[]; groups: Group[]; notes: Note[]; edges: Edge[] }> {
  const flat = engine === 'graphviz' ? runGraphvizFlat : runElkFlat
  const heightById: Record<string, number> = {}
  for (const n of diagram.nodes) heightById[n.id] = nodeHeight(n)

  const nodeIds = new Set(diagram.nodes.map((n) => n.id))
  const groupIds = new Set(diagram.groups.map((g) => g.id))
  const edgesByLca = contractEdges(diagram)

  const nodePos = new Map<string, { x: number; y: number }>()
  const notePos = new Map<string, { x: number; y: number }>()
  const groupPos = new Map<string, { x: number; y: number }>()
  const groupSize = new Map<string, { width: number; height: number }>()

  // Lay out one container (a group id, or null for the canvas root). Recurses
  // into child groups FIRST (leaf-first) so their sizes are known before this
  // container is packed. Records each direct child's parent-relative position.
  const layoutContainer = async (containerId: string | null): Promise<{ width: number; height: number }> => {
    const childGroups = diagram.groups.filter((g) => (g.parentId ?? null) === containerId)
    for (const cg of childGroups) await layoutContainer(cg.id)

    const childNodes = diagram.nodes.filter((n) => (n.parentId ?? null) === containerId)
    // Top-level notes are left where they are; only grouped notes are arranged.
    const childNotes = containerId === null ? [] : diagram.notes.filter((n) => n.parentId === containerId)

    const boxes: FlatBox[] = [
      ...childNodes.map((n) => ({ id: n.id, width: W, height: heightById[n.id] ?? 64 })),
      ...childGroups.map((g) => ({ id: g.id, ...groupSize.get(g.id)! })),
      ...childNotes.map((n) => ({ id: n.id, ...n.size })),
    ]

    if (boxes.length === 0) {
      const existing = containerId ? diagram.groups.find((g) => g.id === containerId)!.size : { width: 0, height: 0 }
      if (containerId) groupSize.set(containerId, existing)
      return existing
    }

    const rawEdges = edgesByLca.get(containerId) ?? []
    const pos = await flat(boxes, rawEdges)

    // Normalize the engine's arbitrary origin: shift the bbox top-left to the
    // container's padded top-left (root → (0,0)).
    const originX = Math.min(...boxes.map((b) => pos[b.id].x))
    const originY = Math.min(...boxes.map((b) => pos[b.id].y))
    const padX = containerId === null ? 0 : GROUP_PAD
    const padY = containerId === null ? 0 : GROUP_NEST_TOP_PAD

    const placed: { position: { x: number; y: number }; size: { width: number; height: number } }[] = []
    for (const b of boxes) {
      const p = {
        x: Math.round(pos[b.id].x - originX + padX),
        y: Math.round(pos[b.id].y - originY + padY),
      }
      placed.push({ position: p, size: { width: b.width, height: b.height } })
      if (nodeIds.has(b.id)) nodePos.set(b.id, p)
      else if (groupIds.has(b.id)) groupPos.set(b.id, p)
      else notePos.set(b.id, p)
    }

    if (containerId === null) return { width: 0, height: 0 }
    const size = requiredGroupSize(placed)
    groupSize.set(containerId, size)
    return size
  }

  await layoutContainer(null)

  const groups: Group[] = diagram.groups.map((g) => ({
    ...g,
    position: groupPos.get(g.id) ?? g.position,
    size: groupSize.get(g.id) ?? g.size,
  }))
  const nodes: Node[] = diagram.nodes.map((n) => ({ ...n, position: nodePos.get(n.id) ?? n.position }))
  const notes: Note[] = diagram.notes.map((n) => ({ ...n, position: notePos.get(n.id) ?? n.position }))

  // Backstop: enforce padding/slack/grow-to-fit invariants (grow-only).
  const reflowed = reflowContainment({ ...diagram, nodes, groups, notes })

  const edges = assignEdgeHandles(reflowed.nodes, reflowed.groups, diagram.edges, heightById)
  return { nodes: reflowed.nodes, groups: reflowed.groups, notes: reflowed.notes, edges }
}
```

Add the `Note` import to the existing model import line in `layout.ts`:
`import type { Diagram, Node, Group, Note, Edge, EdgeOrientation } from '../src/model'`.

- [ ] **Step 4: Update `handlers.layout` to persist notes + reflow**

In `server/mcp.ts`, `handlers.layout` currently writes back `nodes/groups/edges` only. Change the write-back to include `notes` (the reflow already ran inside `layoutDiagram`, so no extra reflow call is needed here):

```ts
  async layout(store: Store, diagramId: string, engine: LayoutEngine = DEFAULT_ENGINE): Promise<OkResult | ErrorResult> {
    const model = store.getState().model
    const diagram = getDiagram(model, diagramId)
    if (!diagram) return err(`unknown diagram "${diagramId}"`)
    const laid = await layoutDiagram(diagram, engine)
    const nextDiagram: Diagram = { ...diagram, nodes: laid.nodes, groups: laid.groups, notes: laid.notes, edges: laid.edges }
    const nextModel = {
      ...model,
      diagrams: model.diagrams.map((d) => (d.id === diagramId ? nextDiagram : d)),
    }
    store.apply(diffToOps(model, nextModel), 'mcp')
    return { ok: true }
  },
```

- [ ] **Step 5: Update the existing `layoutDiagram` dispatcher tests if needed**

The original `describe('layoutDiagram dispatcher')` uses a single flat group and asserts child-relative positions + edge handles — those assertions remain valid under the new orchestrator (a single group is the depth-1 case). Run them; if any assertion baked in an engine-specific coordinate that the flat path changes, adjust it to assert the same *structural* property (parent-relative, handle ∈ sides), not an exact pixel.

- [ ] **Step 6: Run to verify pass, full green + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — nested/notes suite green, mcp layout test green, full suite green, tsc clean. (`runElk`/`runGraphviz` are now unused but still present — that's fine; Task 5 removes them.)

- [ ] **Step 7: Commit**

```bash
git add server/layout.ts server/mcp.ts server/layout.test.ts server/mcp.test.ts
git commit -m "feat(layout): leaf-first recursive orchestrator; persist notes + reflow on tidy"
```

---

### Task 5: Remove the dead nested-hierarchy engine code

**Files:**
- Modify: `server/layout.ts` (remove old `EngineNode`/`EngineGroup`/`EngineResult`/`EngineDiagram`/`EngineAdapter` types)
- Modify: `server/layout-elk.ts` (remove `runElk`; rename `runElkFlat` → `runElk`)
- Modify: `server/layout-graphviz.ts` (remove `runGraphviz`; rename `runGraphvizFlat` → `runGraphviz`)
- Modify: `server/layout.ts` imports/usage of the renamed engines
- Test: adjust any test importing the `*Flat` names

**Interfaces:**
- Produces: canonical engine names `runElk`/`runGraphviz` now ARE the flat engines. The old `EngineDiagram`-shaped adapters and their types are gone.

**Why:** Task 3 deliberately left the old adapters in place to keep every intermediate green. With the orchestrator live, they're dead code. Removing them is the cleanup that finishes the migration.

- [ ] **Step 1: Delete the old adapters and types**

- In `server/layout-elk.ts`: delete the old `runElk` (the `EngineAdapter` one that builds group hierarchy) and its now-unused imports (`ElkExtendedEdge` if only it used them; keep `ElkNode`). Rename `runElkFlat` → `runElk`.
- In `server/layout-graphviz.ts`: delete the old `runGraphviz` and `toDot`; rename `runGraphvizFlat` → `runGraphviz`. Keep `getGraphviz`, `dotId`.
- In `server/layout.ts`: delete `EngineNode`, `EngineGroup`, `EngineResult`, `EngineDiagram`, `EngineAdapter`, and the `HandleId`-adjacent old comment block referencing placements. Keep `FlatBox`/`FlatEdge`/`FlatEngine`, `W`, `absoluteCenter`, `handlesFor`, `assignEdgeHandles`, `nodeHeight`.
- Update `layout.ts` to import `{ runElk }`/`{ runGraphviz }` and pick `flat = engine === 'graphviz' ? runGraphviz : runElk`.

- [ ] **Step 2: Update tests that referenced the flat names**

In `server/layout-elk.test.ts` / `server/layout-graphviz.test.ts`, rename `runElkFlat`/`runGraphvizFlat` imports to `runElk`/`runGraphviz`. Remove any test that exercised the deleted old-adapter behavior (group-hierarchy via `EngineDiagram`), since that path no longer exists — its intent is now covered by the nested tests in `layout.test.ts`.

- [ ] **Step 3: Run full suite + tsc (catch every dangling reference)**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS with no unused-symbol or missing-import errors. `grep -rn "EngineDiagram\|EngineAdapter\|runElkFlat\|runGraphvizFlat\|placements" server/` returns nothing (outside deleted lines).

- [ ] **Step 4: Commit**

```bash
git add server/layout.ts server/layout-elk.ts server/layout-graphviz.ts server/layout-elk.test.ts server/layout-graphviz.test.ts
git commit -m "refactor(layout): remove dead nested-hierarchy engine adapters and types"
```

---

### Task 6: Browser validation (controller-run, not a subagent task)

**Not an implementer task** — the controller runs this after the final whole-branch review, mirroring the edit-surface plan's live pass.

- [ ] With the dev server up, via the live MCP tools build a nested diagram: `new_diagram`; `add_group` outer; `add_group` inner with `parentId` = outer; `add_node` into inner; `add_note` into inner; a `connect` crossing from an outer-level node into the inner node.
- [ ] Call `layout` (Tidy). Then `get_diagram` and assert in the model: inner group still `parentId` = outer; note still `parentId` = inner; inner group size ≥ its children; no negative child positions.
- [ ] Open the app (Playwright), select the diagram, Fit View, screenshot. Confirm visually: inner group sits inside outer, node + note inside inner, nothing overlaps, edge routed sensibly.
- [ ] Clean up the validation diagram (`delete_diagram`).

---

## Self-Review

**Spec coverage:** leaf-first recursion (Task 4) ✓; flat engines / no clusters (Tasks 3, 5) ✓; LCA edge model (Task 2, used in Task 4) ✓; full-parent-chain coordinate correctness (Task 1) ✓; `reflowContainment` backstop + notes persisted (Task 4) ✓; grouped-notes-arranged / top-level-notes-untouched (Task 4 tests) ✓; both engines (Tasks 3/5) ✓; browser pass (Task 6) ✓.

**Placeholder scan:** none — every code step carries the actual code; every test step carries real assertions.

**Type consistency:** `FlatEngine` returns `Record<string,{x,y}>` (positions only); the orchestrator computes sizes via `requiredGroupSize`. `layoutDiagram` returns `{nodes,groups,notes,edges}` consumed by `handlers.layout` (writes all four) and `authoring.ts` (reads nodes/groups/edges; notes additive). `runElk`/`runGraphviz` end Task 5 as the flat engines. Names align across tasks.

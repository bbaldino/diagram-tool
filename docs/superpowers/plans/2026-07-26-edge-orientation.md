# Edge Orientation (Geometric Handle Assignment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During automatic layout, assign each edge's connection-point handles by geometry (the side facing the other node), honoring an optional per-edge `orientation`, so agent-authored/Tidied diagrams stop routing edges over the wrong side of a box.

**Architecture:** `layoutDiagram` (server-side dagre layout) additionally returns the diagram's edges with recomputed `sourceHandle`/`targetHandle`. The side is derived from the laid-out absolute node centers; a per-edge `orientation` (`auto`/`horizontal`/`vertical`) fixes the axis while geometry always picks the specific side. Handles are persisted (baked) through the existing `diffToOps` path at the two layout call sites (`handlers.layout`, `authorDiagramOps`), so a Tidy/author stays one atomic op-batch (one undo step).

**Tech Stack:** TypeScript, Node (Vite dev-server middleware), `@dagrejs/dagre`, Vitest. The MCP tools (`@modelcontextprotocol/sdk` + zod) expose `orientation`.

**Spec:** `docs/superpowers/specs/2026-07-26-edge-orientation-design.md`

## Global Constraints

- `orientation` values are exactly `'auto' | 'horizontal' | 'vertical'`; the field is optional on `DEdge` and **absent means `auto`**.
- **Baked, not live:** handles are computed during layout and stored in the model via the existing `diffToOps` path — never a new persistence path, and always in the same `store.apply` as the node moves (one undo step).
- `orientation` fixes the **axis**; the **side within the axis is always re-derived from geometry** on every layout (so Tidy never clobbers a chosen orientation, only tracks node positions).
- **Axis rule:** `horizontal` → left/right; `vertical` → top/bottom; `auto` (or absent) → dominant of `|dx|` vs `|dy|`, **tie → horizontal**.
- **Side rule:** horizontal → source `right`/target `left` when the target is to the right (`dx >= 0`), flipped otherwise; vertical → source `bottom`/target `top` when the target is below (`dy >= 0`), flipped otherwise.
- Node box is `W = 180` wide; height is the same per-node height the layout already computes (`H` + inline-note height). Child-node absolute center adds the parent group's absolute position.
- If an edge references an endpoint with no laid-out node, **leave that edge's handles unchanged**.
- The `orientation` **convention** goes in the MCP tool descriptions as agent guidance: *horizontal = directional data/request flow (I/O); vertical = "interacts with" / peer / side-channel; auto = geometry picks the nearest side.* The field itself stays neutral.
- `buildGraph.ts` is **unchanged**; `orientation` affects only layout, not render. Edges never laid out keep the existing right→left fallback.
- Server modules stay server-safe (type-only `../src` imports where applicable). Capitalize only the first letter of multi-letter acronyms in identifiers. Keep all existing tests green (`npx vitest run`) and `npx tsc --noEmit` clean.
- Branch: `feat/mcp-server-phase2`.

---

## File Structure

- `webapp/src/model.ts` — add `EdgeOrientation` type + `DEdge.orientation` field.
- `webapp/server/layout.ts` — add an exported pure `handlesFor(...)` helper; `layoutDiagram` computes absolute centers and returns `edges` with recomputed handles.
- `webapp/server/mcp.ts` — `handlers.layout` persists `laid.edges`; `edgeAttrsShape` + `author_diagram` edge attrs + `ConnectArgs`/`SetEdgeArgs` gain `orientation`; `connect`/`setEdge` apply it; tool descriptions carry the convention.
- `webapp/server/authoring.ts` — `authorDiagramOps` persists `laid.edges`; `AuthorSpec` edge attrs gain `orientation` (already spread onto the edge).
- Tests: `webapp/server/layout.test.ts`, `webapp/server/authoring.test.ts`, `webapp/server/mcp.test.ts`.

---

### Task 1: Model type + geometric handle assignment in the layout

**Files:**
- Modify: `webapp/src/model.ts` (add type + field near the `DEdge` interface, ~lines 48-61)
- Modify: `webapp/server/layout.ts` (add helper; extend `layoutDiagram` return, ~lines 17, 113-116)
- Test: `webapp/server/layout.test.ts`

**Interfaces:**
- Produces:
  - `export type EdgeOrientation = 'auto' | 'horizontal' | 'vertical'` and `DEdge.orientation?: EdgeOrientation` (in `model.ts`)
  - `export function handlesFor(orientation: EdgeOrientation | undefined, s: { x: number; y: number }, t: { x: number; y: number }): { sourceHandle: string; targetHandle: string }` (in `layout.ts`)
  - `layoutDiagram(diagram: Diagram): { placements: Placement[]; groups: Group[]; edges: DEdge[] }` (edges = `diagram.edges` with recomputed handles)

- [ ] **Step 1: Add the model type + field**

In `webapp/src/model.ts`, immediately above the `DEdge` interface (currently starts ~line 48), add:

```ts
export type EdgeOrientation = 'auto' | 'horizontal' | 'vertical'
```

Then add this field inside the `DEdge` interface (after `color?: string`):

```ts
  orientation?: EdgeOrientation // routing axis hint; absent = 'auto' (geometry decides)
```

- [ ] **Step 2: Write the failing test for `handlesFor`**

In `webapp/server/layout.test.ts`, add:

```ts
import { handlesFor } from './layout'

describe('handlesFor', () => {
  const S = { x: 0, y: 0 }
  it('auto: target to the right → source right, target left', () => {
    expect(handlesFor('auto', S, { x: 300, y: 0 })).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })
  it('auto: target to the left (backward edge) → source left, target right', () => {
    expect(handlesFor('auto', S, { x: -300, y: 0 })).toEqual({ sourceHandle: 'left', targetHandle: 'right' })
  })
  it('auto: target below → source bottom, target top', () => {
    expect(handlesFor('auto', S, { x: 0, y: 300 })).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' })
  })
  it('auto: target above → source top, target bottom', () => {
    expect(handlesFor('auto', S, { x: 0, y: -300 })).toEqual({ sourceHandle: 'top', targetHandle: 'bottom' })
  })
  it('auto: exact tie (|dx| == |dy|) resolves horizontal', () => {
    expect(handlesFor('auto', S, { x: 100, y: 100 })).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })
  it('undefined orientation behaves like auto', () => {
    expect(handlesFor(undefined, S, { x: 300, y: 0 })).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })
  it('horizontal forces left/right even when nodes are stacked vertically', () => {
    expect(handlesFor('horizontal', S, { x: 20, y: 300 })).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })
  it('vertical forces top/bottom even when nodes are side by side', () => {
    expect(handlesFor('vertical', S, { x: 300, y: 20 })).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' })
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd webapp && npx vitest run server/layout.test.ts -t handlesFor`
Expected: FAIL — `handlesFor` is not exported.

- [ ] **Step 4: Implement `handlesFor`**

In `webapp/server/layout.ts`, add the import of the type at the top (extend the existing model type import):

```ts
import type { Diagram, Placement, Group, DEdge, EdgeOrientation } from '../src/model'
```

Then add this exported helper (place it above `layoutDiagram`):

```ts
// Choose which side of each node an edge attaches to. `orientation` fixes the
// axis (horizontal → left/right, vertical → top/bottom); `auto` picks the
// dominant axis from the centers (tie → horizontal). The specific side is
// always derived from geometry, so it tracks the nodes on every layout.
export function handlesFor(
  orientation: EdgeOrientation | undefined,
  s: { x: number; y: number },
  t: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = t.x - s.x
  const dy = t.y - s.y
  const axis =
    orientation === 'horizontal'
      ? 'h'
      : orientation === 'vertical'
        ? 'v'
        : Math.abs(dx) >= Math.abs(dy)
          ? 'h'
          : 'v'
  if (axis === 'h') {
    return dx >= 0
      ? { sourceHandle: 'right', targetHandle: 'left' }
      : { sourceHandle: 'left', targetHandle: 'right' }
  }
  return dy >= 0
    ? { sourceHandle: 'bottom', targetHandle: 'top' }
    : { sourceHandle: 'top', targetHandle: 'bottom' }
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd webapp && npx vitest run server/layout.test.ts -t handlesFor`
Expected: PASS (all 8 cases).

- [ ] **Step 6: Write the failing test for `layoutDiagram` returning edges**

Add to `webapp/server/layout.test.ts`:

```ts
describe('layoutDiagram edge handles', () => {
  it('bakes geometry-derived handles onto returned edges', () => {
    const diagram = {
      id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
      placements: [
        { entityId: 'a', position: { x: 0, y: 0 } },
        { entityId: 'b', position: { x: 0, y: 0 } },
      ],
      groups: [],
      edges: [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' as const }],
      notes: [],
    }
    const { edges } = layoutDiagram(diagram)
    // rankdir LR places the source (a) left of the target (b), so a forward
    // edge exits a's right into b's left.
    expect(edges[0].sourceHandle).toBe('right')
    expect(edges[0].targetHandle).toBe('left')
  })

  it('leaves handles unchanged when an endpoint is not placed', () => {
    const diagram = {
      id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
      placements: [{ entityId: 'a', position: { x: 0, y: 0 } }],
      groups: [],
      edges: [{ id: 'e1', from: 'a', to: 'ghost', type: 'talks-to' as const, sourceHandle: 'top' as const }],
      notes: [],
    }
    const { edges } = layoutDiagram(diagram)
    expect(edges[0].sourceHandle).toBe('top') // untouched
  })
})
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `cd webapp && npx vitest run server/layout.test.ts -t "layoutDiagram edge handles"`
Expected: FAIL — `layoutDiagram` result has no `edges` property (undefined).

- [ ] **Step 8: Extend `layoutDiagram` to compute + return edges**

In `webapp/server/layout.ts`, change the return type on the `layoutDiagram` signature to include edges:

```ts
export function layoutDiagram(diagram: Diagram): { placements: Placement[]; groups: Group[]; edges: DEdge[] } {
```

Then, immediately before the final `return { placements, groups }` (currently ~line 115), compute edge handles from the already-computed `groups` and `placements` (both in scope), and change the return. Insert:

```ts
  // Absolute center of an entity's node: child coords are parent-relative, so
  // add the parent group's absolute position. Height matches nodeHeight above.
  const groupPosById: Record<string, { x: number; y: number }> = Object.fromEntries(
    groups.map((g) => [g.id, g.position]),
  )
  const placementByEntity: Record<string, Placement> = Object.fromEntries(
    placements.map((p) => [p.entityId, p]),
  )
  const centerOf = (entityId: string): { x: number; y: number } | null => {
    const p = placementByEntity[entityId]
    if (!p) return null
    const h = heightById[entityId] ?? H
    let x = p.position.x
    let y = p.position.y
    if (p.parentId && groupPosById[p.parentId]) {
      x += groupPosById[p.parentId].x
      y += groupPosById[p.parentId].y
    }
    return { x: x + W / 2, y: y + h / 2 }
  }

  const edges: DEdge[] = diagram.edges.map((e) => {
    const s = centerOf(e.from)
    const t = centerOf(e.to)
    if (!s || !t) return e
    return { ...e, ...handlesFor(e.orientation, s, t) }
  })

  return { placements, groups, edges }
```

Note: `heightById`, `W`, and `H` already exist in this module and are in scope at the end of `layoutDiagram`. Confirm `placements` here refers to the final (post-collision) placements the function returns.

- [ ] **Step 9: Run the layout tests + full suite + tsc**

Run: `cd webapp && npx vitest run server/layout.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

Run: `cd webapp && npx vitest run`
Expected: full suite green. (Note: `handlers.layout` and `authorDiagramOps` call `layoutDiagram` and destructure `{ placements, groups }` — the added `edges` property does not break those existing destructures. If tsc flags anything, it is a genuine issue to fix here.)

- [ ] **Step 10: Commit**

```bash
cd webapp && git add src/model.ts server/layout.ts server/layout.test.ts
git commit -m "feat: layout assigns edge handles by geometry + orientation"
```

---

### Task 2: Bake handles at the two layout call sites

**Files:**
- Modify: `webapp/server/mcp.ts:188-200` (`handlers.layout`)
- Modify: `webapp/server/authoring.ts:118` (`authorDiagramOps` final diagram)
- Test: `webapp/server/authoring.test.ts`

**Interfaces:**
- Consumes: `layoutDiagram(...) → { placements, groups, edges }` (Task 1).
- Produces: both layout call sites persist the recomputed edge handles via the existing `diffToOps` path.

- [ ] **Step 1: Write the failing test (authoring bakes handles)**

In `webapp/server/authoring.test.ts`, add a test that authoring a forward edge produces an edge carrying baked handles. Use the existing test's model-building style; a minimal version:

```ts
import { authorDiagramOps } from './authoring'
import { applyOps } from '../src/ops'

describe('authorDiagramOps edge handles', () => {
  const base = { version: 1, templates: [], entities: [
    { id: 'a', label: 'A', fields: [] }, { id: 'b', label: 'B', fields: [] },
  ], diagrams: [] }

  it('bakes geometry-derived handles onto authored edges', () => {
    const { ops, diagramId } = authorDiagramOps(base, {
      name: 'Flow', nodes: ['a', 'b'], edges: [['a', 'b']],
    })
    const model = applyOps(base, ops)
    const edge = model.diagrams.find((d) => d.id === diagramId)!.edges[0]
    // dagre LR: a is left of b → forward edge exits a's right into b's left.
    expect(edge.sourceHandle).toBe('right')
    expect(edge.targetHandle).toBe('left')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd webapp && npx vitest run server/authoring.test.ts -t "edge handles"`
Expected: FAIL — `edge.sourceHandle` is `undefined` (authoring drops `laid.edges` today).

- [ ] **Step 3: Persist `laid.edges` in `authorDiagramOps`**

In `webapp/server/authoring.ts`, change the `finalDiagram` construction (line 118) to include the laid-out edges:

```ts
  const finalDiagram: Diagram = { ...diagram, placements: finalPlacements, groups: laidOut.groups, edges: laidOut.edges }
```

(Handles come from the laid-out positions. Agent `positions` overrides — a rarely-used field — are applied to placements after layout and are not re-fed into handle computation; that is acceptable per the spec.)

- [ ] **Step 4: Persist `laid.edges` in `handlers.layout`**

In `webapp/server/mcp.ts`, in `handlers.layout` (line ~193), include the edges in the next diagram:

```ts
    const laid = layoutDiagram(diagram)
    const nextDiagram: Diagram = { ...diagram, placements: laid.placements, groups: laid.groups, edges: laid.edges }
```

- [ ] **Step 5: Run the authoring tests + full suite + tsc**

Run: `cd webapp && npx vitest run server/authoring.test.ts server/mcp.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd webapp && git add server/authoring.ts server/mcp.ts server/authoring.test.ts
git commit -m "feat: bake edge handles into the model on layout and author"
```

---

### Task 3: MCP `orientation` surface + convention docs

**Files:**
- Modify: `webapp/server/mcp.ts` (`ConnectArgs`/`SetEdgeArgs` ~lines 24-37; `connect` ~131-133; `edgeAttrsShape` ~221-224; `author_diagram` edge attrs ~236-241; `connect`/`set_edge`/`author_diagram` tool descriptions ~273/294/308)
- Modify: `webapp/server/authoring.ts:12` (`AuthorSpec` edge attrs type)
- Test: `webapp/server/mcp.test.ts`

**Interfaces:**
- Consumes: `EdgeOrientation` (Task 1); layout honors `orientation` (Task 1).
- Produces: `orientation` accepted + stored by `author_diagram`, `connect`, `set_edge`.

- [ ] **Step 1: Write the failing tests**

In `webapp/server/mcp.test.ts`, add (mirror the file's existing store/handler setup):

```ts
describe('edge orientation', () => {
  it('connect stores orientation on the edge', async () => {
    // ...build a store with a diagram containing placed nodes 'a' and 'b' (as existing tests do)...
    handlers.connect(store, { diagramId: 'd', from: 'a', to: 'b', orientation: 'vertical' })
    const edge = getDiagram(store.getState().model, 'd')!.edges.at(-1)!
    expect(edge.orientation).toBe('vertical')
  })

  it('set_edge patch updates orientation', async () => {
    // ...existing edge 'e1' in diagram 'd'...
    handlers.setEdge(store, { diagramId: 'd', edgeId: 'e1', patch: { orientation: 'horizontal' } })
    const edge = getDiagram(store.getState().model, 'd')!.edges.find((e) => e.id === 'e1')!
    expect(edge.orientation).toBe('horizontal')
  })

  it('the edge-attrs zod shape rejects an invalid orientation', () => {
    const parsed = z.object(edgeAttrsShape).safeParse({ orientation: 'sideways' })
    expect(parsed.success).toBe(false)
  })

  it('the edge-attrs zod shape accepts a valid orientation', () => {
    const parsed = z.object(edgeAttrsShape).safeParse({ orientation: 'auto' })
    expect(parsed.success).toBe(true)
  })
})
```

Ensure the test file imports what it uses: `edgeAttrsShape` and `getDiagram` (from `../src/model`), and `z` from `zod`. Build the store/diagram exactly as the existing tests in this file do (do not invent a new helper if one is already present).

- [ ] **Step 2: Run to confirm failure**

Run: `cd webapp && npx vitest run server/mcp.test.ts -t "edge orientation"`
Expected: FAIL — `orientation` not accepted/stored; invalid value not rejected (shape has no `orientation`).

- [ ] **Step 3: Add `orientation` to the zod shape + author_diagram attrs**

In `webapp/server/mcp.ts`, extend `edgeAttrsShape` (line ~221):

```ts
export const edgeAttrsShape = {
  label: z.string().optional(),
  dir: z.enum(['forward', 'backward', 'both']).optional(),
  color: z.string().optional(),
  orientation: z.enum(['auto', 'horizontal', 'vertical']).optional(),
}
```

And add the same field to the inline `author_diagram` edge attrs object (the `z.object({...})` inside the edges tuple, ~line 236-241):

```ts
            label: z.string().optional(),
            dir: z.enum(['forward', 'backward', 'both']).optional(),
            color: z.string().optional(),
            orientation: z.enum(['auto', 'horizontal', 'vertical']).optional(),
```

- [ ] **Step 4: Thread `orientation` through the handler types + `connect`**

In `webapp/server/mcp.ts`, extend `ConnectArgs` (line ~24) and `SetEdgeArgs` patch (line ~36):

```ts
export interface ConnectArgs {
  diagramId: string
  from: string
  to: string
  label?: string
  dir?: EdgeDir
  color?: string
  orientation?: EdgeOrientation
}

export interface SetEdgeArgs {
  diagramId: string
  edgeId: string
  patch: Partial<Pick<DEdge, 'label' | 'dir' | 'color' | 'orientation'>>
}
```

Add the import of `EdgeOrientation` to this file's model type import. In `connect` (after the `a.color` line, ~133):

```ts
    if (a.orientation !== undefined) edge.orientation = a.orientation
```

(`setEdge` already applies `a.patch` verbatim via `edge.update`, so no code change there beyond the type.)

- [ ] **Step 5: Allow `orientation` in the authoring spec type**

In `webapp/server/authoring.ts`, extend the `AuthorSpec.edges` attrs type (line 12) so the value type-checks (the map at line 92 already spreads `...attrs` onto the edge, so no logic change):

```ts
  edges?: [string, string, { label?: string; dir?: EdgeDir; color?: string; orientation?: EdgeOrientation }?][]
```

Add `EdgeOrientation` to the `../src/model` type import at the top of `authoring.ts`.

- [ ] **Step 6: Add the convention text to the tool descriptions**

In `webapp/server/mcp.ts`, append this sentence to the `description` strings of the `author_diagram`, `connect`, and `set_edge` tool registrations (verbatim):

```
Edge `orientation` controls which sides an edge connects to once laid out: `horizontal` (left/right) for directional data/request flow (I/O); `vertical` (top/bottom) for "interacts with"/peer/side-channel relationships; `auto` (default) lets the layout pick the side nearest the other node. The side is always chosen by geometry; orientation only fixes the axis.
```

- [ ] **Step 7: Run the mcp tests + full suite + tsc**

Run: `cd webapp && npx vitest run server/mcp.test.ts && npx tsc --noEmit`
Expected: the four new cases PASS.

Run: `cd webapp && npx vitest run`
Expected: full suite green.

- [ ] **Step 8: Commit**

```bash
cd webapp && git add server/mcp.ts server/authoring.ts server/mcp.test.ts
git commit -m "feat: MCP edges accept orientation + document the convention"
```

---

## Self-Review

**Spec coverage:**
- `DEdge.orientation` type → Task 1 Step 1. ✓
- Geometry heuristic (axis from orientation, side from centers, tie→horizontal, missing-endpoint untouched, child center via group offset) → Task 1 (`handlesFor` + `centerOf`). ✓
- `layoutDiagram` returns edges with baked handles → Task 1. ✓
- Baked via existing `diffToOps` at both call sites, one atomic apply → Task 2 (`authorDiagramOps` + `handlers.layout`). ✓
- MCP `author_diagram`/`connect`/`set_edge` accept + store `orientation` → Task 3. ✓
- Convention text in tool descriptions → Task 3 Step 6. ✓
- `buildGraph.ts` unchanged → not touched by any task. ✓
- Non-goals (dagre ranking by orientation; terminal editing; human UI control) → correctly absent. ✓

**Placeholder scan:** none — every code step carries complete code. The one prose direction (Task 3 Step 1 "build the store/diagram as existing tests do") points at an existing in-file pattern rather than inventing an unspecified helper, which is deliberate to stay DRY with `mcp.test.ts`.

**Type consistency:** `EdgeOrientation` is defined once (Task 1) and imported by `layout.ts`, `mcp.ts`, `authoring.ts`. `handlesFor(orientation, s, t)` signature is identical where produced (Task 1) and used (`layoutDiagram`). `layoutDiagram` return `{ placements, groups, edges }` matches every consumer (Task 2). `edgeAttrsShape` gains `orientation` once and is reused by both `connect` (spread) and `set_edge` (`z.object(edgeAttrsShape)`), so both accept it from one change; `author_diagram`'s attrs are a separate inline object and are updated explicitly (Task 3 Step 3).

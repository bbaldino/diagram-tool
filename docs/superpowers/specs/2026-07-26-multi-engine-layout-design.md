# Multi-Engine Layout Design

**Status:** Design — approved in brainstorming, pending spec review.
**Branch:** builds on `feat/mcp-server-phase2` (on top of the edge-orientation work).

## Problem

The server-side layout uses dagre. A spike comparing dagre vs elkjs vs
Graphviz on the real diagrams found dagre is the least compact with the most
edge crossings, **and** it crashes on the "Logical" diagram (two edges target a
group id; dagre's rank pass throws). elkjs and Graphviz both lay out
markedly better. We want to retire dagre and let the user try elkjs and
Graphviz against real diagrams, switching live.

## Goal

Replace the single dagre layout with a **two-engine, selectable** layout:
**elkjs** and **Graphviz** (`@hpcc-js/wasm`), chosen at runtime via a UI
selector next to Tidy. Retire dagre. Keep the engine-agnostic geometry (node
sizing, absolute-center + geometric edge-handle assignment from the
edge-orientation feature) shared across both engines.

## Decisions (from brainstorming)

1. **Two engines, dagre retired.** Selector offers `elk` and `graphviz`;
   `@dagrejs/dagre` and its graph-building are removed. `elkjs` + `@hpcc-js/wasm`
   (latest) are added — server-only deps, like dagre was.
2. **Default engine: `elk`.** `DEFAULT_ENGINE: LayoutEngine = 'elk'`.
3. **Runtime selection, no model change.** Engine is a request parameter to
   `POST /api/layout`; the UI persists the choice in `localStorage`
   (`homelab-layout-engine`). Nothing about the engine is stored in the model.
4. **Agent tools use the default.** The MCP `layout` and `author_diagram` tools
   take **no** engine param; they always use `DEFAULT_ENGINE`. (A user can
   re-Tidy with their selected engine.)
5. **Dispatcher + thin adapters.** Engine-specific placement lives in two
   adapters; all model-convention work (child abs→relative coords, edge-handle
   baking) is centralized in the dispatcher so it is written once.
6. **Drop the collision pass.** The dagre-era pass that nudged ungrouped nodes
   off loosely-sized group boxes is removed — elk/graphviz size groups natively
   (spike: zero node overlaps for both).
7. **Async.** `layoutDiagram` becomes async (both engines are async); the two
   call sites (`handlers.layout`, `authorDiagramOps`) become async.

## Non-goals

- Persisting the engine choice per diagram or in the model (it's runtime-only).
- A third engine or keeping dagre as a hidden option.
- Changing what `orientation` / geometric handle assignment does (reused as-is).
- Adopting each engine's own edge routing (we still draw edges ourselves;
  engines provide node/group placement only).

## Architecture

### Types (`webapp/server/layout.ts`)

```ts
export type LayoutEngine = 'elk' | 'graphviz'
export const DEFAULT_ENGINE: LayoutEngine = 'elk'

// What every engine adapter returns: absolute, top-left-origin boxes.
export interface EngineNode { id: string; x: number; y: number; parentId?: string | null }
export interface EngineGroup { id: string; x: number; y: number; width: number; height: number }
export interface EngineResult { nodes: EngineNode[]; groups: EngineGroup[] }

export type EngineAdapter = (
  diagram: Diagram,
  heightById: Record<string, number>,
) => Promise<EngineResult>
```

Node width is the module constant `W` (180); per-node height is `heightById`
(existing `nodeHeight` = `H` + inline-note height). Adapters do **not** compute
edge handles and do **not** convert to parent-relative coords.

### Adapters

`webapp/server/layout-elk.ts` — `runElk: EngineAdapter`. Ported from the spike
adapter:
- A group is an ELK parent node whose children are its member placements (real
  hierarchy). Root layout options: `elk.algorithm=layered`, `elk.direction=RIGHT`,
  **`elk.hierarchyHandling=INCLUDE_CHILDREN`** (required so cross-group edges
  declared at the root actually affect layout), plus node/layer spacing. Group
  padding echoes a header strip (`elk.padding [top=36,left=16,bottom=16,right=16]`).
- Each leaf node uses `width: W`, `height: heightById[entityId]`.
- Edges filtered to those whose both endpoints are placed entities (this also
  sidesteps the group-targeted-edge case that crashed dagre).
- ELK returns coords relative to the immediate parent; walk the result tree
  accumulating offsets to produce absolute `EngineNode`/`EngineGroup` boxes.

`webapp/server/layout-graphviz.ts` — `runGraphviz: EngineAdapter`. Ported from
the spike adapter:
- Emit DOT: `rankdir=LR`; each group a `subgraph "cluster_<id>"` (the literal
  `cluster` prefix is required) with a label + margin; nodes `fixedsize=true`
  with per-node `width`/`height` in **inches** (`W/72`, `heightById/72`); edges
  filtered to placed→placed.
- `Graphviz.load()` once (lazy, cached module-level promise); `layout(dot,
  'json', 'dot')`. Parse: cluster entries have `bb`, leaf entries have `pos`
  (center). Graphviz coords are points, **Y-up, origin bottom-left** — flip
  every box against the overall graph `bb` height to top-left, Y-down. Map DOT
  ids back to entity/group ids via the object `name`.

### Dispatcher (`webapp/server/layout.ts`)

```ts
export async function layoutDiagram(
  diagram: Diagram,
  engine: LayoutEngine = DEFAULT_ENGINE,
): Promise<{ placements: Placement[]; groups: Group[]; edges: DEdge[] }>
```

Steps:
1. `heightById` from `nodeHeight` per placement (existing helper).
2. `const result = await (engine === 'graphviz' ? runGraphviz : runElk)(diagram, heightById)`.
3. Build `groups: Group[]` from `result.groups` (absolute position + size),
   preserving each group's other fields (`label`, `color`) from `diagram.groups`.
4. Build `placements: Placement[]` by mapping **`diagram.placements`** (to
   preserve `note`/`fieldShow`/`parentId`), setting each `position` from
   `result.nodes` by entityId; for a child (has `parentId` with a known group),
   convert absolute→relative by subtracting the group's absolute position.
   Round coords.
5. `edges` = `assignEdgeHandles(placements, groups, diagram.edges, heightById)`
   — the shared step that computes each node's absolute center
   (`absoluteCenter`, reused from the edge-orientation work) and bakes
   `sourceHandle`/`targetHandle` via `handlesFor(edge.orientation, sCenter,
   tCenter)`. Missing endpoint → edge unchanged.
6. Return `{ placements, groups, edges }`.

The engine-agnostic helpers already in `layout.ts` (`W`, `H`, `noteHeight`,
`nodeHeight`, `absoluteCenter`, `handlesFor`, `HandleId`) stay. `assignEdgeHandles`
is the extraction of the current inline `centerOf`/edges-map so both the
dispatcher path and its tests can call it directly. All dagre code
(`@dagrejs/dagre` import, graph construction, cluster sizing, collision pass) is
removed.

### Call sites (async)

- `webapp/server/mcp.ts` `handlers.layout(store, diagramId, engine = DEFAULT_ENGINE)`
  becomes `async`, `await`s `layoutDiagram(diagram, engine)`, builds the next
  diagram with `laid.placements/groups/edges`, applies via `diffToOps`. The MCP
  `layout` tool callback becomes async and calls it with no engine (default).
- `webapp/server/mcp.ts` `handlers.authorDiagram` / `authorDiagramOps`
  (`webapp/server/authoring.ts`) become `async` (await `layoutDiagram`); the
  `author_diagram` tool callback awaits. No engine param exposed.
- `webapp/vite.config.ts` `POST /api/layout` reads `{ diagramId, engine }`,
  coerces `engine` to a valid `LayoutEngine` (else `DEFAULT_ENGINE`), and
  `await`s `handlers.layout(store, diagramId, engine)`.

### Client (`webapp/src/App.tsx`)

- An engine `<select>` in the diagram toolbar (options **elkjs**, **Graphviz**),
  value from `localStorage['homelab-layout-engine']` defaulting to `'elk'`,
  written on change.
- The existing Tidy handler's `POST /api/layout` body gains `engine: <selected>`.
- No other client change (positions still arrive via SSE and re-seed as today).

## Data flow — one Tidy

1. Client `POST /api/layout { diagramId, engine }` (engine from the selector).
2. Server coerces engine, `await handlers.layout(store, diagramId, engine)` →
   `await layoutDiagram(diagram, engine)` → adapter places nodes/groups →
   dispatcher converts coords + bakes edge handles.
3. `store.apply(diffToOps(model, nextModel), 'mcp')` — one atomic apply (one
   undo step), broadcasts over SSE.
4. Clients reconcile and re-seed the diagram.

## Dependencies

- **Add:** `elkjs`, `@hpcc-js/wasm` (latest; server-only — imported solely by
  the two adapter modules).
- **Remove:** `@dagrejs/dagre` (and its `@types` if present).

Both new libraries run in Node (the dev-server middleware context) and under
vitest — verified by the spike, which ran both via vite-node.

## Testing

Vitest, server-side:

- **`layout-elk.test.ts` / `layout-graphviz.test.ts`** (async): for a small
  diagram with a group of two members plus an ungrouped node and an edge,
  assert every placement got a position, the group box wraps its members
  (member boxes inside the group's bounds), and no two node boxes overlap. For
  graphviz, assert the Y-flip produced top-left/Y-down coords (a member's box is
  within `[group.y, group.y+group.height]`). Include a diagram whose edge
  targets a group id (the dagre-crash case) and assert the adapter does not
  throw and simply ignores that edge.
- **`layout.test.ts`** (dispatcher): `layoutDiagram(diagram, 'elk')` and
  `('graphviz')` each return `{placements, groups, edges}` with baked handles;
  child placements are parent-relative (a grouped node's returned position plus
  its group's position equals the adapter's absolute position); placement
  `note`/`fieldShow` survive; unknown engine string coerces to default at the
  route layer (tested there). Existing `handlesFor`/`absoluteCenter` tests stay;
  add a direct `assignEdgeHandles` test.
- **`authoring.test.ts` / `mcp.test.ts`:** updated for the now-async
  `authorDiagramOps` / `handlers.layout` (await); existing assertions
  (baked handles, orientation) hold under elk. Add a `handlers.layout(store,
  id, 'graphviz')` case asserting it applies without throwing.
- **Route:** `POST /api/layout` with `engine: 'graphviz'`, with an invalid
  engine (→ default), and with no engine (→ default) — via the existing
  route-level check style.

## Files

- Create: `webapp/server/layout-elk.ts`, `webapp/server/layout-graphviz.ts`,
  their tests.
- Modify: `webapp/server/layout.ts` (dispatcher + shared `assignEdgeHandles`;
  remove dagre), `webapp/server/mcp.ts` (async `handlers.layout` + engine
  default), `webapp/server/authoring.ts` (async), `webapp/vite.config.ts`
  (engine param), `webapp/src/App.tsx` (selector + Tidy body), `webapp/package.json`
  (deps).
- Tests: `webapp/server/layout.test.ts`, `webapp/server/authoring.test.ts`,
  `webapp/server/mcp.test.ts`, plus the two new adapter tests.

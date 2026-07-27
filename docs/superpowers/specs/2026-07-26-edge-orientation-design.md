# Edge Orientation (Geometric Handle Assignment) Design

**Status:** Design — approved in brainstorming, pending spec review.
**Branch:** builds on `feat/mcp-server-phase2`.
**Scope:** Piece #1 of two edge improvements. Piece #2 (interactive terminal/endpoint editing) is a separate, later design.

## Problem

Agent-authored (and older) diagrams route edges to the wrong node side. Every
edge without an explicitly-stored handle falls back to `sourceHandle: 'right'`,
`targetHandle: 'left'` in `buildGraph.ts`, regardless of where the two nodes
actually sit. When a node's neighbor is to its left (a "backward" edge), the
line exits the right side and loops back over the box — the "flipped edges"
the user observed (e.g. cam-proxy).

## Goal

During automatic layout, assign each edge's handles to the side **facing the
other node**, computed from the freshly-laid-out geometry — so edges exit
toward their neighbor instead of always right→left. Additionally, let an edge
declare an **orientation** (auto / horizontal / vertical) that the layout
honors, giving the MCP agent (and humans) a way to follow a visual convention:
horizontal for directional flow, vertical for "interacts with" relationships.

## Decisions (from brainstorming)

1. **Baked, not live.** Handles are computed during automatic layout and
   **stored** in the model (persisted via the existing op path), not recomputed
   at render. Rationale: simplest, avoids any canvas-write-back "baking"
   nuance, and Tidy is already a full re-flow.
2. **Orientation is the durable intent; the side follows geometry.** A new
   per-edge `orientation` (`auto` | `horizontal` | `vertical`) constrains the
   **axis**. Within that axis the specific side is always re-derived from the
   node positions on every layout. So a Tidy never clobbers a chosen
   orientation — only the left-vs-right / top-vs-bottom detail tracks the nodes.
3. **Neutral field + documented convention.** `orientation` is a geometric
   routing hint, not a relationship-type label (those were deliberately removed
   earlier). The convention — *horizontal = directional data/request flow
   (I/O); vertical = "interacts with" / peer / side-channel; auto = let layout
   decide* — lives in the MCP tool descriptions as agent guidance. Humans may
   use the field however they like.
4. **Runs wherever automatic layout runs:** Tidy (`POST /api/layout`), the MCP
   `layout` tool, and `author_diagram`. Applied in the same op-batch as the
   node moves → one atomic change, one undo step.

## Non-goals (flagged follow-ups)

- **Layout ranking by orientation.** This piece sets handle *sides* only; it
  does not teach dagre to vertically *stack* `vertical`/peer nodes. A `vertical`
  edge between two nodes dagre placed side-by-side can still route awkwardly
  (loop up/over). Deferred until it proves necessary.
- **Interactive endpoint editing** (dragging terminals, hit-priority for the
  selected edge) — that is piece #2, a separate design.
- **A human UI control for `orientation`** (e.g. an Inspector dropdown) — not
  required now; the field exists and the agent sets it. Can be added later.

## Data model

`webapp/src/model.ts` — add to `DEdge`:

```ts
export type EdgeOrientation = 'auto' | 'horizontal' | 'vertical'

export interface DEdge {
  // …existing fields…
  orientation?: EdgeOrientation // absent = 'auto'
}
```

`normalizeModel` needs no change (the field is optional; absent means `auto`).
No migration: existing edges simply behave as `auto`.

## Handle-assignment algorithm

A pure helper in `webapp/server/layout.ts`. Inputs: the laid-out `placements`
and `groups` (absolute group positions), the diagram's `edges`, and node sizes.

**Absolute center of an entity's node:**
- width = `W` (180); height = the same per-node height the layout already
  computes (`H` + inline-note height).
- If the placement has a `parentId` with a known group: center =
  `group.position + placement.position + (W/2, height/2)` (child coords are
  parent-relative).
- Else: center = `placement.position + (W/2, height/2)`.

**Per edge**, with source center `S` and target center `T`, `dx = T.x - S.x`,
`dy = T.y - S.y`:

1. **Axis:**
   - `orientation === 'horizontal'` → `axis = 'h'`
   - `orientation === 'vertical'` → `axis = 'v'`
   - otherwise (`auto`/absent) → `axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'` (tie → horizontal)
2. **Sides:**
   - `axis === 'h'`: `sourceHandle = dx >= 0 ? 'right' : 'left'`, `targetHandle = dx >= 0 ? 'left' : 'right'`
   - `axis === 'v'`: `sourceHandle = dy >= 0 ? 'bottom' : 'top'`, `targetHandle = dy >= 0 ? 'top' : 'bottom'`
3. If either endpoint has no laid-out node (edge references a missing
   placement), leave that edge's handles unchanged.

The helper returns the diagram's edges with `sourceHandle`/`targetHandle` set
(other edge fields untouched).

## Layout integration

`layoutDiagram(diagram)` in `webapp/server/layout.ts` currently returns
`{ placements, groups }`. Extend it to also return `edges`:

```ts
export function layoutDiagram(diagram: Diagram): {
  placements: Placement[]
  groups: Group[]
  edges: DEdge[]
}
```

`edges` are `diagram.edges` with recomputed handles (using the freshly-computed
`placements`/`groups` for centers). Pure — does not mutate `diagram`.

## Application seams (no new persistence path)

Both existing layout call sites build their next diagram from the result and
persist via `diffToOps`; just include `edges`:

- `webapp/server/mcp.ts` `handlers.layout`:
  ```ts
  const laid = layoutDiagram(diagram)
  const nextDiagram = { ...diagram, placements: laid.placements, groups: laid.groups, edges: laid.edges }
  store.apply(diffToOps(model, nextModel), 'mcp')
  ```
- `webapp/server/authoring.ts` `authorDiagramOps`: apply `laid.edges` to the
  cloned diagram (alongside placements) before `diffToOps`.

`diffToOps` already emits `edge.update` patches for changed handles, so the new
handles persist and broadcast over SSE with no other change. Because it is one
`store.apply`, a Tidy or author remains a single undo step.

## MCP surface

`webapp/server/mcp.ts` — the edge-carrying tools accept an optional
`orientation`:

- `author_diagram`: each edge tuple's attrs object gains
  `orientation?: 'auto' | 'horizontal' | 'vertical'`.
- `connect` and `set_edge`: add `orientation` to their edge-attrs zod shape
  (the same closed shape that already carries `label`/`dir`/`color`).

`authoring.ts` copies `orientation` onto the `DEdge` it builds. `set_edge`/
`connect` write it onto the edge.

**Tool-description convention text** (added to the relevant tool/param docs):

> `orientation` controls which sides an edge connects to once the diagram is
> laid out: `horizontal` (left↔right) for directional data/request flow — an
> input/output pipeline; `vertical` (top↔bottom) for "interacts with" / peer /
> side-channel relationships; `auto` (default) lets the layout pick the side
> nearest the other node. The exact side is always chosen by geometry; this
> only fixes the axis.

## Render

No change required in `buildGraph.ts`: it already renders each edge on its
stored `sourceHandle`/`targetHandle`, and edges that have never been laid out
keep the existing right→left fallback. `orientation` affects only layout, not
render.

## Testing

Vitest, server-side (pure functions — no browser):

- **Handle heuristic** (`server/layout.test.ts`), asserting exact
  `sourceHandle`/`targetHandle`:
  - `auto`, target to the right → source `right`, target `left`.
  - `auto`, target to the left (backward edge, the cam-proxy case) → source
    `left`, target `right`.
  - `auto`, target below → source `bottom`, target `top`; target above →
    `top`/`bottom`.
  - `orientation: 'horizontal'` with nodes stacked vertically → still
    `right`/`left` (side chosen by relative x).
  - `orientation: 'vertical'` with nodes side-by-side → still `top`/`bottom`.
  - A child node inside a group: center uses the group offset (assert the side
    is correct relative to a node outside the group).
- **`layoutDiagram`** returns `edges` whose handles match the heuristic for a
  small multi-node diagram including a backward edge.
- **`authorDiagramOps`** bakes handles: authoring a spec with a backward edge
  yields ops that set the expected handles; `orientation` from the spec lands
  on the edge.
- **MCP schema:** `connect`/`set_edge`/`author_diagram` accept and store
  `orientation`; an invalid value is rejected by the zod shape.

## Files

- `webapp/src/model.ts` — `EdgeOrientation` type + `DEdge.orientation`.
- `webapp/server/layout.ts` — handle helper + `layoutDiagram` returns `edges`.
- `webapp/server/mcp.ts` — `handlers.layout` includes `laid.edges`;
  `connect`/`set_edge` schemas + `orientation` handling; tool-description
  convention text.
- `webapp/server/authoring.ts` — carry `orientation`; apply `laid.edges`.
- Tests: `webapp/server/layout.test.ts`, `webapp/server/authoring.test.ts`,
  `webapp/server/mcp.test.ts`.

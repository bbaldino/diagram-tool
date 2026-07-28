# Edge remapping — design

**Status:** Approved (design), pending implementation plan.
**Date:** 2026-07-28
**Branch:** `feat/edge-remapping` (off `main`).

## Problem

Edge endpoints are effectively immutable: once a line connects node A → node B, there's no
way to drag an end to a different node. React Flow supports this natively; we just never wired
it. The friction shows up whenever a connection was drawn to the wrong node or the diagram is
rearranged.

## Approach

Use React Flow v12's built-in reconnection (`onReconnect` / `onReconnectStart` /
`onReconnectEnd`, per-edge `reconnectable`, and the `reconnectEdge` helper). **No model
changes**: the canvas→model write-back (`edgesToDEdges` in `App.tsx`) already maps
`edge.source/target → DEdge.from/to` and `sourceHandle/targetHandle`, so a reconnect persists
for free, undoes as a single step, and streams over SSE like any other edit. `reconnectEdge`
preserves the edge's `id`, so flow references and the edge's identity survive a rewire (the
id's embedded `from-to` substring goes cosmetically stale, but ids are opaque — acceptable).

## Design

### 1. Reconnect wiring (`webapp/src/App.tsx`)

- `onReconnect(oldEdge, newConnection)`: update edge state via `reconnectEdge(oldEdge,
  newConnection, edges)`, and in the same update **clear the reconnected edge's `data.points`**
  (manual waypoints) so the rewired edge gets a clean route instead of doglegs shaped for the
  old geometry.
- **Revert on drop-to-empty**, via the standard ref pattern:
  - `onReconnectStart` → set `reconnectSuccessful.current = false`.
  - `onReconnect` → set `reconnectSuccessful.current = true` (and apply the change).
  - `onReconnectEnd` → if `!reconnectSuccessful.current`, do nothing; React Flow leaves the
    edge unchanged (reverts). No accidental deletion.

### 2. Select-first + z-raised anchors (overlap solution)

The problem: when many edges terminate at the same node, their endpoints stack and you can't
grab the right one.

- Reconnect anchors are live **only on the selected edge**: derive each edge's `reconnectable`
  from its `selected` state (unselected edges' endpoints are not grabbable and don't clutter
  shared nodes).
- Enable React Flow's `elevateEdgesOnSelect` so the selected edge — and its endpoint anchors —
  render **above** the other edges landing on the same node. That's what lets you pick the
  right endpoint out of a bundle: select the edge, then its endpoint sits on top and is
  grabbable.

### 3. WaypointEdge integration risk (`webapp/src/WaypointEdge.tsx`)

`WaypointEdge`'s selected mode renders an invisible full-width strip for "click the line to add
a waypoint," which overlaps the endpoint regions. The reconnect anchors are rendered by React
Flow core (above the edge body), but the plan must ensure they win the pointer at the very
ends — inset/shrink the waypoint-add strip away from the endpoints if it intercepts anchor
drags — so grabbing an end reconnects rather than dropping a waypoint.

### 4. Behavior summary

- Select edge → drag either endpoint → drop on another node (or a specific side-handle) → edge
  rewires, waypoints cleared, persisted and undoable as one step.
- Drop on empty canvas → reverts; edge unchanged (its label/type/description preserved).
- Self / same-node reconnect → whatever React Flow does by default; not special-cased.

## Out of scope / deferred

- **Detached ("dangling") endpoints** — dropping an end on empty space and having it *stay*
  there as a draggable placeholder that preserves the edge. React Flow edges must connect two
  nodes, so this needs an anchor-node subsystem (invisible placeholder node created on drop,
  draggable, swept when the end is later reattached to a real node — same shape as ad-hoc
  entity cleanup) plus its model representation. It's a separate feature with its own spec, to
  be revisited only if living with revert-on-empty proves too limiting.
- No model/schema changes in this feature.
- No change to edge creation (`onConnect`), templates, or MCP.

## Testing

- **Unit:** a reconnected edge (changed `source`/`target`) round-trips through the write-back
  to `DEdge.from/to` with `data.points` cleared.
- **Browser (Playwright):**
  - Select an edge, drag an endpoint to a different node → edge rewires and persists.
  - Manual waypoints are cleared by a reconnect.
  - Drop an endpoint on empty canvas → reverts, edge unchanged.
  - With several edges sharing a node, selecting one makes its endpoint grabbable above the
    others (z-raised anchor).

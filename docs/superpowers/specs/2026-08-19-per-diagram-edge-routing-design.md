# Per-Diagram Edge Routing — Design

**Date:** 2026-08-19
**Branch:** `edge-routing-experiments`

## Goal

Let each diagram choose how its edges are routed — the existing ELK **waypoint**
routes or the new A\* **pathfinding** router — and, for pathfinding, tune the
routing knobs. Settings live in a per-diagram "Diagram Settings" dialog, persist
in the model, and fall back to a fixed default when a diagram hasn't overridden
them. The purpose is experimentation: run the same content through different
routers across diagrams to learn what works, before committing to (or pruning)
options later.

## Background

Two things route an edge's *line* (both rely on ELK/Graphviz to *place* the
nodes first):

- **Waypoint edge** (`WaypointEdge`, current default): draws ELK's precomputed
  orthogonal route stored on the edge (`edge.points`). Supports manual
  waypoint/label dragging, labels, arrowheads, color/dashed. Routes go stale on
  node drag until re-Tidy.
- **Smart edge** (`SmartTestEdge`, the demo): ignores ELK's route and recomputes
  the line live with A\* pathfinding on current node positions. Re-routes on
  drag. Currently a stripped demo — forwards `style` and `markerEnd` (so
  color/dashed and the end arrowhead already work) but renders **no label** and
  no `markerStart`.

Today `buildGraph` force-sets every edge to `'smart'`, and a throwaway top-right
`RoutingKnobsPanel` drives a global in-memory `routingKnobs` store. This feature
replaces that global/forced wiring with per-diagram, persisted settings.

## Approach: fixed default baseline + per-diagram override (Approach A)

The default routing config is a **constant in code** (`DEFAULT_ROUTING`). Each
diagram optionally stores its own full config on `Diagram.routing`; absent →
use `DEFAULT_ROUTING`. The dialog edits the diagram's config and can reset it
back to the default. Editable/saved global defaults (Approach B) and a model-wide
settings concept are explicitly out of scope for now.

## Global Constraints

- Prettier config: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`.
- Do not regress the existing suite (651 tests at design time).
- Work stays on `edge-routing-experiments`; nothing pushed.
- **Default `router` is `'waypoint'`** — existing behavior is preserved and
  pathfinding is strictly opt-in per diagram. Switching a diagram to pathfinding
  never mutates its stored `edge.points`; the smart edge simply ignores them, so
  toggling back to waypoint restores the prior routing.

## Data Model

Add to `shared/model.ts`:

```ts
export type EdgeRouter = 'waypoint' | 'pathfinding'
export type PathAlgo = 'no-diagonal' | 'diagonal' | 'jump-point'
export type DrawStyle = 'stepped' | 'straight' | 'smoothstep' | 'spline'

export interface PathfindingConfig {
  algo: PathAlgo
  draw: DrawStyle
  gridRatio: number
  nodePadding: number
  eps: number
  obstacleGroups: boolean
  obstacleNotes: boolean
  directSkip: boolean
}

export interface DiagramRouting {
  router: EdgeRouter
  pathfinding: PathfindingConfig // always present; used when router==='pathfinding'
}
```

- `Diagram` gains an optional `routing?: DiagramRouting`.
- `DEFAULT_ROUTING: DiagramRouting` constant (in `shared/model.ts`):
  `router: 'waypoint'`, and `pathfinding` seeded with the combo that tested well:
  `{ algo: 'jump-point', draw: 'smoothstep', gridRatio: 12, nodePadding: 17,
  eps: 8, obstacleGroups: false, obstacleNotes: false, directSkip: false }`.
- `effectiveRouting(diagram): DiagramRouting` helper returns
  `diagram.routing ?? DEFAULT_ROUTING`.
- The `PathAlgo`/`DrawStyle`/`PathfindingConfig` currently defined in
  `src/routingKnobs.ts` move to `shared/model.ts` and are imported from there, so
  client and model share one definition.

## Persistence

- New op in `shared/ops.ts`: `{ t: 'diagram.setRouting'; diagramId: string;
  routing: DiagramRouting }` (mirrors `diagram.rename`). Applying it sets
  `diagram.routing`.
- Store handles the op like the other `diagram.*` ops → writes `model.json` →
  broadcasts over SSE, so other clients update.
- A `null`/reset action stores `DEFAULT_ROUTING` explicitly (keeps the field
  present and simple; "reset" == "set to the default constant").

## Client store & live preview

`src/routingKnobs.ts` is repurposed from a global singleton to the **active
diagram's live routing config**:

- Seeded from the active diagram's `effectiveRouting` whenever the active diagram
  changes.
- The dialog edits this store, so edges **re-route live** as sliders move (same
  instant feel as the demo panel), with no model write per tick.
- On **Apply/Close**, the store's current value is committed to the model via
  `diagram.setRouting`. Cancel reverts the store to the last-committed value.

`SmartTestEdge` continues to read the knobs from this store.

## Edge rendering

- `buildGraph` selects the edge type from the diagram's `effectiveRouting.router`:
  `'pathfinding' → 'smart'`, else `'waypoint'`. Removes the hardcoded
  `edge.type = 'smart'` force.
- **Smart-edge parity:** add label rendering and `markerStart` to
  `SmartTestEdge`, reusing `WaypointEdge`'s label approach (`EdgeLabelRenderer`
  + a hidden measurement path positioned by `data.labelPos`). Result: a
  pathfinding diagram shows labels and both arrowheads, matching waypoint edges
  except for manual editing.
- Deferred (not in this feature): dragging waypoints/labels on smart edges;
  `getSmartEdgeWaypoints` support.

## UI: Diagram Settings dialog

- New `DiagramSettingsDialog.tsx` built on the existing `DialogShell` pattern
  (as `ImportDialog`/`OpenDiagramDialog`).
- Opened from a new **"Diagram settings…"** item added in `src/menus.ts` (under
  the **Edit** menu), wired through the same menu-dispatch path App already uses
  for menu items; App holds an `openRoutingDialog` boolean like the existing
  `openDialog` state.
- Contents:
  - **Router** radio: `Waypoint (ELK)` / `Pathfinding (A*)`.
  - When Pathfinding is selected, show the knob controls (moved out of
    `RoutingKnobsPanel` into a reusable `PathfindingControls` component):
    algorithm, draw, grid, padding, simplify, obstacle toggles, straight-when-clear.
  - **Reset to defaults** button (sets the store to `DEFAULT_ROUTING`).
  - Footer: **Apply** (commit + close) / **Cancel** (revert + close). Dismissing
    the dialog any other way (Esc, backdrop, X) behaves as **Cancel** — the store
    reverts to the last-committed value so a previewed-but-unapplied change does
    not silently persist.
- Edits preview live on the canvas behind the dialog.

## Cleanup

- Delete the throwaway `RoutingKnobsPanel` and its top-right `Panel` mount in
  `App.tsx`. The knob controls live on in `PathfindingControls`, used by the
  dialog.

## Testing

- `shared/model` (or a small `routing.test.ts`): `effectiveRouting` returns the
  override when present and `DEFAULT_ROUTING` when absent; `DEFAULT_ROUTING`
  shape matches `DiagramRouting`.
- `shared/ops` apply: `diagram.setRouting` sets `diagram.routing`; unrelated
  diagrams untouched.
- `buildGraph`: edge type is `'waypoint'` when router is waypoint (or unset) and
  `'smart'` when pathfinding.
- Smart-edge label: given `label` + `labelPos`, a label element renders (jsdom).

## Out of scope / deferred

- Editable, saved global defaults (Approach B) and any model-wide settings object.
- Manual waypoint/label dragging on pathfinding edges.
- MCP tool control of per-diagram routing.
- Per-diagram configuration for waypoint mode (it has none; uses ELK routes as
  today).

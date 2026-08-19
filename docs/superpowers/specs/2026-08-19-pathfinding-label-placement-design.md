# Pathfinding Edge Label Placement — Design

**Date:** 2026-08-19
**Branch:** `edge-routing-experiments`

## Goal

Stop pathfinding-edge labels from stacking on top of each other. Two parts: an
**automatic de-collision pass** that spreads overlapping labels, and **manual
placement** (drag) that pins a label where the user wants it. Scope is
**pathfinding (smart) edges only** — waypoint labels stay exactly as ELK/Tidy
places them.

## Background

Pathfinding edges (`SmartTestEdge`) render their label at a fraction `labelPos`
(default 0.5 = path midpoint) with no awareness of other labels, so two edges
routed near each other stack their labels. Waypoint edges already get label
spacing from ELK during Tidy and support on-line label dragging; this design does
not change them. `Edge` already has `label?` and `labelPos?`; label position is
plumbed `buildGraph` (`edge.data.labelPos`) → `canvasData` (AppEdge data) →
`canvasToModel` (persist) and mutated via the existing `edge.update` op.

## Approach

- **Manual placement** gives each pathfinding label a free 2-D position expressed
  as `labelPos` (anchor along the path) + `labelOffset` (a small vector off the
  path). A dragged label is **pinned** and **persisted**; the auto pass never
  touches a pinned label.
- **Auto de-collision** computes an **ephemeral** placement (`labelPos` + offset)
  for every *unpinned* pathfinding label, held in a client-only store and
  recomputed when routes change — never written to the model, so it can't fight
  live re-routing or get flushed to disk.
- The placement math is a **pure, DOM-free resolver** (unit-tested); the
  measure→place render loop and drag are DOM-measurement-bound (manual-verified,
  as the label rendering itself already is).

## Global Constraints

- Prettier: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`.
- Do not regress the suite (661 tests at design time). Work stays on
  `edge-routing-experiments`; nothing pushed.
- Only capitalize the first letter of multi-letter acronyms in identifiers.
- Waypoint-edge label behavior is unchanged.
- Auto-computed placement is never persisted to the model; only user drags are.

## Data Model

`shared/model.ts` — add to `Edge` (both optional):

```ts
  labelOffset?: { x: number; y: number } // offset from the on-path anchor, in canvas/flow units (zoom-independent); absent = {0,0}
  labelPinned?: boolean                   // true = user placed the label; auto de-collision skips it
```

- `src/canvasData.ts` `AppEdge` data type gains `labelOffset?` and `labelPinned?`.
- `src/buildGraph.ts` passes `labelOffset: de.labelOffset` and
  `labelPinned: de.labelPinned` into `edge.data` (next to the existing
  `labelPos`).
- `src/canvasToModel.ts` persists `labelOffset: e.data?.labelOffset` and
  `labelPinned: e.data?.labelPinned` (next to the existing `labelPos`).
- Manual drag writes these via the existing `edge.update` op (through the normal
  canvas→model flush). No new op.

## Pure resolver — `src/labelDeoverlap.ts`

DOM-free so it is unit-testable. Geometry is supplied as functions so the resolver
never touches the DOM.

```ts
export interface LabelPlacement {
  labelPos: number
  offset: { x: number; y: number }
}
export interface LabelInput {
  id: string
  width: number
  height: number
  pinned: boolean
  placement: LabelPlacement // starting placement (pinned = fixed; unpinned = seed, usually {0.5,{0,0}})
  anchorAt: (t: number) => { x: number; y: number } // point at fraction t along this edge's path
  normalAt: (t: number) => { x: number; y: number } // unit normal (perpendicular) at t
}
export interface Rect { x: number; y: number; width: number; height: number }
export interface DeoverlapOpts {
  minPos?: number // clamp lower bound, default 0.2
  maxPos?: number // clamp upper bound, default 0.8
  maxOffset?: number // max |offset|, default 28
  iterations?: number // default 24
}
export function resolveLabelPlacements(
  labels: LabelInput[],
  nodeBoxes: Rect[],
  opts?: DeoverlapOpts,
): Map<string, LabelPlacement> // one entry per UNPINNED label
```

Algorithm (deterministic; iterate labels in `id` order for stable output):

1. Each label's box at a placement: center = `anchorAt(labelPos)` + `offset`;
   rect = center ± {width/2, height/2}.
2. Pinned labels and `nodeBoxes` are static obstacles; only unpinned labels move.
3. For up to `iterations` rounds: for each overlapping pair (unpinned vs any
   obstacle/other label), first **slide** — step each unpinned label's `labelPos`
   along its line in the direction that reduces overlap (clamped to
   `[minPos,maxPos]`). If a pair is still overlapping after the slide step (their
   lines are near-coincident, so sliding can't separate them), **offset** — step
   each unpinned label along its `normalAt(labelPos)` in opposite directions
   (magnitude clamped to `maxOffset`). Stop early when no overlaps remain.
4. Return the final placement for each unpinned label.

Unit tests use straight-line `anchorAt`/`normalAt` (e.g. horizontal line →
`normalAt` = (0,1)) so the math is exercised without a DOM.

## Ephemeral store — `src/labelPlacement.ts`

Client-only, mirrors the `routingKnobs` external-store pattern:

```ts
export function setLabelPlacements(map: Map<string, LabelPlacement>): void
export function getLabelPlacement(id: string): LabelPlacement | undefined
export function useLabelPlacement(id: string): LabelPlacement | undefined // useSyncExternalStore
```

Holds the auto pass's latest output. Never read by `canvasToModel`, so auto
placement cannot be persisted.

## Coordinator hook — `src/useLabelDeoverlap.ts`

`useLabelDeoverlap(active: boolean)` runs at the canvas level (it must see all
labels at once):

- No-op unless `active` (the active diagram uses the pathfinding router).
- In a layout effect keyed on the edges/route version: for every `.wp-label` on a
  `.react-flow__edge-smart`, read its measured box (`getBoundingClientRect`, →
  flow units) and build `anchorAt`/`normalAt` from the edge's rendered
  `path.react-flow__edge-path` (`getPointAtLength`; normal = perpendicular of the
  tangent). Skip pinned edges (use their persisted placement as a static
  obstacle). Gather service-node boxes for `nodeBoxes`.
- Call `resolveLabelPlacements`, then `setLabelPlacements(result)`.
- Re-runs when routes change (node drags) so labels re-spread live.

## `SmartTestEdge` changes

- **Placement source:** if `data.labelPinned` → use `data.labelPos` +
  `data.labelOffset` (persisted); else → `useLabelPlacement(id)` (auto); else
  fallback `{labelPos: 0.5, offset: {0,0}}`.
- **Render:** position the `.wp-label` at `anchorAt(labelPos)` + `offset` (extend
  the existing measure-path label logic to add the offset).
- **Drag:** reuse `WaypointEdge`'s label-drag interaction (label draggable only
  when the edge is selected). On drag, compute the nearest `labelPos` on the path
  and the perpendicular `labelOffset` from the cursor to that anchor, and
  `setEdges` to write `{labelPos, labelOffset, labelPinned: true}` into the edge —
  which persists through the normal flush.
- **Unpin:** double-click the label clears `labelPinned`/`labelOffset` (back to
  auto), mirroring `WaypointEdge`'s double-click-to-remove-waypoint affordance.

## App wiring

`App.tsx` calls `useLabelDeoverlap(activeRouting.router === 'pathfinding')` inside
the canvas (`Flow`) component, so the pass runs only for pathfinding diagrams.

## Testing

- `labelDeoverlap.test.ts` (pure): two overlapping labels on parallel-but-offset
  lines end up non-overlapping; a pinned label is never moved and unpinned labels
  route around it; near-coincident lines trigger a perpendicular offset; `labelPos`
  stays within `[minPos,maxPos]` and `|offset|` within `maxOffset`; a label is
  pushed out of a `nodeBox`.
- Model/plumbing: `buildGraph` passes `labelOffset`/`labelPinned` into edge data;
  `canvasToModel` persists them (extend existing tests if present).
- Manual (browser): drag a pathfinding label → it moves, stays put on reload
  (pinned/persisted); the two overlapping Raven Core labels separate automatically
  when the diagram is on pathfinding; a node drag re-spreads labels live;
  double-click a pinned label returns it to auto.

## Out of scope / deferred

- Any change to waypoint-edge label behavior or to ELK's label placement.
- Persisting auto-computed placements.
- Bending pathfinding *lines* by dragging waypoints (separate, discussed and
  declined for now).
- Feeding labels to the A\* router as obstacles (`avoidAreas`) — different symptom.

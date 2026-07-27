# Draggable Edge Labels (Along the Path) Design

**Status:** Design — approved in brainstorming, pending spec review.
**Branch:** builds on `feat/mcp-server-phase2`.

## Problem

An edge's label always sits at the path midpoint. When two edges run between
the same pair of nodes (or a label overlaps a node/another label), there's no
way to move the label out of the way. The user wants to drag a label to a
different point **along its edge**, keeping it anchored to the line.

## Goal

Let a user drag an edge's label to reposition it **along the edge path**. The
label stays anchored to the line (it can only slide along the path, not float
off it), its position is stored as a fraction of the path length, and it
persists.

## Decisions (from brainstorming)

1. **Along-the-path only (1-D).** The label position is a single fraction
   `t ∈ [0,1]` of the path length; the label always renders exactly on the
   line. (Free 2-D positioning is an anticipated *future* step — see Future.)
2. **Selection-gated dragging.** The label is only draggable when its edge is
   selected — same interaction model as the existing waypoint dots. Unselected
   labels stay non-interactive (`pointer-events: none`), as today.
3. **Shape-agnostic placement** via the browser SVG path API
   (`getPointAtLength`), so it works identically for straight / bezier /
   catmull / waypoint paths.
4. **Persisted** on the edge via the existing op/diff pipeline (no new
   persistence path, no migration).

## Data model

`webapp/src/model.ts` — add to `DEdge`:

```ts
labelPos?: number // fraction along the path in [0,1]; absent = 0.5 (midpoint)
```

`normalizeModel` needs no change (optional field; absent means midpoint).
Existing edges have no `labelPos` and render at the midpoint exactly as before.

## Rendering (`webapp/src/WaypointEdge.tsx`)

Today `edgePath(...)` returns `[d, labelX, labelY]` where the label point is the
midpoint of the middle segment (waypoint paths) or `getBezierPath`'s label
point. Replace the label-point computation with a **fraction-of-length** point
on the actual path `d`:

- Keep a hidden measurement `<path ref={measureRef} d={d} … />` (no stroke,
  `pointer-events: none`) so we can call the SVG geometry API on the exact
  rendered path. (`BaseEdge` renders the visible path; a separate measurement
  path avoids depending on its internal ref.)
- Compute the label point in a layout effect / on render:
  `const total = measureRef.current.getTotalLength(); const pt =
  measureRef.current.getPointAtLength(clamp(labelPos ?? 0.5, 0, 1) * total)`.
  Use `pt.x`/`pt.y` (flow coords, since `d` is authored in flow coords) as the
  label transform origin, replacing `labelX`/`labelY`.
- `getPointAtLength` requires the path to be in the DOM and `d` set; guard for
  the first render (fall back to the current midpoint until the ref/length is
  available).

`edgePath` still returns a fallback `labelX/labelY` (used only until the
measurement path is available), so nothing breaks if the SVG API is momentarily
unavailable.

## Dragging (selected edges only)

Mirror the existing waypoint-dot drag in `WaypointEdge`:

- When `selected`, the `.wp-label` gets `pointer-events: all` and `cursor: grab`
  (a CSS rule scoped to a `selected` modifier / inline style; unselected keeps
  `pointer-events: none`).
- `onPointerDown` on the label: `e.stopPropagation()` (so it doesn't start a
  pane pan, change selection, or hit the add-waypoint click path),
  `setPointerCapture`, mark a `draggingLabel` ref true.
- `onPointerMove`: convert the pointer to flow coords
  (`screenToFlowPosition`), then find the nearest point on the path by
  **sampling** it — e.g. `N = 100` samples `getPointAtLength(i/N * total)`,
  pick the `i` minimizing squared distance to the pointer; `t = i / N`. Update
  the edge's `data.labelPos = t` live via `setEdges` (same pattern as the
  waypoint `setPoints`).
- `onPointerUp`: release capture, clear `draggingLabel` (with the same brief
  timeout the waypoint drag uses so a trailing click is ignored). The debounced
  canvas write-back persists `labelPos`.
- The label is never placed off the path: we only ever store `t` and render via
  `getPointAtLength(t)`, so it stays anchored and simply slides.

Sampling at N=100 is smooth enough for this use and cheap (a handful of
`getPointAtLength` calls per move). No refinement pass needed.

## Plumbing (data in/out)

- `webapp/src/buildGraph.ts`: include `labelPos` in the edge's `data`
  (`data: { ...edge.data, shape: …, points: …, labelPos: de.labelPos }`).
- `webapp/src/App.tsx` `edgesToDEdges`: carry it back —
  `labelPos: (e.data as any)?.labelPos`.
- `webapp/src/diff.ts` / `ops.ts`: no change. Edges are diffed by value
  (`diffById` → `changed`), so a `labelPos` change emits an `edge.update`
  patch, and `updateEdge` spreads it — `labelPos` persists and streams over SSE
  like any other edge field.

## Testing

The projection depends on the browser SVG API (`getPointAtLength`), which isn't
available in the vitest/node environment, and `WaypointEdge` is a React
component with no unit-test harness — so this is **browser-verified**,
consistent with the existing waypoint-drag / edge work:

- **tsc** clean; the full vitest suite stays green (no server/model logic
  changes beyond the optional `labelPos` field and passthrough).
- **Playwright:**
  1. Select an edge with a label; drag the label toward one end → it slides
     along the path and stays on the line (its rendered position tracks a
     point on the path, not the free pointer position).
  2. Release → `labelPos` is persisted (visible in `GET /api/model` as a value
     in `(0,1)` other than the default) and survives a reload.
  3. An unselected edge's label is not draggable (pointer-events none).
  4. A label drag does not add a waypoint or pan the canvas.

## Out of scope / Future

- **Free 2-D label position (anticipated next step).** If along-the-path feels
  too constrained, the natural evolution is: drag the label anywhere, and store
  a perpendicular offset *in addition to* the along-path anchor `t`. That is a
  strict superset of this design — it keeps `labelPos` as the anchor and adds
  an offset field (e.g. `labelOffset?: { dx: number; dy: number }` relative to
  the anchor point), so nothing built here is discarded. Not built now.
- Per-label styling, multi-line labels, or auto-avoidance of overlaps.
- Auto-separating parallel edges (the user chose manual waypoints for that).

## Files

- Modify: `webapp/src/model.ts` (`DEdge.labelPos`), `webapp/src/WaypointEdge.tsx`
  (fraction-of-length label placement + label drag), `webapp/src/buildGraph.ts`
  (pass `labelPos` into edge data), `webapp/src/App.tsx` (`edgesToDEdges`
  carries `labelPos`), `webapp/src/index.css` (`.wp-label` interactive when
  selected).

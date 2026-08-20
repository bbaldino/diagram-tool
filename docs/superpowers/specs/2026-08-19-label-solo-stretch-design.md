# Attribution-Aware Label Placement (Solo Stretch) — Design

**Date:** 2026-08-19
**Branch:** `edge-routing-experiments`

## Goal

Make pathfinding-edge labels attributable when lines bundle: place each label on
the stretch of its own path where it runs **alone** (not coincident with other
edges) — naturally the part near its unique endpoint — instead of the geometric
midpoint (which often lands inside a bundle). Keeps pathfinding's line routing
untouched (no re-routing). Builds on the existing label placement feature.

## Background

`useLabelDeoverlap` (canvas coordinator) already measures every smart-edge label
and its path, seeds each label a starting `labelPos`, runs `resolveLabelPlacements`
(the pure de-collision resolver in `labelDeoverlap.ts`) to spread overlapping
labels, and writes results to the ephemeral `labelPlacement` store that
`SmartTestEdge` renders from. Today the seed `labelPos` is the label's last-rendered
value (or 0.5). This feature changes the **seed** to the center of the edge's
longest solo stretch.

Confirmed by measurement earlier: the diagram's long overlaps are edges sharing an
endpoint (converging on one node) — acceptable as lines, but their labels sit in
the coincident stretch and become ambiguous. The solo stretch is the non-coincident
part (near the edge's other, unique end), which is where the label belongs.

## Global Constraints

- Prettier: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`.
- Do not regress the suite (675 tests at design time). Branch `edge-routing-experiments`; nothing pushed.
- Pathfinding-edge labels only; waypoint edges untouched. No re-routing.
- Only capitalize the first letter of multi-letter acronyms in identifiers.

## Pure core — `soloLabelPos` (in `src/labelDeoverlap.ts`)

Add alongside the existing `Pt`/`distToSeg`/`resolveLabelPlacements` (reuses `distToSeg`):

```ts
export function soloLabelPos(path: Pt[], others: Pt[][], threshold = 8): number
```

- Returns a fraction in `[0,1]`: the position along `path` at the **center of the
  longest contiguous run of points that are farther than `threshold` from every
  polyline in `others`**.
- Falls back to `0.5` when `path` has < 2 points or has no solo run (coincident
  end-to-end).

Algorithm:
1. For each point `path[i]`, it is "solo" iff `min over o in others of
   pointToPolyline(path[i], o) > threshold`. `pointToPolyline` = min `distToSeg`
   over the polyline's segments (Infinity for a polyline with < 2 points).
2. Find the longest contiguous run of solo points; let it span indices
   `[start, start+len-1]`.
3. Return `(start + (len-1)/2) / (path.length - 1)`; `0.5` if `len === 0`.

Deterministic, DOM-free, unit-tested.

## Coordinator wiring — `src/useLabelDeoverlap.ts`

- After collecting the smart edges, sample each edge's rendered path into a point
  array (flow coords via `getPointAtLength`, ~every few px), keyed by edge id —
  reuse the same path element the hook already reads for `anchorAt`.
- For each **unpinned** label, compute
  `soloLabelPos(points[id], [all other edges' point arrays])` and use it as that
  label's **seed `labelPos`** in the `LabelInput.placement` handed to
  `resolveLabelPlacements` (replacing today's data-`labelPos` seed). Keep
  `offset` seed at `{0,0}` (or the current). Pinned labels keep their placement
  unchanged (still excluded from movement by the resolver).
- Everything downstream (resolver de-collision, store write, `SmartTestEdge`
  render) is unchanged.

Effect: labels start on their solo stretch; the de-collision then spreads any that
still overlap. (When two labels' solo spots collide, de-collision may nudge one off
its solo stretch — accepted for v1.)

## Testing

- `labelDeoverlap.test.ts` (pure): 
  - a lone edge (empty `others`) → `0.5`;
  - an edge coincident with another along its RIGHT half → returns a fraction in
    the LEFT/solo region (`< 0.4`);
  - coincident along its LEFT half → `> 0.6`;
  - fully coincident (identical `others`) → `0.5` fallback;
  - `threshold` respected (a near-but-beyond-threshold other still leaves the edge solo).
- Coordinator + render are DOM-measurement bound → **manual** (Raven Core,
  pathfinding): labels on edges that converge to a shared node move toward each
  edge's distinct end, so you can tell which line each label belongs to; dragging a
  node keeps it sensible (re-runs); a pinned (dragged) label stays where placed.

## Out of scope / deferred

- Re-routing to *create* a solo stretch when none exists (the coupled routing+label
  problem) — v1 only relocates the label along the existing path.
- A user-facing threshold knob (hardcoded `8` for now).
- Any change to waypoint-edge labels or to routing.

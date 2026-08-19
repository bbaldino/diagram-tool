# Edge-Aware Routing (Cheap Probe) — Design

**Date:** 2026-08-19
**Branch:** `edge-routing-experiments`

## Goal

Reduce **parallel overlap** on pathfinding edges — different edges funneling into
the same corridor and stacking on top of one another mid-route. This is a
deliberately cheap first attempt ("probe"): route pathfinding edges **sequentially**
and make each later edge avoid the corridors already taken, so shared channels
spread into distinct lanes. Reuses the existing `getSmartEdge` pipeline (no custom
router). It is opt-in per diagram via a tunable strength; strength 0 = today's
behavior. We build it to **evaluate live** — if the hard-avoidance detours look bad,
that's the signal to graduate to a weighted router later (out of scope here).

## Background

Today each `SmartTestEdge` calls `getSmartEdge` independently — no edge knows about
any other, so independent A\* shortest paths pile into the same optimal corridor.
`getSmartEdge` accepts `avoidAreas?: Rect[]` (extra keep-out rectangles, same
`nodePadding` clearance as nodes) and returns `{ svgPathString, points }` where
`points` are the raw routed graph-coordinate points. The label de-collision feature
already established the pattern this reuses: a canvas-level coordinator hook that
measures the DOM and writes an ephemeral, never-persisted store the smart edge reads.

## Approach

A coordinator routes **all** pathfinding edges together, sequentially, feeding each
already-routed edge's `points` back as `avoidAreas` (strips of half-width =
`separation`) so later edges dodge earlier corridors. Each edge's drawn path is
stored; the smart edge renders from the store when present, else self-routes. When
`separation` is 0 (or the diagram isn't on pathfinding), the coordinator no-ops and
clears the store — so edges route exactly as they do today.

## Global Constraints

- Prettier: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`.
- Do not regress the suite (668 tests at design time). Branch `edge-routing-experiments`; nothing pushed.
- Only capitalize the first letter of multi-letter acronyms in identifiers.
- `separation = 0` must be byte-for-byte today's independent routing (the store is empty; the edge self-routes).
- Auto-computed routes are never persisted (ephemeral store only).
- Waypoint edges untouched.

## Data model

Add one optional field to `PathfindingConfig` (in `shared/model.ts`):

```ts
  separation?: number // edge-aware routing strength (flow units); absent/0 = independent routing
```

- `DEFAULT_ROUTING.pathfinding.separation = 0`.
- Everywhere the value is read, treat absent as 0 (`config.separation ?? 0`), so
  diagrams whose persisted `routing.pathfinding` predates this field are unaffected.
- `PathfindingControls` gains a **separation** slider (0–30, step 1), disabled = 0
  meaning "off".

## Ephemeral route store — `src/edgeRoutes.ts`

Mirrors `labelPlacement.ts`:

```ts
export function setEdgeRoutes(map: Map<string, string>): void // edge id -> svg path 'd'
export function getEdgeRoute(id: string): string | undefined
export function useEdgeRoute(id: string): string | undefined // useSyncExternalStore
```

Never read by `canvasToModel`. Cleared when the coordinator is inactive.

## Coordinator hook — `src/useEdgeRouting.ts`

`useEdgeRouting(active: boolean, separation: number, opts): void` — canvas level.

- **No-op + clear store** unless `active` (diagram on pathfinding router) and
  `separation > 0`.
- On a **debounced** re-run (see Perf) — NOT every drag frame:
  1. For each `.react-flow__edge-smart`: read the rendered `path.react-flow__edge-path`
     ends via `getPointAtLength(0)` and `getPointAtLength(len)` (flow coords — the
     path `d` is authored in flow units) as the source/target points. Read
     `sourcePosition`/`targetPosition` from the RF edge's `data.sourceHandle`/
     `data.targetHandle` (`'left'|'right'|'top'|'bottom'` → `Position`), obtained
     from `useStore((s) => s.edges)`.
  2. Gather obstacle boxes from node DOM (service nodes always; groups/notes per the
     obstacle toggles), converted to flow units via `screenToFlowPosition` — same as
     the label hook.
  3. **Order** edges deterministically by ascending straight-line source→target
     distance (shortest first; ties by id). This is a heuristic knob-in-spirit; note
     it in code.
  4. Sequentially, for each edge: call `getSmartEdge({ sourceX, sourceY, targetX,
     targetY, sourcePosition, targetPosition, nodes: obstacles, options: { gridRatio,
     nodePadding, generatePath, drawEdge, avoidAreas: accumulated } })` using the same
     knob-derived `generatePath`/`drawEdge` the edge uses today. On a valid result,
     store `svgPathString` by id and append this edge's `points` as strips to
     `accumulated`.
  5. `setEdgeRoutes(map)`.
- **Strips from points:** for each consecutive pair in an edge's `points`, push a
  `Rect` = the segment's bounding box inflated by `separation` on all sides. (These
  get `nodePadding` clearance on top, inside `getSmartEdge`.)
- A route that fails (`getSmartEdge` returns `Error`/null) is skipped — that edge
  falls back to self-routing (store has no entry for it).

## `SmartTestEdge` change

- `const routed = useEdgeRoute(id)`.
- If `routed` is a non-empty string, use it as `path` (skip this edge's own
  `getSmartEdge` call). Otherwise compute the path as today.
- Everything else (label placement/drag, markers, style) is unchanged and keys off
  whatever `path` results.

## App wiring

In `Flow` (already has `activeRouting`), call:

```tsx
useEdgeRouting(
  activeRouting.router === 'pathfinding',
  activeRouting.pathfinding.separation ?? 0,
  { obstacleGroups: activeRouting.pathfinding.obstacleGroups, obstacleNotes: activeRouting.pathfinding.obstacleNotes,
    algo: activeRouting.pathfinding.algo, draw: activeRouting.pathfinding.draw,
    gridRatio: activeRouting.pathfinding.gridRatio, nodePadding: activeRouting.pathfinding.nodePadding,
    eps: activeRouting.pathfinding.eps },
)
```

(Pass the knobs the coordinator needs; the hook reads them so routes match the
edges' own settings.)

## Perf

N sequential `getSmartEdge` calls (each builds a grid + A\*), plus growing
`avoidAreas`. Re-running every drag frame would be too heavy, so the coordinator
**debounces** (e.g. recompute ~150 ms after node positions settle) rather than on
every position change. During a drag the store may lag the node briefly (edges
self-route / show the last computed route until it settles) — acceptable for a probe.
`separation = 0` short-circuits before any of this.

## Testing

- `edgeRoutes.test.ts` (pure store): get-by-id returns the set path; missing → undefined.
- Model: `DEFAULT_ROUTING.pathfinding.separation === 0`; `effectiveRouting` unaffected for diagrams without the field (reads as 0).
- The coordinator hook and the `SmartTestEdge` route-source change are DOM/measurement
  and sequential-timing bound — jsdom can't exercise them, so they are **manually verified**:
  on Raven Core (pathfinding), raising separation visibly pulls parallel-channel edges
  into distinct lanes; setting it back to 0 restores identical independent routing;
  labels and drag still work; obstacle toggles still respected.

## Out of scope / deferred

- The weighted-A\* router (soft cost penalties) — the "full" version, only if the probe's
  hard-avoidance detours prove too ugly.
- Tuning the route order beyond shortest-first.
- Any change to waypoint routing or to the label placement feature.
- Live (per-frame) re-routing during a drag.

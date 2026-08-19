# Edge-Aware Routing (Cheap Probe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce parallel-corridor overlap on pathfinding edges by routing them sequentially, each avoiding the corridors already taken — reusing `getSmartEdge` + `avoidAreas`. Opt-in via a `separation` knob (0 = today's behavior).

**Architecture:** A canvas-level coordinator routes all pathfinding edges in order, feeding each routed edge's `points` back as keep-out strips for later edges, and writes each drawn path to an ephemeral store the smart edge renders from. Same coordinator/store pattern as the label de-collision feature.

**Tech Stack:** React 18 + TypeScript + Vite + vitest; `@xyflow/react`; `@tisoap/react-flow-smart-edge`.

## Global Constraints

- Prettier: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`. Run `npx prettier --write` on touched files before committing.
- Do not regress the suite (668 tests at plan time). Full `npx tsc --noEmit` (exit 0) and `npx vitest run` at each task boundary (new files are self-contained).
- Branch `edge-routing-experiments`; do not push.
- `separation` absent/0 MUST be byte-for-byte today's independent routing (store empty → edge self-routes).
- Auto-computed routes are never persisted (ephemeral store only). Waypoint edges untouched.
- Only capitalize the first letter of multi-letter acronyms in identifiers. Run commands from `webapp/`.

---

### Task 1: `separation` knob (model + control)

**Files:**
- Modify: `shared/model.ts` (`PathfindingConfig` + `DEFAULT_ROUTING`)
- Modify: `src/PathfindingControls.tsx` (add a slider)
- Test: `shared/routing.test.ts` (append)

**Interfaces:**
- Produces: `PathfindingConfig.separation?: number`; `DEFAULT_ROUTING.pathfinding.separation === 0`.

- [ ] **Step 1: Write the failing test**

Append to `shared/routing.test.ts`:

```ts
import { DEFAULT_ROUTING as DR } from './model'
describe('separation knob', () => {
  it('defaults to 0', () => {
    expect(DR.pathfinding.separation).toBe(0)
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run shared/routing.test.ts` → FAIL (`separation` undefined).

- [ ] **Step 3: Add the field + default**

In `shared/model.ts`, add to `PathfindingConfig` (after `directSkip`):

```ts
  separation?: number // edge-aware routing strength (flow units); absent/0 = independent routing
```

In `DEFAULT_ROUTING.pathfinding`, add `separation: 0,`.

- [ ] **Step 4: Add the control**

In `src/PathfindingControls.tsx`, add a slider next to the others (reuse the file's existing `Slider` helper), reading `k.separation ?? 0` and writing `patchPathfinding({ separation: v })`:

```tsx
      <Slider
        label="separation"
        value={k.separation ?? 0}
        min={0}
        max={30}
        onChange={(v) => patchPathfinding({ separation: v })}
      />
```

- [ ] **Step 5: Verify + full gate + commit**

```bash
npx vitest run shared/routing.test.ts && npx tsc --noEmit && npx vitest run
npx prettier --write shared/model.ts src/PathfindingControls.tsx shared/routing.test.ts
git add shared/model.ts src/PathfindingControls.tsx shared/routing.test.ts
git commit -m "feat(model): edge separation knob (default 0)"
```

---

### Task 2: Ephemeral edge-route store

**Files:**
- Create: `src/edgeRoutes.ts`
- Test: `src/edgeRoutes.test.ts`

**Interfaces:**
- Produces: `setEdgeRoutes(map: Map<string,string>)`, `getEdgeRoute(id): string | undefined`, `useEdgeRoute(id): string | undefined`.

- [ ] **Step 1: Write the failing test**

Create `src/edgeRoutes.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { setEdgeRoutes, getEdgeRoute } from './edgeRoutes'

beforeEach(() => setEdgeRoutes(new Map()))

describe('edgeRoutes store', () => {
  it('returns a set route by id, undefined otherwise', () => {
    setEdgeRoutes(new Map([['e1', 'M 0,0 L 10,10']]))
    expect(getEdgeRoute('e1')).toBe('M 0,0 L 10,10')
    expect(getEdgeRoute('missing')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Verify it fails** — `npx vitest run src/edgeRoutes.test.ts`.

- [ ] **Step 3: Implement** — create `src/edgeRoutes.ts` (mirror `labelPlacement.ts`):

```ts
import { useSyncExternalStore } from 'react'

// Ephemeral, client-only: edge-aware routed paths (svg 'd'), keyed by edge id.
// Written by the useEdgeRouting coordinator; read by SmartTestEdge. Never read by
// canvasToModel, so these routes are never persisted.
let state = new Map<string, string>()
const listeners = new Set<() => void>()

export function setEdgeRoutes(map: Map<string, string>): void {
  state = map
  listeners.forEach((l) => l())
}
export function getEdgeRoute(id: string): string | undefined {
  return state.get(id)
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function useEdgeRoute(id: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => state.get(id),
    () => state.get(id),
  )
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/edgeRoutes.test.ts && npx tsc --noEmit
npx prettier --write src/edgeRoutes.ts src/edgeRoutes.test.ts
git add src/edgeRoutes.ts src/edgeRoutes.test.ts
git commit -m "feat(canvas): ephemeral edge-route store"
```

---

### Task 3: Extract shared routing helpers

**Files:**
- Create: `src/smartRouting.ts`
- Modify: `src/SmartTestEdge.tsx` (import the moved helpers instead of defining them)
- Test: none new (pure refactor; the full suite + a manual "edges still render" is the check)

**Interfaces:**
- Produces (moved verbatim from `SmartTestEdge.tsx`): `type Pt`, `distToSeg`, `simplify`, `catmull`, `PATHFINDERS` (`Record<PathAlgo, PathFindingFunction>`), and `drawFor(style: DrawStyle, eps: number): SVGDrawFunction | undefined`.

- [ ] **Step 1: Move the helpers**

Create `src/smartRouting.ts` and move these declarations out of `SmartTestEdge.tsx` verbatim: the `Pt` type, `distToSeg`, `simplify`, `catmull`, `PATHFINDERS`, and `drawFor`. Export each. Keep the imports they need at the top of the new file:

```ts
import {
  pathfindingAStarDiagonal,
  pathfindingAStarNoDiagonal,
  pathfindingJumpPointNoDiagonal,
  svgDrawSmoothStepLinePath,
  type PathFindingFunction,
  type SVGDrawFunction,
} from '@tisoap/react-flow-smart-edge'
import type { DrawStyle, PathAlgo } from '../shared/model'
```

- [ ] **Step 2: Update `SmartTestEdge.tsx`**

Remove the moved declarations from `SmartTestEdge.tsx` and import them:

```ts
import { PATHFINDERS, drawFor } from './smartRouting'
```

Drop any now-unused imports from `@tisoap/...`/`../shared/model` in `SmartTestEdge.tsx` (the pathfinding functions, `svgDrawSmoothStepLinePath`, `SVGDrawFunction`, `PathFindingFunction`, and `PathAlgo`/`DrawStyle` if only the helpers used them) — `noUnusedLocals` will flag leftovers. Keep whatever `SmartTestEdge` still uses directly (`getSmartEdge`, `isDirectPathBlocked`, `BaseEdge`, etc.).

- [ ] **Step 3: Full gate (pure refactor — behavior must be identical)**

Run: `npx tsc --noEmit` (exit 0) and `npx vitest run` (668 pass, no regressions).

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write src/smartRouting.ts src/SmartTestEdge.tsx
git add src/smartRouting.ts src/SmartTestEdge.tsx
git commit -m "refactor(canvas): extract shared smart-routing helpers"
```

---

### Task 4: The edge-aware coordinator hook

**Files:**
- Create: `src/useEdgeRouting.ts`
- Read first: `src/useLabelDeoverlap.ts` (the DOM-measurement + RF-store pattern to mirror) and `src/SmartTestEdge.tsx` (its obstacle-building logic: `absPos`, `ancestorsOf`, `sizeOf`, `exclude`, `wanted`).
- Test: none automated (DOM measurement + sequential routing; jsdom can't exercise it — manual in Task 6). Do NOT add a jsdom test.

**Interfaces:**
- Consumes: `getSmartEdge` from `@tisoap/react-flow-smart-edge`; `PATHFINDERS`, `drawFor` from `./smartRouting`; `setEdgeRoutes` from `./edgeRoutes`; `Position`, `useReactFlow`, `useStore` from `@xyflow/react`.
- Produces: `useEdgeRouting(active: boolean, separation: number, knobs: EdgeRoutingKnobs): void`, where `EdgeRoutingKnobs = { algo, draw, gridRatio, nodePadding, eps, obstacleGroups, obstacleNotes }` (the fields the routing needs; types from `../shared/model`).

- [ ] **Step 1: Implement the hook**

Create `src/useEdgeRouting.ts`. Key points, then the skeleton:

- No-op + `setEdgeRoutes(new Map())` and return unless `active && separation > 0`.
- Debounce: schedule the compute ~150 ms after the positions signal settles (a `setTimeout` in the effect, cleared on re-run) — NOT a rAF per frame.
- Endpoints: read each `.react-flow__edge-smart`'s `path.react-flow__edge-path` ends via `getPointAtLength(0)`/`(len)` (flow coords).
- `sourcePosition`/`targetPosition`: from the RF edge's `data.sourceHandle`/`data.targetHandle` string → `Position` (map `left/right/top/bottom`; default `right`→source, `left`→target). Get edges from `useStore((s) => s.edges)`.
- Obstacles: build per-edge from the RF node store (positions + parent chain), excluding that edge's own source/target and their ancestor groups, filtering by type per `obstacleGroups`/`obstacleNotes` — this is the SAME logic `SmartTestEdge` already runs; replicate it reading node positions from `s.nodeLookup` (adapt to the installed RF shape — `n.internals.positionAbsolute`, `n.measured`, `n.parentId`, `n.type`).
- Order: ascending straight-line source→target distance, ties by id.
- Sequentially call `getSmartEdge(...)` with the knobs + accumulating `avoidAreas`; on a good result store `svgPathString` and append strips from `points`.

```tsx
import { useEffect } from 'react'
import { Position, useReactFlow, useStore } from '@xyflow/react'
import { getSmartEdge, type SVGDrawFunction } from '@tisoap/react-flow-smart-edge'
import { PATHFINDERS, drawFor } from './smartRouting'
import { setEdgeRoutes } from './edgeRoutes'
import type { PathAlgo, DrawStyle } from '../shared/model'

export interface EdgeRoutingKnobs {
  algo: PathAlgo
  draw: DrawStyle
  gridRatio: number
  nodePadding: number
  eps: number
  obstacleGroups: boolean
  obstacleNotes: boolean
}
type Rect = { x: number; y: number; width: number; height: number }

const POS: Record<string, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
}

export function useEdgeRouting(active: boolean, separation: number, knobs: EdgeRoutingKnobs): void {
  const { screenToFlowPosition } = useReactFlow()
  // positions signal (same idea as useLabelDeoverlap): re-run when nodes move.
  const posKey = useStore((s) => {
    let k = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.nodeLookup.forEach((n: any) => {
      const p = n.internals?.positionAbsolute ?? n.position
      k += `${n.id}:${p?.x},${p?.y};`
    })
    return k
  })
  // edge handle sides, id -> [sourcePos, targetPos]
  const handleKey = useStore((s) =>
    s.edges.map((e) => `${e.id}:${e.data?.sourceHandle ?? 'right'}>${e.data?.targetHandle ?? 'left'}`).join('|'),
  )
  // edge endpoints: id -> `${source}>${target}` node ids (to exclude from obstacles)
  const srcTgtKey = useStore((s) => s.edges.map((e) => `${e.id}:${e.source}>${e.target}`).join('|'))

  useEffect(() => {
    if (!active || separation <= 0) {
      setEdgeRoutes(new Map())
      return
    }
    const timer = setTimeout(() => {
      const drawEdge: SVGDrawFunction | undefined = drawFor(knobs.draw, knobs.eps)
      // 1. endpoints from DOM path ends
      type EdgeInput = { id: string; sx: number; sy: number; tx: number; ty: number }
      const inputs: EdgeInput[] = []
      const handleById = new Map<string, { s: Position; t: Position }>()
      // (fill handleById from the RF edges — read s.edges via a ref or a second
      //  useStore selector value captured above; here parse `handleKey`.)
      for (const pair of handleKey.split('|')) {
        if (!pair) continue
        const [id, sides] = pair.split(':')
        const [s, t] = sides.split('>')
        handleById.set(id, { s: POS[s] ?? Position.Right, t: POS[t] ?? Position.Left })
      }
      for (const g of document.querySelectorAll<SVGGElement>('.react-flow__edge-smart')) {
        const id = g.getAttribute('data-id')
        const path = g.querySelector<SVGPathElement>('path.react-flow__edge-path')
        if (!id || !path) continue
        const len = path.getTotalLength()
        if (!len) continue
        const a = path.getPointAtLength(0)
        const b = path.getPointAtLength(len)
        inputs.push({ id, sx: a.x, sy: a.y, tx: b.x, ty: b.y })
      }
      // 2. obstacle boxes (flow units) from node DOM, per type toggle. Endpoint
      //    exclusion is by id below (groups are only obstacles when toggled on;
      //    for the probe we exclude only each edge's own source/target ids —
      //    ancestor-group exclusion matters only with obstacleGroups on and can be
      //    refined later).
      const nodeBox = (sel: string): { id: string; box: Rect }[] => {
        const out: { id: string; box: Rect }[] = []
        for (const n of document.querySelectorAll<HTMLElement>(sel)) {
          const id = n.getAttribute('data-id')
          if (!id) continue
          const r = n.getBoundingClientRect()
          const tl = screenToFlowPosition({ x: r.left, y: r.top })
          const br = screenToFlowPosition({ x: r.right, y: r.bottom })
          out.push({ id, box: { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y } })
        }
        return out
      }
      const obstacles = [
        ...nodeBox('.react-flow__node-service'),
        ...(knobs.obstacleGroups ? nodeBox('.react-flow__node-group') : []),
        ...(knobs.obstacleNotes ? nodeBox('.react-flow__node-note') : []),
      ]
      // getSmartEdge wants Node-like obstacles: { id, position: {x,y}, width, height }
      const asNode = (o: { id: string; box: Rect }) => ({
        id: o.id,
        position: { x: o.box.x, y: o.box.y },
        width: o.box.width,
        height: o.box.height,
        measured: { width: o.box.width, height: o.box.height },
        data: {},
      })
      // endpoint node ids per edge, to drop from that edge's obstacle set (an edge
      // must not treat its own source/target as walls).
      const endpointsById = new Map<string, [string, string]>()
      for (const pair of srcTgtKey.split('|')) {
        if (!pair) continue
        const [id, st] = pair.split(':')
        const [s, t] = st.split('>')
        endpointsById.set(id, [s, t])
      }
      inputs.sort((e1, e2) => {
        const d1 = Math.hypot(e1.tx - e1.sx, e1.ty - e1.sy)
        const d2 = Math.hypot(e2.tx - e2.sx, e2.ty - e2.sy)
        return d1 - d2 || (e1.id < e2.id ? -1 : 1)
      })
      const avoid: Rect[] = []
      const routes = new Map<string, string>()
      for (const e of inputs) {
        const h = handleById.get(e.id) ?? { s: Position.Right, t: Position.Left }
        const ends = endpointsById.get(e.id) ?? ['', '']
        const myObstacles = obstacles.filter((o) => o.id !== ends[0] && o.id !== ends[1])
        const res = getSmartEdge({
          sourceX: e.sx,
          sourceY: e.sy,
          targetX: e.tx,
          targetY: e.ty,
          sourcePosition: h.s,
          targetPosition: h.t,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodes: myObstacles.map(asNode) as any,
          options: {
            gridRatio: knobs.gridRatio,
            nodePadding: knobs.nodePadding,
            generatePath: PATHFINDERS[knobs.algo],
            drawEdge,
            avoidAreas: avoid,
          },
        })
        if (res && !(res instanceof Error) && res.svgPathString) {
          routes.set(e.id, res.svgPathString)
          // strips from raw points
          const pts = res.points
          for (let i = 0; i < pts.length - 1; i++) {
            const [x1, y1] = pts[i]
            const [x2, y2] = pts[i + 1]
            avoid.push({
              x: Math.min(x1, x2) - separation,
              y: Math.min(y1, y2) - separation,
              width: Math.abs(x2 - x1) + 2 * separation,
              height: Math.abs(y2 - y1) + 2 * separation,
            })
          }
        }
      }
      setEdgeRoutes(routes)
    }, 150)
    return () => clearTimeout(timer)
    // Depend on the knob PRIMITIVES (not the `knobs` object, which is a fresh
    // identity each render and would re-run the effect every render).
  }, [
    active,
    separation,
    posKey,
    handleKey,
    srcTgtKey,
    knobs.algo,
    knobs.draw,
    knobs.gridRatio,
    knobs.nodePadding,
    knobs.eps,
    knobs.obstacleGroups,
    knobs.obstacleNotes,
    screenToFlowPosition,
  ])
}
```

**Implementer notes (resolve against the installed RF + library):**
- The obstacle build reads node boxes from the DOM and excludes each edge's own
  source/target ids (via `endpointsById`). Groups/notes are only obstacles when their
  toggle is on; ancestor-group exclusion (so an edge can leave its own container when
  `obstacleGroups` is on) is NOT handled here and can be refined later — for the probe
  with groups-as-obstacles off by default it doesn't bite.
- `getSmartEdge`'s `nodes` type is strict; the `as any` casts on the synthesized
  obstacle shapes are acceptable — keep them narrow and commented.
- The effect depends on knob PRIMITIVES (not the `knobs` object) to avoid re-running
  every render. Confirm the `posKey`/`handleKey`/`srcTgtKey` selectors return strings
  (primitives) so `useStore`'s equality is by value.
- Confirm `getSmartEdge`'s result `.points` is `number[][]` (it is per the lib types);
  each entry is `[x, y]`.

- [ ] **Step 2: Typecheck + commit**

The hook isn't imported yet, so it only needs to compile.

```bash
npx tsc --noEmit
npx prettier --write src/useEdgeRouting.ts
git add src/useEdgeRouting.ts
git commit -m "feat(canvas): edge-aware routing coordinator (sequential + avoidAreas)"
```

---

### Task 5: SmartTestEdge renders the coordinator's route

**Files:**
- Modify: `src/SmartTestEdge.tsx`
- Test: none automated (manual in Task 6).

**Interfaces:**
- Consumes: `useEdgeRoute(id)` from `./edgeRoutes`.

- [ ] **Step 1: Prefer the stored route**

In `SmartTestEdge`, after computing the current `path` (the existing independent
route), override it when the coordinator has one:

```tsx
  const routed = useEdgeRoute(id)
  // ... existing path computation stays ...
  const finalPath = routed && routed.length > 0 ? routed : path
```

Use `finalPath` everywhere `path` was used downstream (the `<BaseEdge path=...>` and
the label measurement `measureRef`'s `d`). Keep the hook call unconditional at the
top with the others. When `routed` is undefined (separation 0 / not yet computed /
this edge failed to route), behavior is exactly as today.

- [ ] **Step 2: Full gate**

Run: `npx tsc --noEmit` (0) and `npx vitest run` (668, no regressions).

- [ ] **Step 3: Format + commit**

```bash
npx prettier --write src/SmartTestEdge.tsx
git add src/SmartTestEdge.tsx
git commit -m "feat(canvas): smart edge renders coordinator route when present"
```

---

### Task 6: Wire the coordinator + manual walkthrough

**Files:**
- Modify: `src/App.tsx`
- Test: `npx tsc --noEmit` + full `npx vitest run`, then a manual browser walkthrough.

- [ ] **Step 1: Call the hook in `Flow`**

Import and call it near the other hooks (App's `Flow` already has `activeRouting`).
Depend on the individual knob primitives to avoid identity churn (see Task 4 note):

```tsx
import { useEdgeRouting } from './useEdgeRouting'
// ...inside Flow():
const pf = activeRouting.pathfinding
useEdgeRouting(activeRouting.router === 'pathfinding', pf.separation ?? 0, {
  algo: pf.algo,
  draw: pf.draw,
  gridRatio: pf.gridRatio,
  nodePadding: pf.nodePadding,
  eps: pf.eps,
  obstacleGroups: pf.obstacleGroups,
  obstacleNotes: pf.obstacleNotes,
})
```

If the hook's `knobs` object identity churns the effect, wrap it in `useMemo` keyed on
those primitives.

- [ ] **Step 2: Full gate**

Run: `npx tsc --noEmit && npx vitest run` → tsc 0; 668+ pass.

- [ ] **Step 3: Manual walkthrough** (controller runs this)

On Raven Core (pathfinding): open Diagram settings, raise **separation** from 0 →
~12. Expect parallel-channel edges to pull into distinct lanes (visibly less
stacking). Set it back to 0 → routing returns identical to before. Confirm labels
still place/drag and obstacle toggles still work. Note perf feel on a node drag
(routes settle ~150 ms after release).

- [ ] **Step 4: Format + commit**

```bash
npx prettier --write src/App.tsx
git add src/App.tsx
git commit -m "feat(canvas): run edge-aware routing on pathfinding diagrams"
```

---

## Notes for the implementer

- This is a PROBE: the goal is to see whether sequential avoidAreas visibly lanes
  parallel edges. Hard avoidance can produce detours; that's expected data, not a bug.
- `separation = 0` must be a true no-op (store cleared, edges self-route) — verify by
  toggling it back to 0 and confirming the diagram is identical to pre-feature.
- The coordinator's DOM measurement + sequential routing are not jsdom-testable; the
  automated coverage is the store + model tests, and the controller does the visual
  walkthrough.

# Pathfinding Edge Label Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep pathfinding-edge labels from stacking — an automatic de-collision pass that spreads unpinned labels, plus manual drag that pins/persists a label.

**Architecture:** A pure DOM-free resolver computes non-overlapping label placements; a canvas-level hook measures labels and feeds the resolver, writing results to an ephemeral client store; the smart edge renders each label at its pinned (persisted) or auto (store) placement and supports drag-to-pin. Waypoint edges are untouched.

**Tech Stack:** React 18 + TypeScript + Vite + vitest; `@xyflow/react`.

## Global Constraints

- Prettier: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`. Run `npx prettier --write` on touched files before committing.
- Do not regress the suite (661 tests at plan time). Run `npx vitest run` before each commit. Full `npx tsc --noEmit` must stay exit 0 at every task boundary (new files are self-contained; no mid-refactor broken window).
- Branch `edge-routing-experiments`; do not push.
- Scope is pathfinding (smart) edges only. Waypoint-edge label behavior is unchanged.
- Auto-computed placement is NEVER persisted to the model; only user drags are.
- Only capitalize the first letter of multi-letter acronyms in identifiers.
- Run commands from `webapp/`.

---

### Task 1: Persist `labelOffset` + `labelPinned` through the label plumbing

**Files:**
- Modify: `shared/model.ts` (`Edge` interface — after `labelPos?`)
- Modify: `src/canvasData.ts` (`AppEdge` data type — near line 63, after `labelPos?`)
- Modify: `src/buildGraph.ts` (edge `data` build — near line 109, after `labelPos: de.labelPos`)
- Modify: `src/canvasToModel.ts` (edge persist — near line 101, after `labelPos: e.data?.labelPos`)
- Test: `src/buildGraph.test.ts` (append)

**Interfaces:**
- Produces: `Edge.labelOffset?: { x: number; y: number }`, `Edge.labelPinned?: boolean`, mirrored on the AppEdge data type, passed through `buildGraph` into `edge.data`, and persisted by `canvasToModel`.

- [ ] **Step 1: Write the failing test**

Append to `src/buildGraph.test.ts`:

```ts
describe('buildDiagramGraph label placement passthrough', () => {
  it('carries labelOffset and labelPinned into edge data', () => {
    const d = {
      id: 'd', name: 'D', title: 'D', type: 'topology',
      nodes: [
        { id: 'n1', label: 'A', position: { x: 0, y: 0 }, fields: [] },
        { id: 'n2', label: 'B', position: { x: 200, y: 0 }, fields: [] },
      ],
      groups: [], notes: [],
      edges: [{ id: 'e1', from: 'n1', to: 'n2', labelOffset: { x: 3, y: -7 }, labelPinned: true }],
      flows: [],
    } as unknown as import('../shared/model').Diagram
    const edge = buildDiagramGraph(d, [], 'pathfinding').edges[0]
    expect(edge.data?.labelOffset).toEqual({ x: 3, y: -7 })
    expect(edge.data?.labelPinned).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/buildGraph.test.ts`
Expected: FAIL — `edge.data.labelOffset`/`labelPinned` are undefined.

- [ ] **Step 3: Add the model fields**

In `shared/model.ts`, in `Edge`, after the `labelPos?` line:

```ts
  labelOffset?: { x: number; y: number } // offset from the on-path anchor, in canvas/flow units; absent = {0,0}
  labelPinned?: boolean // true = user-placed label; the auto de-collision pass skips it
```

- [ ] **Step 4: Thread through the three call sites**

`src/canvasData.ts` — in the AppEdge data type, after `labelPos?`:

```ts
  labelOffset?: { x: number; y: number }
  labelPinned?: boolean
```

`src/buildGraph.ts` — in the `edge.data = { ... }` block, after `labelPos: de.labelPos,`:

```ts
      labelOffset: de.labelOffset,
      labelPinned: de.labelPinned,
```

`src/canvasToModel.ts` — in the edge-mapping object, after `labelPos: e.data?.labelPos,`:

```ts
    labelOffset: e.data?.labelOffset,
    labelPinned: e.data?.labelPinned,
```

- [ ] **Step 5: Run test + full gate**

Run: `npx vitest run src/buildGraph.test.ts` → PASS. Then `npx tsc --noEmit` (exit 0) and `npx vitest run` (no regressions).

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write shared/model.ts src/canvasData.ts src/buildGraph.ts src/canvasToModel.ts src/buildGraph.test.ts
git add shared/model.ts src/canvasData.ts src/buildGraph.ts src/canvasToModel.ts src/buildGraph.test.ts
git commit -m "feat(model): persist edge labelOffset + labelPinned"
```

---

### Task 2: Pure label de-collision resolver

**Files:**
- Create: `src/labelDeoverlap.ts`
- Test: `src/labelDeoverlap.test.ts`

**Interfaces:**
- Produces: `LabelPlacement`, `LabelInput`, `Rect`, `DeoverlapOpts`, and `resolveLabelPlacements(labels, nodeBoxes?, opts?): Map<string, LabelPlacement>` (one entry per UNPINNED label).

- [ ] **Step 1: Write the failing tests**

Create `src/labelDeoverlap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveLabelPlacements, type LabelInput, type Rect } from './labelDeoverlap'

// A label riding a horizontal line y=c: anchor moves in x with t, normal is vertical.
function hLine(id: string, c: number, pinned = false, seedPos = 0.5): LabelInput {
  return {
    id,
    width: 60,
    height: 18,
    pinned,
    placement: { labelPos: seedPos, offset: { x: 0, y: 0 } },
    anchorAt: (t) => ({ x: t * 200, y: c }),
    normalAt: () => ({ x: 0, y: 1 }),
  }
}
function boxAt(l: LabelInput, p: { labelPos: number; offset: { x: number; y: number } }): Rect {
  const a = l.anchorAt(p.labelPos)
  return { x: a.x + p.offset.x - l.width / 2, y: a.y + p.offset.y - l.height / 2, width: l.width, height: l.height }
}
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

describe('resolveLabelPlacements', () => {
  it('separates two labels stacked on the same line by sliding them apart', () => {
    const a = hLine('a', 0)
    const b = hLine('b', 0)
    const out = resolveLabelPlacements([a, b])
    const ra = boxAt(a, out.get('a')!)
    const rb = boxAt(b, out.get('b')!)
    expect(overlaps(ra, rb)).toBe(false)
  })

  it('never moves a pinned label; the unpinned one moves around it', () => {
    const pinned = hLine('p', 0, true)
    const free = hLine('f', 0)
    const out = resolveLabelPlacements([pinned, free])
    expect(out.has('p')).toBe(false) // pinned not returned
    const rf = boxAt(free, out.get('f')!)
    const rp = boxAt(pinned, pinned.placement)
    expect(overlaps(rf, rp)).toBe(false)
  })

  it('uses a perpendicular offset when the lines are coincident (sliding cannot separate)', () => {
    // both anchors are the SAME fixed point regardless of t → sliding does nothing
    const mk = (id: string, pinned = false): LabelInput => ({
      id, width: 60, height: 18, pinned,
      placement: { labelPos: 0.5, offset: { x: 0, y: 0 } },
      anchorAt: () => ({ x: 100, y: 0 }),
      normalAt: () => ({ x: 0, y: 1 }),
    })
    const a = mk('a'), b = mk('b')
    const out = resolveLabelPlacements([a, b])
    // at least one got a non-zero vertical offset, and they no longer overlap
    const oa = out.get('a')!, ob = out.get('b')!
    expect(Math.abs(oa.offset.y) + Math.abs(ob.offset.y)).toBeGreaterThan(0)
    expect(overlaps(boxAt(a, oa), boxAt(b, ob))).toBe(false)
  })

  it('keeps labelPos within [minPos,maxPos] and |offset| within maxOffset', () => {
    const a = hLine('a', 0), b = hLine('b', 0)
    const out = resolveLabelPlacements([a, b], [], { minPos: 0.3, maxPos: 0.7, maxOffset: 10 })
    for (const p of out.values()) {
      expect(p.labelPos).toBeGreaterThanOrEqual(0.3)
      expect(p.labelPos).toBeLessThanOrEqual(0.7)
      expect(Math.hypot(p.offset.x, p.offset.y)).toBeLessThanOrEqual(10 + 1e-6)
    }
  })

  it('pushes a label out of an overlapping node box', () => {
    const a = hLine('a', 0)
    const node: Rect = { x: 100 - 30, y: -9, width: 60, height: 18 } // centered on a at t=0.5
    const out = resolveLabelPlacements([a], [node])
    expect(overlaps(boxAt(a, out.get('a')!), node)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/labelDeoverlap.test.ts`
Expected: FAIL — module/function does not exist.

- [ ] **Step 3: Implement the resolver**

Create `src/labelDeoverlap.ts`:

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
  placement: LabelPlacement // pinned = fixed; unpinned = seed (usually {0.5,{0,0}})
  anchorAt: (t: number) => { x: number; y: number }
  normalAt: (t: number) => { x: number; y: number }
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface DeoverlapOpts {
  minPos?: number
  maxPos?: number
  maxOffset?: number
  iterations?: number
}

function interArea(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return ix * iy
}

// Resolve overlapping labels by sliding each unpinned label along its own line,
// and — where sliding cannot reduce the overlap (near-coincident lines) — nudging
// it perpendicular. Deterministic: labels processed in id order. Pinned labels
// and node boxes are static obstacles; only unpinned labels move. Returns a
// placement for every UNPINNED label.
export function resolveLabelPlacements(
  labels: LabelInput[],
  nodeBoxes: Rect[] = [],
  opts: DeoverlapOpts = {},
): Map<string, LabelPlacement> {
  const minPos = opts.minPos ?? 0.2
  const maxPos = opts.maxPos ?? 0.8
  const maxOffset = opts.maxOffset ?? 28
  const iterations = opts.iterations ?? 24
  const slideStep = 0.06
  const offStep = 6

  const byId = new Map(labels.map((l) => [l.id, l]))
  const place = new Map<string, LabelPlacement>()
  for (const l of labels) {
    place.set(l.id, { labelPos: l.placement.labelPos, offset: { ...l.placement.offset } })
  }
  const sorted = [...labels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const clampPos = (t: number) => Math.max(minPos, Math.min(maxPos, t))
  const clampOff = (o: { x: number; y: number }) => {
    const m = Math.hypot(o.x, o.y)
    return m > maxOffset ? { x: (o.x / m) * maxOffset, y: (o.y / m) * maxOffset } : o
  }
  const boxOf = (l: LabelInput, p: LabelPlacement): Rect => {
    const a = l.anchorAt(p.labelPos)
    return {
      x: a.x + p.offset.x - l.width / 2,
      y: a.y + p.offset.y - l.height / 2,
      width: l.width,
      height: l.height,
    }
  }
  const boxAtPos = (l: LabelInput, labelPos: number, offset: { x: number; y: number }): Rect =>
    boxOf(l, { labelPos, offset })

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false
    for (const l of sorted) {
      if (l.pinned) continue
      const p = place.get(l.id)!
      const myBox = boxOf(l, p)
      // first overlapping obstacle: node boxes, then any other label
      let hit: Rect | null = null
      for (const nb of nodeBoxes) if (interArea(myBox, nb) > 0) { hit = nb; break }
      if (!hit) {
        for (const o of sorted) {
          if (o.id === l.id) continue
          const ob = boxOf(o, place.get(o.id)!)
          if (interArea(myBox, ob) > 0) { hit = ob; break }
        }
      }
      if (!hit) continue

      // try sliding: pick the neighbor labelPos that most reduces overlap with hit
      const here = interArea(myBox, hit)
      let bestPos = p.labelPos
      let bestArea = here
      for (const cand of [clampPos(p.labelPos + slideStep), clampPos(p.labelPos - slideStep)]) {
        const area = interArea(boxAtPos(l, cand, p.offset), hit)
        if (area < bestArea - 1e-6) { bestArea = area; bestPos = cand }
      }
      if (bestPos !== p.labelPos) {
        p.labelPos = bestPos
        moved = true
      } else {
        // sliding can't help → push perpendicular, away from the hit
        const n = l.normalAt(p.labelPos)
        const mc = { x: myBox.x + myBox.width / 2, y: myBox.y + myBox.height / 2 }
        const hc = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 }
        const sign = (mc.x - hc.x) * n.x + (mc.y - hc.y) * n.y >= 0 ? 1 : -1
        p.offset = clampOff({ x: p.offset.x + sign * n.x * offStep, y: p.offset.y + sign * n.y * offStep })
        moved = true
      }
    }
    if (!moved) break
  }

  const out = new Map<string, LabelPlacement>()
  for (const l of labels) if (!l.pinned) out.set(l.id, place.get(l.id)!)
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/labelDeoverlap.test.ts` → all pass.
If the coincident-line test still overlaps after resolution, raise `iterations` or `offStep` slightly — but do not special-case the tests; the algorithm must converge generally.

- [ ] **Step 5: Format, full gate, commit**

```bash
npx tsc --noEmit && npx vitest run
npx prettier --write src/labelDeoverlap.ts src/labelDeoverlap.test.ts
git add src/labelDeoverlap.ts src/labelDeoverlap.test.ts
git commit -m "feat(canvas): pure label de-collision resolver"
```

---

### Task 3: Ephemeral label-placement store

**Files:**
- Create: `src/labelPlacement.ts`
- Test: `src/labelPlacement.test.ts`

**Interfaces:**
- Consumes: `LabelPlacement` (Task 2).
- Produces: `setLabelPlacements(map)`, `getLabelPlacement(id)`, `useLabelPlacement(id)`.

- [ ] **Step 1: Write the failing test**

Create `src/labelPlacement.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { setLabelPlacements, getLabelPlacement } from './labelPlacement'

beforeEach(() => setLabelPlacements(new Map()))

describe('labelPlacement store', () => {
  it('returns a set placement by id, undefined otherwise', () => {
    setLabelPlacements(new Map([['e1', { labelPos: 0.7, offset: { x: 2, y: -3 } }]]))
    expect(getLabelPlacement('e1')).toEqual({ labelPos: 0.7, offset: { x: 2, y: -3 } })
    expect(getLabelPlacement('missing')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run src/labelPlacement.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement the store**

Create `src/labelPlacement.ts`:

```ts
import { useSyncExternalStore } from 'react'
import type { LabelPlacement } from './labelDeoverlap'

// Ephemeral, client-only: the auto de-collision pass's latest output, keyed by
// edge id. Never read by canvasToModel, so auto placement is never persisted.
let state = new Map<string, LabelPlacement>()
const listeners = new Set<() => void>()

export function setLabelPlacements(map: Map<string, LabelPlacement>): void {
  state = map
  listeners.forEach((l) => l())
}
export function getLabelPlacement(id: string): LabelPlacement | undefined {
  return state.get(id)
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function useLabelPlacement(id: string): LabelPlacement | undefined {
  return useSyncExternalStore(
    subscribe,
    () => state.get(id),
    () => state.get(id),
  )
}
```

- [ ] **Step 4: Verify it passes; commit**

```bash
npx vitest run src/labelPlacement.test.ts
npx tsc --noEmit
npx prettier --write src/labelPlacement.ts src/labelPlacement.test.ts
git add src/labelPlacement.ts src/labelPlacement.test.ts
git commit -m "feat(canvas): ephemeral label-placement store"
```

---

### Task 4: Coordinator hook `useLabelDeoverlap`

**Files:**
- Create: `src/useLabelDeoverlap.ts`
- Test: none automated (DOM-measurement — SVG `getPointAtLength` / `getBoundingClientRect` are not implemented in jsdom, so a render test cannot exercise it; verified manually in Task 6). Do NOT add a jsdom test for it.

**Interfaces:**
- Consumes: `resolveLabelPlacements`, `LabelInput`, `Rect` (Task 2); `setLabelPlacements` (Task 3); `useReactFlow`, `useStore` from `@xyflow/react`.
- Produces: `useLabelDeoverlap(active: boolean): void`.

- [ ] **Step 1: Implement the hook**

Create `src/useLabelDeoverlap.ts`:

```ts
import { useEffect } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { resolveLabelPlacements, type LabelInput, type Rect } from './labelDeoverlap'
import { setLabelPlacements } from './labelPlacement'

// Canvas-level: after pathfinding edges render, measure every unpinned smart-edge
// label and spread overlapping ones, writing the result to the ephemeral store.
// No-op unless `active` (the active diagram uses the pathfinding router). DOM
// measurement (getBoundingClientRect / getPointAtLength), so it only runs client
// side and is verified manually. Re-runs when node positions change (which is
// what moves the routed paths).
export function useLabelDeoverlap(active: boolean): void {
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow()
  // A cheap "positions changed" signal: the sum the RF store bumps on transform /
  // node change. Depending on the node internals map identity re-runs on drag.
  const version = useStore((s) => s.nodeLookup.size + s.edges.length)

  useEffect(() => {
    if (!active) {
      setLabelPlacements(new Map())
      return
    }
    const raf = requestAnimationFrame(() => {
      const edgeEls = document.querySelectorAll<SVGGElement>('.react-flow__edge-smart')
      const labels: LabelInput[] = []
      const zoom = (() => {
        // derive zoom from a 1-unit flow delta projected to screen
        const a = flowToScreenPosition({ x: 0, y: 0 })
        const b = flowToScreenPosition({ x: 1, y: 0 })
        return Math.hypot(b.x - a.x, b.y - a.y) || 1
      })()
      for (const g of edgeEls) {
        const id = g.getAttribute('data-id')
        if (!id) continue
        const path = g.querySelector<SVGPathElement>('path.react-flow__edge-path')
        const labelEl = document.querySelector<HTMLElement>(`.wp-label[data-edge-id="${id}"]`)
        if (!path || !labelEl) continue
        const len = path.getTotalLength()
        if (!len) continue
        const pinned = labelEl.dataset.pinned === 'true'
        const seedPos = Number(labelEl.dataset.labelPos ?? '0.5')
        const seedOff = { x: Number(labelEl.dataset.offx ?? '0'), y: Number(labelEl.dataset.offy ?? '0') }
        const rect = labelEl.getBoundingClientRect()
        // anchor/normal in FLOW units from the rendered path
        const anchorAt = (t: number) => {
          const p = path.getPointAtLength(Math.max(0, Math.min(1, t)) * len)
          return { x: p.x, y: p.y } // RF edge path `d` is in flow units — use directly
        }
        const normalAt = (t: number) => {
          const e = 0.001
          const a = anchorAt(Math.max(0, t - e))
          const b = anchorAt(Math.min(1, t + e))
          const dx = b.x - a.x
          const dy = b.y - a.y
          const m = Math.hypot(dx, dy) || 1
          return { x: -dy / m, y: dx / m } // unit perpendicular
        }
        labels.push({
          id,
          width: rect.width / zoom,
          height: rect.height / zoom,
          pinned,
          placement: { labelPos: seedPos, offset: seedOff },
          anchorAt,
          normalAt,
        })
      }
      const nodeBoxes: Rect[] = []
      for (const n of document.querySelectorAll<HTMLElement>('.react-flow__node-service')) {
        const r = n.getBoundingClientRect()
        const tl = screenToFlowPosition({ x: r.left, y: r.top })
        const br = screenToFlowPosition({ x: r.right, y: r.bottom })
        nodeBoxes.push({ x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y })
      }
      setLabelPlacements(resolveLabelPlacements(labels, nodeBoxes))
    })
    return () => cancelAnimationFrame(raf)
  }, [active, version, flowToScreenPosition, screenToFlowPosition])
}
```

Note: `getPointAtLength` on a React Flow edge path returns FLOW coordinates (the path `d` is authored in flow units), so the anchor is used directly — no screen/CTM mapping. `zoom` (from `flowToScreenPosition`) is used only to convert the measured label box SIZE from screen px to flow units. Re-run signal: if `s.nodeLookup` isn't on the installed RF version, use whatever positions signal the store exposes — even `useStore((s) => s.transform.join())` plus `useNodes()` identity. The requirement is only that the effect re-runs after node positions change; live-on-drag is preferred but re-spread on drag-stop is acceptable for v1 (say which you used in the report).

- [ ] **Step 2: Typecheck and commit**

The hook isn't imported yet, so it only needs to compile.

```bash
npx tsc --noEmit
npx prettier --write src/useLabelDeoverlap.ts
git add src/useLabelDeoverlap.ts
git commit -m "feat(canvas): label de-collision coordinator hook"
```

---

### Task 5: Smart-edge placement source, offset render, drag-to-pin, unpin

**Files:**
- Modify: `src/SmartTestEdge.tsx`
- Read first: `src/WaypointEdge.tsx` (its `startLabelDrag` + label render — copy the interaction pattern)
- Test: none automated (DOM-measurement label rendering + drag; verified manually in Task 6). Do NOT add a jsdom test.

**Interfaces:**
- Consumes: `useLabelPlacement` (Task 3); `data.labelPinned`/`labelPos`/`labelOffset` (Task 1); `useReactFlow` (`screenToFlowPosition`), `setEdges` via `useReactFlow`.

- [ ] **Step 1: Resolve the placement**

In `SmartTestEdge`, after `path` is computed, replace the current `labelPos`/`labelPt` block with a placement that prefers pinned → auto → midpoint:

```tsx
  const auto = useLabelPlacement(id)
  const pinned = data?.labelPinned === true
  const labelPos = Math.max(
    0,
    Math.min(1, pinned ? ((data?.labelPos as number) ?? 0.5) : (auto?.labelPos ?? 0.5)),
  )
  const offset = pinned
    ? ((data?.labelOffset as { x: number; y: number }) ?? { x: 0, y: 0 })
    : (auto?.offset ?? { x: 0, y: 0 })
```

- [ ] **Step 2: Render the label at anchor + offset, with the data-\* attrs the hook reads**

Extend the label render: position at the measured anchor plus `offset`, and expose the `data-edge-id`/`data-pinned`/`data-label-pos`/`data-offx`/`data-offy` attributes the coordinator reads. Keep the hidden measurement path. The label div becomes:

```tsx
          {labelPt ? (
            <EdgeLabelRenderer>
              <div
                className={['wp-label', selected ? 'nopan nodrag' : ''].filter(Boolean).join(' ')}
                data-edge-id={id}
                data-pinned={pinned ? 'true' : 'false'}
                data-label-pos={labelPos}
                data-offx={offset.x}
                data-offy={offset.y}
                style={{
                  transform: `translate(-50%,-50%) translate(${labelPt.x + offset.x}px,${labelPt.y + offset.y}px)`,
                  color: relColor,
                  pointerEvents: selected ? 'all' : 'none',
                  cursor: selected ? 'grab' : 'default',
                }}
                onPointerDown={selected ? startLabelDrag : undefined}
                onDoubleClick={selected ? unpin : undefined}
                title={selected ? 'drag to place · double-click to auto-place' : undefined}
              >
                {label}
              </div>
            </EdgeLabelRenderer>
          ) : null}
```

Here `labelPt` is the on-path anchor at `labelPos` (from the existing measurement effect, which must now use this `labelPos`), and the visible transform adds `offset`. Pull `selected` from props.

- [ ] **Step 3: Add drag-to-pin and unpin**

Add (adapting `WaypointEdge.startLabelDrag`): a `startLabelDrag` that, on pointer move, finds the nearest point on the path to the cursor (sample N points via `getPointAtLength`, pick the closest → gives `labelPos`), computes `offset` = cursor(flow) − anchor(flow) at that `labelPos`, and writes them to the edge with `setEdges`, setting `labelPinned: true`:

```tsx
  const { setEdges, screenToFlowPosition } = useReactFlow()
  const setPlacement = (labelPos: number, off: { x: number; y: number }) =>
    setEdges((es) =>
      es.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data, labelPos, labelOffset: off, labelPinned: true } }
          : e,
      ),
    )
  const unpin = (ev: React.MouseEvent) => {
    ev.stopPropagation()
    setEdges((es) =>
      es.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data, labelPinned: false, labelOffset: undefined } }
          : e,
      ),
    )
  }
```

Full `startLabelDrag` (nearest-point-on-path → `labelPos`, then perpendicular residual → `labelOffset`). `getPointAtLength` on the measurement path returns flow coords, and `screenToFlowPosition` brings the cursor into the same space, so no CTM mapping is needed:

```tsx
  const dragging = useRef(false)
  const startLabelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    dragging.current = true
    const el = e.currentTarget
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic event with no active pointer */
    }
    const move = (ev: PointerEvent) => {
      const measure = measureRef.current
      if (!measure) return
      const total = measure.getTotalLength()
      if (!total) return
      const cursor = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      // nearest point on the path (flow coords) by sampling
      const N = 100
      let bestT = 0
      let bestD = Infinity
      let bestPt = { x: 0, y: 0 }
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const p = measure.getPointAtLength(t * total)
        const d = (p.x - cursor.x) ** 2 + (p.y - cursor.y) ** 2
        if (d < bestD) {
          bestD = d
          bestT = t
          bestPt = { x: p.x, y: p.y }
        }
      }
      setPlacement(bestT, { x: cursor.x - bestPt.x, y: cursor.y - bestPt.y })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setTimeout(() => {
        dragging.current = false
      }, 60)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
```

- [ ] **Step 4: Verify it compiles + full suite**

Run: `npx tsc --noEmit && npx vitest run` → tsc 0, no regressions.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/SmartTestEdge.tsx
git add src/SmartTestEdge.tsx
git commit -m "feat(canvas): smart-edge label placement (auto + drag-to-pin)"
```

---

### Task 6: Wire the coordinator into the canvas

**Files:**
- Modify: `src/App.tsx` (call the hook inside the `Flow` component)
- Test: `npx tsc --noEmit` + full `npx vitest run`, then a manual browser walkthrough.

**Interfaces:**
- Consumes: `useLabelDeoverlap` (Task 4); `activeRouting` (already in `Flow` from the routing feature).

- [ ] **Step 1: Call the hook**

In `src/App.tsx`, import and call it inside `Flow` (it already has `const activeRouting = useActiveRouting()`):

```tsx
import { useLabelDeoverlap } from './useLabelDeoverlap'
// ...inside Flow(), near the other hooks:
useLabelDeoverlap(activeRouting.router === 'pathfinding')
```

- [ ] **Step 2: Full gate**

Run: `npx tsc --noEmit && npx vitest run` → tsc 0; all tests pass.

- [ ] **Step 3: Manual browser walkthrough**

On a pathfinding diagram (e.g. Raven Core):
1. The two previously-overlapping labels now sit apart (auto de-collision).
2. Select an edge, drag its label — it follows the cursor and stays where dropped; reload → still there (pinned/persisted).
3. Drag a node — unpinned labels re-spread live; the pinned one stays put.
4. Double-click the pinned label — it returns to auto placement.
5. Switch the diagram to Waypoint — smart-edge label logic is gone and waypoint labels are unchanged.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write src/App.tsx
git add src/App.tsx
git commit -m "feat(canvas): run label de-collision on pathfinding diagrams"
```

---

## Notes for the implementer

- The measurement in Task 4 and the render/drag in Task 5 are DOM-bound; jsdom does not implement `getPointAtLength`/`getBoundingClientRect` geometry, so they are deliberately manual-verified (Task 6). The resolver (Task 2) carries the real automated coverage.
- Do not persist auto placement. Only `startLabelDrag`/`unpin` write to the edge (and thus the model). The store (Task 3) is ephemeral and is never read by `canvasToModel`.
- Keep waypoint edges untouched throughout.

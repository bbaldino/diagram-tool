# Draggable Edge Labels (Along the Path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag an edge's label to reposition it along the edge path (anchored to the line), stored as a fraction `labelPos ∈ [0,1]` and persisted.

**Architecture:** Add `DEdge.labelPos` (default 0.5) carried through the existing op/diff pipeline. The custom `WaypointEdge` places the label at fraction `t` along the rendered path via a hidden measurement `<path>` + the SVG `getPointAtLength` API (shape-agnostic), and — when the edge is selected — lets you drag the label, projecting the pointer to the nearest point on the path to set `t`.

**Tech Stack:** TypeScript, React, `@xyflow/react` (React Flow v12), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-draggable-edge-labels-design.md`

## Global Constraints

- `labelPos` is a fraction in `[0,1]`; optional on `DEdge`; **absent means 0.5** (path midpoint). No migration.
- The label is **always anchored to the path**: we only ever store/apply `t` and render via `getPointAtLength(t * totalLength)`; the label can slide along the line but never float off it.
- Dragging is **selection-gated**: the label is interactive only when its edge is `selected` (unselected labels keep `pointer-events: none`), matching the waypoint-dot model.
- Placement is **shape-agnostic** (straight / bezier / catmull / waypoint) via the browser SVG path API — measured from the actual rendered path `d`.
- Persist through the existing `edge.update` op + edge diff; no new op types, no changes to `diff.ts`/`ops.ts` logic.
- A label drag must not add a waypoint or pan the canvas (`stopPropagation`; reuse the existing `dragging` ref so the add-waypoint click is suppressed).
- Client-only. Keep `npx tsc --noEmit` clean and the full `npx vitest run` suite green.
- Branch: `feat/mcp-server-phase2`.

---

## File Structure

- `webapp/src/model.ts` — add `DEdge.labelPos?: number`.
- `webapp/src/buildGraph.ts` — pass `de.labelPos` into the edge's `data`.
- `webapp/src/App.tsx` — `edgesToDEdges` carries `labelPos` back to the model.
- `webapp/src/WaypointEdge.tsx` — render the label at fraction `t` (measurement path + `getPointAtLength`); add the selected-edge label drag.
- Test: `webapp/src/diff.test.ts` (labelPos round-trips through diff→ops).

---

### Task 1: `labelPos` model field + plumbing (round-trip)

**Files:**
- Modify: `webapp/src/model.ts` (`DEdge`)
- Modify: `webapp/src/buildGraph.ts:43`
- Modify: `webapp/src/App.tsx` (`edgesToDEdges`, ~line 107-121)
- Test: `webapp/src/diff.test.ts`

**Interfaces:**
- Produces: `DEdge.labelPos?: number`; edge `data.labelPos` flows render↔model.

- [ ] **Step 1: Write the failing round-trip test**

Add to `webapp/src/diff.test.ts`:

```ts
import { diffToOps } from './diff'
import { applyOps } from './ops'

describe('edge labelPos round-trip', () => {
  const base = {
    version: 1, templates: [], entities: [],
    diagrams: [{
      id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
      placements: [], groups: [],
      edges: [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' as const }],
      notes: [],
    }],
  }
  it('a labelPos change emits an edge.update patch and applyOps sets it', () => {
    const next = structuredClone(base)
    next.diagrams[0].edges[0].labelPos = 0.8
    const ops = diffToOps(base, next)
    expect(ops).toContainEqual(
      expect.objectContaining({ t: 'edge.update', diagramId: 'd', id: 'e1',
        patch: expect.objectContaining({ labelPos: 0.8 }) }),
    )
    const applied = applyOps(base, ops)
    expect(applied.diagrams[0].edges[0].labelPos).toBe(0.8)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd webapp && npx vitest run src/diff.test.ts -t "labelPos round-trip"`
Expected: FAIL — `labelPos` isn't a known `DEdge` field, so tsc/type errors or the assertion fails.

- [ ] **Step 3: Add the model field**

In `webapp/src/model.ts`, in the `DEdge` interface, add after `color?: string` (and near `orientation`):

```ts
  labelPos?: number // fraction along the path in [0,1] where the label sits; absent = 0.5 (midpoint)
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd webapp && npx vitest run src/diff.test.ts -t "labelPos round-trip"`
Expected: PASS (the edge diff is by-value, so the patch already carries `labelPos`, and `updateEdge` spreads it).

- [ ] **Step 5: Thread `labelPos` through the canvas plumbing**

In `webapp/src/buildGraph.ts`, extend the edge `data` (currently `edge.data = { ...edge.data, shape: de.shape ?? 'default', points: de.points }`):

```ts
    edge.data = { ...edge.data, shape: de.shape ?? 'default', points: de.points, labelPos: de.labelPos }
```

In `webapp/src/App.tsx`, in `edgesToDEdges`, add to the returned object (next to `color`):

```ts
    labelPos: (e.data as any)?.labelPos,
```

- [ ] **Step 6: Typecheck + full suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (including the new one).

- [ ] **Step 7: Commit**

```bash
cd webapp && git add src/model.ts src/buildGraph.ts src/App.tsx src/diff.test.ts
git commit -m "feat: DEdge.labelPos field + canvas plumbing for edge label position"
```

---

### Task 2: Render label at fraction `t` + drag it along the path

**Files:**
- Modify: `webapp/src/WaypointEdge.tsx`

**Interfaces:**
- Consumes: `data.labelPos` (Task 1), `useReactFlow().setEdges`/`screenToFlowPosition`.

**Context:** `WaypointEdge` computes `[d, labelX, labelY]` from `edgePath(...)` and renders the label pill in an `EdgeLabelRenderer` at `labelX/labelY`. The waypoint dots already use a `const dragging = useRef(false)` + a `startDrag(i)` that `setPointerCapture`s and adds `pointermove`/`pointerup` listeners; mirror that for the label. The add-waypoint invisible `<path onClick>` already early-returns `if (dragging.current)`, so reusing the same `dragging` ref suppresses a stray waypoint-add after a label drag.

- [ ] **Step 1: Add React hooks import**

At the top of `webapp/src/WaypointEdge.tsx`, change `import { useRef } from 'react'` to:

```ts
import { useLayoutEffect, useRef, useState } from 'react'
```

- [ ] **Step 2: Compute the label point at fraction `t` from a measurement path**

Inside `WaypointEdge`, after the existing `const [d, labelX, labelY] = edgePath(...)` line, add:

```ts
  const labelPos = Math.max(0, Math.min(1, (data?.labelPos as number) ?? 0.5))
  const measureRef = useRef<SVGPathElement>(null)
  const [labelPt, setLabelPt] = useState<Pt | null>(null)
  // Place the label at a fraction of the path length (shape-agnostic). Measured
  // from the actual rendered path so it works for straight/bezier/catmull/waypoint.
  useLayoutEffect(() => {
    const path = measureRef.current
    if (!path) return
    const total = path.getTotalLength()
    if (!total) { setLabelPt(null); return }
    const p = path.getPointAtLength(labelPos * total)
    setLabelPt({ x: p.x, y: p.y })
  }, [d, labelPos])
  const lx = labelPt?.x ?? labelX
  const ly = labelPt?.y ?? labelY
```

- [ ] **Step 3: Add a `setLabelPos` updater + a label-drag handler**

After the existing `removeAt` definition (and before the `return`), add:

```ts
  const setLabelPos = (t: number) =>
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, labelPos: t } } : e)))

  const startLabelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    dragging.current = true
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic event */ }
    const move = (ev: PointerEvent) => {
      const path = measureRef.current
      if (!path) return
      const total = path.getTotalLength()
      if (!total) return
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      // nearest point on the path by sampling — keeps the label anchored to the line
      const N = 100
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i <= N; i++) {
        const q = path.getPointAtLength((i / N) * total)
        const dx = q.x - p.x
        const dy = q.y - p.y
        const dd = dx * dx + dy * dy
        if (dd < bestDist) { bestDist = dd; best = i }
      }
      setLabelPos(best / N)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setTimeout(() => { dragging.current = false }, 60)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
```

- [ ] **Step 4: Render the measurement path + make the label use `lx/ly` and be draggable when selected**

Replace the label `<div>` and add the hidden measurement path. Change the JSX so the label block reads:

```tsx
      {/* hidden measurement path (same geometry as the visible edge) for label placement */}
      <path ref={measureRef} d={d} fill="none" stroke="none" style={{ pointerEvents: 'none' }} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="wp-label"
            style={{
              transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`,
              color: relColor,
              pointerEvents: selected ? 'all' : 'none',
              cursor: selected ? 'grab' : 'default',
            }}
            onPointerDown={selected ? startLabelDrag : undefined}
            title={selected ? 'drag to move the label along the line' : undefined}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
```

(The inline `pointerEvents`/`cursor` override the `.wp-label { pointer-events: none }` rule only while selected, so no CSS change is needed.)

- [ ] **Step 5: Typecheck + full suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; suite still green (no logic tests touch this component).

- [ ] **Step 6: Browser verification (Playwright)**

With `npm run dev` running (`curl -s -m 3 localhost:5173/api/model >/dev/null && echo UP`), load `http://localhost:5173`, Diagrams tab, pick a diagram with a labeled edge. Verify:
1. Select the edge (click its line). Its label shows a grab cursor. Drag the label toward one endpoint → the label **slides along the line** (its rendered position stays on the path, tracking the nearest path point to the cursor, not the free pointer position) and does **not** float off the edge.
2. Release, then check persistence: `curl -s localhost:5173/api/model` → that edge now has a `labelPos` in `(0,1)` other than 0.5; reload the page → the label is still at the moved position.
3. With the edge **not** selected, the label is not draggable (dragging over it pans/does nothing; `pointer-events` off).
4. Dragging the label did **not** add a waypoint dot to the edge.
5. No console errors.

Close the Playwright browser tab when done. Do not commit/delete `model.json`/`history.json`.

If Playwright is unavailable, say so explicitly and give the exact manual steps — do not claim UI verification you didn't perform.

- [ ] **Step 7: Commit**

```bash
cd webapp && git add src/WaypointEdge.tsx
git commit -m "feat: drag an edge's label along its path (selected edges)"
```

---

## Self-Review

**Spec coverage:**
- `DEdge.labelPos` (0..1, default 0.5), no migration → Task 1. ✓
- Render at fraction via measurement path + `getPointAtLength`, shape-agnostic, fallback to midpoint until measured → Task 2 Steps 2, 4. ✓
- Selection-gated drag; nearest-t by sampling (N=100); live update; persist on settle → Task 2 Steps 3, 4 + Task 1 plumbing. ✓
- Anchored to path (only stores/applies `t`) → Task 2 (no perpendicular offset stored). ✓
- Persist via existing op/diff (no diff.ts/ops.ts change) → Task 1 (by-value edge diff carries `labelPos`; round-trip test proves it). ✓
- `stopPropagation` + shared `dragging` ref so no waypoint-add / pan → Task 2 Step 3. ✓
- Browser-verified (projection uses SVG API) → Task 2 Step 6. ✓

**Placeholder scan:** none — full code in every step. Task 2 is browser-verified (no vitest harness for `WaypointEdge`), matching the existing waypoint-edge/client work; Task 1 carries the unit test for the persistence plumbing.

**Type consistency:** `labelPos` is the same `number` field in `model.ts` (Task 1), read as `data.labelPos` in `WaypointEdge` (Task 2), written by `setLabelPos` into `data.labelPos`, carried by `edgesToDEdges`/`buildGraph` (Task 1). `Pt` is the existing `{x,y}` type in `WaypointEdge`. `dragging` is the existing `useRef(false)` reused by both the waypoint and label drags. `measureRef`/`labelPt`/`lx`/`ly` are introduced and used only within Task 2.

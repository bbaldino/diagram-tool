# Attribution-Aware Label Placement (Solo Stretch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed each pathfinding-edge label's position at the center of its longest *solo* stretch (where the edge runs alone), so labels are attributable when lines bundle.

**Architecture:** A pure `soloLabelPos()` in `labelDeoverlap.ts` computes the anchor fraction; `useLabelDeoverlap` samples all edge paths and feeds each unpinned label that fraction as its seed into the existing de-collision resolver. No re-routing; builds on the label placement feature.

**Tech Stack:** React 18 + TypeScript + Vite + vitest; `@xyflow/react`.

## Global Constraints

- Prettier: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`. Run `npx prettier --write` on touched files before committing.
- Do not regress the suite (675 tests at plan time). Full `npx tsc --noEmit` (0) + `npx vitest run` at each task boundary.
- Branch `edge-routing-experiments`; do not push. Pathfinding labels only; no re-routing.
- Only capitalize the first letter of multi-letter acronyms in identifiers. Run commands from `webapp/`.

---

### Task 1: Pure `soloLabelPos` + tests

**Files:**
- Modify: `src/labelDeoverlap.ts` (add `soloLabelPos`, reusing the existing `Pt` type + `distToSeg`)
- Test: `src/labelDeoverlap.test.ts` (append)

**Interfaces produced:** `soloLabelPos(path: Pt[], others: Pt[][], threshold?: number): number`.

- [ ] **Step 1: Write the failing tests**

Append to `src/labelDeoverlap.test.ts`:

```ts
import { soloLabelPos } from './labelDeoverlap'

// horizontal polyline y=0 from x=x0 to x=x1, sampled at n points
function hSeg(x0: number, x1: number, n = 21): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: 0 }))
}

describe('soloLabelPos', () => {
  it('returns 0.5 for an edge with no other edges', () => {
    expect(soloLabelPos(hSeg(0, 100), [])).toBeCloseTo(0.5, 5)
  })

  it('anchors in the LEFT region when the edge is coincident on its right half', () => {
    // path spans x 0..100; other overlaps x 40..140 → path is solo only on the left
    const pos = soloLabelPos(hSeg(0, 100), [hSeg(40, 140)])
    expect(pos).toBeLessThan(0.4)
  })

  it('anchors in the RIGHT region when the edge is coincident on its left half', () => {
    const pos = soloLabelPos(hSeg(0, 100), [hSeg(-40, 60)])
    expect(pos).toBeGreaterThan(0.6)
  })

  it('falls back to 0.5 when fully coincident with another edge', () => {
    expect(soloLabelPos(hSeg(0, 100), [hSeg(0, 100)])).toBeCloseTo(0.5, 5)
  })

  it('respects the threshold (a parallel edge just beyond it leaves this edge solo)', () => {
    // other is a parallel line 12px away everywhere; threshold 8 → path is solo throughout → 0.5
    const other = hSeg(0, 100).map((p) => ({ x: p.x, y: p.y + 12 }))
    expect(soloLabelPos(hSeg(0, 100), [other], 8)).toBeCloseTo(0.5, 5)
  })
})
```

- [ ] **Step 2: Run — verify fail** — `npx vitest run src/labelDeoverlap.test.ts` (soloLabelPos undefined).

- [ ] **Step 3: Implement**

In `src/labelDeoverlap.ts`, add (it already exports `Pt` and defines `distToSeg`):

```ts
// Min distance from a point to a polyline (Infinity for a degenerate polyline).
function pointToPolyline(p: Pt, poly: Pt[]): number {
  if (poly.length < 2) return Infinity
  let m = Infinity
  for (let i = 0; i < poly.length - 1; i++) m = Math.min(m, distToSeg(p, poly[i], poly[i + 1]))
  return m
}

// The label anchor fraction (0..1) at the center of the longest run of points where
// `path` is farther than `threshold` from every polyline in `others` — i.e. where
// this edge runs alone. 0.5 when there is no such run (coincident end-to-end) or the
// path is degenerate.
export function soloLabelPos(path: Pt[], others: Pt[][], threshold = 8): number {
  if (path.length < 2) return 0.5
  let bestStart = -1
  let bestLen = 0
  let curStart = -1
  let curLen = 0
  for (let i = 0; i < path.length; i++) {
    const solo = others.every((o) => pointToPolyline(path[i], o) > threshold)
    if (solo) {
      if (curStart < 0) curStart = i
      curLen++
      if (curLen > bestLen) {
        bestLen = curLen
        bestStart = curStart
      }
    } else {
      curStart = -1
      curLen = 0
    }
  }
  if (bestLen === 0) return 0.5
  return (bestStart + (bestLen - 1) / 2) / (path.length - 1)
}
```

- [ ] **Step 4: Run — verify pass; full gate; commit**

```bash
npx vitest run src/labelDeoverlap.test.ts && npx tsc --noEmit && npx vitest run
npx prettier --write src/labelDeoverlap.ts src/labelDeoverlap.test.ts
git add src/labelDeoverlap.ts src/labelDeoverlap.test.ts
git commit -m "feat(canvas): soloLabelPos — label anchor on an edge's solo stretch"
```

---

### Task 2: Seed labels from their solo stretch in the coordinator

**Files:**
- Modify: `src/useLabelDeoverlap.ts`
- Read first: the current file — it iterates `.react-flow__edge-smart`, builds each `LabelInput` with `anchorAt`/`normalAt` from the edge's path element and a seed `placement` (currently from the label's `data-*` attributes), then calls `resolveLabelPlacements` and `setLabelPlacements`.
- Test: none automated (DOM measurement; verified manually in this task's step). Do NOT add a jsdom test.

**Interfaces:** consumes `soloLabelPos` (Task 1).

- [ ] **Step 1: Sample every edge's path, seed unpinned labels from their solo stretch**

In `src/useLabelDeoverlap.ts`, inside the effect where edges are gathered:
1. Build a map of each smart edge's sampled path points, e.g.
   `const pathPts = new Map<string, {x:number;y:number}[]>()` — for every
   `.react-flow__edge-smart`, sample its `path.react-flow__edge-path` via
   `getPointAtLength` at ~every 6px into `{x,y}` flow-coord points (same coordinate
   basis the hook already uses for `anchorAt`), keyed by edge id. Do this in a first
   pass so all edges' points are available.
2. When building each `LabelInput`, for an **unpinned** label compute the seed
   `labelPos` from the solo stretch instead of the `data-labelPos` value:
   ```ts
   import { soloLabelPos } from './labelDeoverlap'
   // ...
   const mine = pathPts.get(id) ?? []
   const others = [...pathPts].filter(([oid]) => oid !== id).map(([, pts]) => pts)
   const seedPos = pinned
     ? Number(labelEl.dataset.labelPos ?? '0.5')
     : soloLabelPos(mine, others)
   ```
   Use `seedPos` as `placement.labelPos` in the `LabelInput` (keep the `offset`
   seed as it is today — `{ x: 0, y: 0 }` for unpinned, or the pinned offset for
   pinned). Pinned labels are otherwise unchanged.
3. Leave the rest (obstacle gathering, `resolveLabelPlacements`, `setLabelPlacements`,
   deps, debounce/rAF) exactly as is.

Match the file's existing variable names (`id`, `labelEl`, `pinned`, the `path`
element) — read the file and slot the solo-seed in where the seed `labelPos` is
currently read.

- [ ] **Step 2: Full gate**

Run: `npx tsc --noEmit` (0) and `npx vitest run` (675, no regressions — this change adds no test and must not break existing ones).

- [ ] **Step 3: Manual walkthrough** (controller runs this)

On Raven Core (pathfinding): labels on edges that converge to a shared node should
sit toward each edge's **distinct end** (not stacked in the shared bundle), so each
label clearly belongs to one line. Drag a node → labels re-place sensibly. Drag a
label → it pins and stays (unpinned neighbors still auto-place).

- [ ] **Step 4: Format, commit**

```bash
npx prettier --write src/useLabelDeoverlap.ts
git add src/useLabelDeoverlap.ts
git commit -m "feat(canvas): seed edge labels from their solo stretch"
```

---

## Notes for the implementer

- The pure `soloLabelPos` carries the automated coverage; the coordinator change is
  DOM-measurement bound and manual-verified.
- No re-routing and no waypoint-edge changes — this only moves where a pathfinding
  label sits along its own (unchanged) path.
- If two labels' solo spots collide, the existing de-collision resolver will still
  spread them — accepted for v1 even if it nudges one slightly off its solo stretch.

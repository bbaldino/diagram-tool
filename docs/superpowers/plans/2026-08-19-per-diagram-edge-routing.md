# Per-Diagram Edge Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each diagram choose its edge line-router (ELK waypoint vs A\* pathfinding) and tune the pathfinding knobs, via a persisted per-diagram "Diagram Settings" dialog with a fixed default fallback.

**Architecture:** Shared `DiagramRouting` type + `DEFAULT_ROUTING` constant in `shared/model.ts`; an optional `Diagram.routing` field persisted through a new `diagram.setRouting` op; a client store holding the active diagram's (previewed) routing that seeds the canvas and re-routes edges live; a dialog that edits the store and commits it on Apply.

**Tech Stack:** React 18 + TypeScript + Vite + vitest; `@xyflow/react`; `@tisoap/react-flow-smart-edge`.

## Global Constraints

- Prettier config: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`. Run `npx prettier --write` on every file you touch before committing.
- Do not regress the existing suite (651 tests at plan time). Run `npx vitest run` before each commit.
- All work stays on branch `edge-routing-experiments`; do not push.
- Default `router` is `'waypoint'` — existing behavior is preserved; pathfinding is opt-in per diagram. Switching routers never mutates stored `edge.points`.
- Only capitalize the first letter of multi-letter acronyms in identifiers (house rule); existing names like `gridRatio` stay.
- Run all commands from the `webapp/` directory.

---

### Task 1: Routing types, default, and model helpers

**Files:**
- Modify: `shared/model.ts` (add types near `DiagramType` at line 5; add `routing?` to `Diagram` interface at line 81; add helper functions near `renameDiagram`)
- Test: `shared/routing.test.ts` (create)

**Interfaces:**
- Produces:
  - `type EdgeRouter = 'waypoint' | 'pathfinding'`
  - `type PathAlgo = 'no-diagonal' | 'diagonal' | 'jump-point'`
  - `type DrawStyle = 'stepped' | 'straight' | 'smoothstep' | 'spline'`
  - `interface PathfindingConfig { algo: PathAlgo; draw: DrawStyle; gridRatio: number; nodePadding: number; eps: number; obstacleGroups: boolean; obstacleNotes: boolean; directSkip: boolean }`
  - `interface DiagramRouting { router: EdgeRouter; pathfinding: PathfindingConfig }`
  - `const DEFAULT_ROUTING: DiagramRouting`
  - `function effectiveRouting(d: Diagram): DiagramRouting`
  - `function setDiagramRouting(model: Model, id: string, routing: DiagramRouting): Model`
  - `Diagram.routing?: DiagramRouting`

- [ ] **Step 1: Write the failing test**

Create `shared/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROUTING,
  effectiveRouting,
  setDiagramRouting,
  type Diagram,
  type Model,
} from './model'

function diagram(over: Partial<Diagram> = {}): Diagram {
  return {
    id: 'd1',
    name: 'D',
    title: 'D',
    type: 'topology',
    nodes: [],
    groups: [],
    notes: [],
    edges: [],
    flows: [],
    ...over,
  }
}

describe('effectiveRouting', () => {
  it('returns DEFAULT_ROUTING when the diagram has no override', () => {
    expect(effectiveRouting(diagram())).toEqual(DEFAULT_ROUTING)
  })

  it('returns the diagram override when present', () => {
    const routing = { ...DEFAULT_ROUTING, router: 'pathfinding' as const }
    expect(effectiveRouting(diagram({ routing }))).toEqual(routing)
  })
})

describe('DEFAULT_ROUTING', () => {
  it('defaults to the waypoint router with the tuned pathfinding baseline', () => {
    expect(DEFAULT_ROUTING.router).toBe('waypoint')
    expect(DEFAULT_ROUTING.pathfinding.algo).toBe('jump-point')
    expect(DEFAULT_ROUTING.pathfinding.draw).toBe('smoothstep')
    expect(DEFAULT_ROUTING.pathfinding.nodePadding).toBe(17)
  })
})

describe('setDiagramRouting', () => {
  it('sets routing on the target diagram only', () => {
    const model: Model = {
      version: 1,
      diagrams: [diagram({ id: 'a' }), diagram({ id: 'b' })],
      templates: [],
    }
    const routing = { ...DEFAULT_ROUTING, router: 'pathfinding' as const }
    const next = setDiagramRouting(model, 'a', routing)
    expect(next.diagrams.find((d) => d.id === 'a')?.routing).toEqual(routing)
    expect(next.diagrams.find((d) => d.id === 'b')?.routing).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/routing.test.ts`
Expected: FAIL — `effectiveRouting`/`DEFAULT_ROUTING`/`setDiagramRouting` are not exported.

- [ ] **Step 3: Add the types and `routing` field**

In `shared/model.ts`, just after the `DiagramType` definition (line 5):

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
  pathfinding: PathfindingConfig
}

// Fixed baseline used when a diagram carries no routing override. Router defaults
// to 'waypoint' (current behavior); the pathfinding block is the combo that
// tested best, applied only when a diagram opts into the pathfinding router.
export const DEFAULT_ROUTING: DiagramRouting = {
  router: 'waypoint',
  pathfinding: {
    algo: 'jump-point',
    draw: 'smoothstep',
    gridRatio: 12,
    nodePadding: 17,
    eps: 8,
    obstacleGroups: false,
    obstacleNotes: false,
    directSkip: false,
  },
}
```

In the `Diagram` interface (line 81), add the field after `flows: Flow[]`:

```ts
  routing?: DiagramRouting
```

- [ ] **Step 4: Add the helper functions**

In `shared/model.ts`, next to `renameDiagram`:

```ts
export function effectiveRouting(d: Diagram): DiagramRouting {
  return d.routing ?? DEFAULT_ROUTING
}

export function setDiagramRouting(model: Model, id: string, routing: DiagramRouting): Model {
  return mapDiagram(model, id, (d) => ({ ...d, routing }))
}
```

(`mapDiagram` is the existing private helper `renameDiagram` uses — confirm it is defined above these functions in the same file.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run shared/routing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck and format**

Run: `npx tsc --noEmit && npx prettier --write shared/model.ts shared/routing.test.ts`
Expected: tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add shared/model.ts shared/routing.test.ts
git commit -m "feat(model): DiagramRouting type, DEFAULT_ROUTING, and helpers"
```

---

### Task 2: `diagram.setRouting` op

**Files:**
- Modify: `shared/ops.ts` (add to `Op` union near line 14; add case in `applyOp` near line 55)
- Test: `shared/ops.test.ts` (create if absent; otherwise add to it)

**Interfaces:**
- Consumes: `DiagramRouting`, `setDiagramRouting` (Task 1).
- Produces: `Op` variant `{ t: 'diagram.setRouting'; diagramId: string; routing: DiagramRouting }`.

- [ ] **Step 1: Write the failing test**

Create/append `shared/ops.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyOp } from './ops'
import { DEFAULT_ROUTING, type Model } from './model'

describe('diagram.setRouting op', () => {
  it('sets routing on the addressed diagram', () => {
    const model: Model = {
      version: 1,
      diagrams: [
        { id: 'a', name: 'A', title: 'A', type: 'topology', nodes: [], groups: [], notes: [], edges: [], flows: [] },
      ],
      templates: [],
    }
    const routing = { ...DEFAULT_ROUTING, router: 'pathfinding' as const }
    const next = applyOp(model, { t: 'diagram.setRouting', diagramId: 'a', routing })
    expect(next.diagrams[0].routing).toEqual(routing)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/ops.test.ts`
Expected: FAIL — the op type is not assignable / no case handles it.

- [ ] **Step 3: Add the op variant and case**

In `shared/ops.ts`, add to the `Op` union next to `diagram.rename`:

```ts
  | { t: 'diagram.setRouting'; diagramId: string; routing: import('./model').DiagramRouting }
```

In `applyOp`, add a case next to `case 'diagram.rename':`:

```ts
    case 'diagram.setRouting':
      return M.setDiagramRouting(model, op.diagramId, op.routing)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --write shared/ops.ts shared/ops.test.ts
git add shared/ops.ts shared/ops.test.ts
git commit -m "feat(ops): diagram.setRouting op"
```

---

### Task 3: Active-routing client store

**Files:**
- Modify (rewrite): `src/routingKnobs.ts` — hold the active diagram's previewed `DiagramRouting` instead of a global knobs singleton.
- Test: `src/routingKnobs.test.ts` (create)

**Interfaces:**
- Consumes: `DiagramRouting`, `DEFAULT_ROUTING`, `PathfindingConfig` (Task 1).
- Produces:
  - `getActiveRouting(): DiagramRouting`
  - `setActiveRouting(routing: DiagramRouting): void`
  - `patchPathfinding(patch: Partial<PathfindingConfig>): void`
  - `useActiveRouting(): DiagramRouting`

- [ ] **Step 1: Write the failing test**

Create `src/routingKnobs.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_ROUTING } from '../shared/model'
import { getActiveRouting, setActiveRouting, patchPathfinding } from './routingKnobs'

beforeEach(() => setActiveRouting(DEFAULT_ROUTING))

describe('active routing store', () => {
  it('starts at DEFAULT_ROUTING after seeding', () => {
    expect(getActiveRouting()).toEqual(DEFAULT_ROUTING)
  })

  it('patchPathfinding updates one knob without touching router', () => {
    setActiveRouting({ ...DEFAULT_ROUTING, router: 'pathfinding' })
    patchPathfinding({ nodePadding: 25 })
    expect(getActiveRouting().router).toBe('pathfinding')
    expect(getActiveRouting().pathfinding.nodePadding).toBe(25)
    expect(getActiveRouting().pathfinding.algo).toBe(DEFAULT_ROUTING.pathfinding.algo)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routingKnobs.test.ts`
Expected: FAIL — new exports don't exist.

- [ ] **Step 3: Rewrite the store**

Replace the entire contents of `src/routingKnobs.ts`:

```ts
import { useSyncExternalStore } from 'react'
import { DEFAULT_ROUTING, type DiagramRouting, type PathfindingConfig } from '../shared/model'

// DEMO/experimental: the ACTIVE diagram's previewed routing config. App seeds it
// from the active diagram; the settings dialog edits it so edges re-route live;
// Apply commits it to the model. SmartTestEdge reads the pathfinding knobs here.

let state: DiagramRouting = DEFAULT_ROUTING
const listeners = new Set<() => void>()

export function getActiveRouting(): DiagramRouting {
  return state
}

export function setActiveRouting(routing: DiagramRouting): void {
  state = routing
  listeners.forEach((l) => l())
}

export function patchPathfinding(patch: Partial<PathfindingConfig>): void {
  setActiveRouting({ ...state, pathfinding: { ...state.pathfinding, ...patch } })
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useActiveRouting(): DiagramRouting {
  return useSyncExternalStore(subscribe, getActiveRouting, getActiveRouting)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/routingKnobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Do NOT typecheck the whole project yet — `SmartTestEdge`, `RoutingKnobsPanel`, and `App` still import the old exports and will be fixed in later tasks. Commit this unit alone:

```bash
npx prettier --write src/routingKnobs.ts src/routingKnobs.test.ts
git add src/routingKnobs.ts src/routingKnobs.test.ts
git commit -m "feat(canvas): active-diagram routing store"
```

---

### Task 4: buildGraph selects edge type by router

**Files:**
- Modify: `src/buildGraph.ts` (signature + the edge `.type` line at ~line 103)
- Test: `src/buildGraph.test.ts` (create if absent; otherwise add)

**Interfaces:**
- Consumes: `EdgeRouter` (Task 1).
- Produces: `buildDiagramGraph(diagram, templates?, router?: EdgeRouter)` — when `router === 'pathfinding'`, edges get `type: 'smart'`; otherwise `type: 'waypoint'`.

- [ ] **Step 1: Write the failing test**

Create/append `src/buildGraph.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDiagramGraph } from './buildGraph'
import type { Diagram } from '../shared/model'

function twoNodeDiagram(): Diagram {
  return {
    id: 'd', name: 'D', title: 'D', type: 'topology',
    nodes: [
      { id: 'n1', label: 'A', position: { x: 0, y: 0 }, fields: [] },
      { id: 'n2', label: 'B', position: { x: 200, y: 0 }, fields: [] },
    ] as Diagram['nodes'],
    groups: [], notes: [],
    edges: [{ id: 'e1', from: 'n1', to: 'n2' }] as Diagram['edges'],
    flows: [],
  }
}

describe('buildDiagramGraph edge router', () => {
  it('uses waypoint edges by default', () => {
    expect(buildDiagramGraph(twoNodeDiagram()).edges[0].type).toBe('waypoint')
  })
  it('uses smart edges when router is pathfinding', () => {
    expect(buildDiagramGraph(twoNodeDiagram(), [], 'pathfinding').edges[0].type).toBe('smart')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/buildGraph.test.ts`
Expected: FAIL — default currently yields `'smart'` (the hardcoded force), and the third parameter is unused.

- [ ] **Step 3: Update the signature and edge-type line**

In `src/buildGraph.ts`, change the function signature:

```ts
export function buildDiagramGraph(
  diagram: Diagram,
  templates: Template[] = [],
  router: EdgeRouter = 'waypoint',
): { nodes: Node[]; edges: AppEdge[] } {
```

Add `EdgeRouter` to the model import at the top:

```ts
import type { Diagram, Field, Node as DNode, Template, EdgeRouter } from '../shared/model'
```

Replace the demo force line (currently `edge.type = 'smart' // DEMO: ...`) with:

```ts
    edge.type = router === 'pathfinding' ? 'smart' : 'waypoint'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/buildGraph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/buildGraph.ts src/buildGraph.test.ts
git add src/buildGraph.ts src/buildGraph.test.ts
git commit -m "feat(canvas): pick edge type from diagram router"
```

---

### Task 5: Smart-edge parity — labels, start marker, store read

**Files:**
- Modify: `src/SmartTestEdge.tsx` (read `useActiveRouting`; render label + `markerStart`)
- Test: `src/SmartTestEdge.test.tsx` (create)

**Interfaces:**
- Consumes: `useActiveRouting` (Task 3).
- Produces: no new exports; `SmartTestEdge` now renders a `.wp-label` element when `label` is set and reads knobs from the store.

**Why no unit test here:** the label's position comes from `SVGPathElement.getTotalLength()` / `getPointAtLength()` on the rendered path. jsdom (the vitest DOM env) does not implement SVG path measurement — both return 0 — so the label would never position in a jsdom render, making any "label appears" assertion fail regardless of correctness. `WaypointEdge`'s label is untested for the same reason. This task is verified manually in Task 8's step 8. This is a deliberate TDD exception for DOM-measurement-bound UI; do not add a jsdom render test for it.

- [ ] **Step 1: Add label rendering, start marker, and store read**

Edit `src/SmartTestEdge.tsx`:

1. Extend imports:

```tsx
import { useLayoutEffect, useRef, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, useNodes, type EdgeProps, type Node } from '@xyflow/react'
```

2. Replace the `useRoutingKnobs` import with the new store hook:

```tsx
import { useActiveRouting } from './routingKnobs'
```

3. Inside the component, replace `const k = useRoutingKnobs()` with:

```tsx
  const k = useActiveRouting().pathfinding
```

4. Pull `label`, `markerStart`, and `data` off props (add to the destructure) and forward `markerStart`. Render the label after computing `path`. Replace the final `return` with:

```tsx
  const measureRef = useRef<SVGPathElement>(null)
  const labelPos = Math.max(0, Math.min(1, (data?.labelPos as number) ?? 0.5))
  const [labelPt, setLabelPt] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const total = el.getTotalLength()
    if (!total) {
      setLabelPt(null)
      return
    }
    const p = el.getPointAtLength(labelPos * total)
    setLabelPt({ x: p.x, y: p.y })
  }, [path, labelPos])

  const relColor = ((style as React.CSSProperties)?.stroke as string) || '#64748b'
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} />
      {label ? (
        <>
          <path ref={measureRef} d={path} fill="none" stroke="none" style={{ pointerEvents: 'none' }} />
          {labelPt ? (
            <EdgeLabelRenderer>
              <div
                className="wp-label"
                style={{
                  transform: `translate(-50%,-50%) translate(${labelPt.x}px,${labelPt.y}px)`,
                  color: relColor,
                  pointerEvents: 'none',
                }}
              >
                {label}
              </div>
            </EdgeLabelRenderer>
          ) : null}
        </>
      ) : null}
    </>
  )
```

Add `label`, `markerStart`, and `data` to the component's props destructure (`source` and `target` are already destructured for the obstacle logic — leave them).

- [ ] **Step 2: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; the existing suite still passes (this change touches only `SmartTestEdge`).

- [ ] **Step 3: Format and commit**

```bash
npx prettier --write src/SmartTestEdge.tsx
git add src/SmartTestEdge.tsx
git commit -m "feat(canvas): smart-edge label + start marker parity"
```

---

### Task 6: Extract `PathfindingControls` from the demo panel

**Files:**
- Create: `src/PathfindingControls.tsx` (the knob controls, bound to the store)
- Modify: `src/RoutingKnobsPanel.tsx` — will be deleted in Task 8; for now leave it, it is replaced there.

**Interfaces:**
- Consumes: `useActiveRouting`, `patchPathfinding` (Task 3); `PathAlgo`, `DrawStyle` (Task 1).
- Produces: `export function PathfindingControls(): JSX.Element` — renders the algorithm/draw selects, grid/padding/simplify sliders, and the obstacle/direct checkboxes, all reading `useActiveRouting().pathfinding` and writing via `patchPathfinding`.

- [ ] **Step 1: Create the component**

Create `src/PathfindingControls.tsx` by moving the control markup out of `RoutingKnobsPanel.tsx` (the `Slider`, `Check`, `rowStyle`, `labelStyle` helpers and the algorithm/draw/grid/padding/simplify/obstacle/direct controls), rebinding each control:
- read from `useActiveRouting().pathfinding`
- write with `patchPathfinding({ ... })` (e.g. `patchPathfinding({ algo: e.target.value as PathAlgo })`, `patchPathfinding({ gridRatio: v })`).

Keep the `simplify` slider disabled unless `draw === 'straight' || draw === 'spline'`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (the component compiles even though nothing imports it yet).

- [ ] **Step 3: Format and commit**

```bash
npx prettier --write src/PathfindingControls.tsx
git add src/PathfindingControls.tsx
git commit -m "feat(canvas): extract PathfindingControls knob component"
```

---

### Task 7: Diagram Settings dialog

**Files:**
- Create: `src/DiagramSettingsDialog.tsx`
- Read first (patterns): `src/DialogShell.tsx`, `src/OpenDiagramDialog.tsx` (how a dialog is structured, titled, and dismissed)
- Test: none automated (UI wiring); manual verification in Task 8.

**Interfaces:**
- Consumes: `useActiveRouting`, `setActiveRouting` (Task 3); `PathfindingControls` (Task 6); `DiagramRouting`, `effectiveRouting`, `EdgeRouter` (Task 1); `sendOps` from `./modelClient`; `Op` from `../shared/ops`.
- Produces: `export function DiagramSettingsDialog(props: { diagramId: string; committed: DiagramRouting; onClose: () => void }): JSX.Element`.
  - `committed` is `effectiveRouting(activeDiagram)` — the last-saved value, used to revert on cancel.

- [ ] **Step 1: Create the dialog**

Create `src/DiagramSettingsDialog.tsx` following the `DialogShell` pattern:

```tsx
import { DialogShell } from './DialogShell'
import { PathfindingControls } from './PathfindingControls'
import { useActiveRouting, setActiveRouting } from './routingKnobs'
import { DEFAULT_ROUTING, type DiagramRouting, type EdgeRouter } from '../shared/model'
import { sendOps } from './modelClient'

export function DiagramSettingsDialog(props: {
  diagramId: string
  committed: DiagramRouting
  onClose: () => void
}) {
  const routing = useActiveRouting()
  const cancel = () => {
    setActiveRouting(props.committed) // revert live preview
    props.onClose()
  }
  const apply = () => {
    void sendOps([{ t: 'diagram.setRouting', diagramId: props.diagramId, routing }])
    props.onClose()
  }
  return (
    <DialogShell title="Diagram settings" onClose={cancel}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '4px 0 12px' }}>
        <span>Edge router:</span>
        {(['waypoint', 'pathfinding'] as EdgeRouter[]).map((r) => (
          <label key={r} style={{ display: 'flex', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="router"
              checked={routing.router === r}
              onChange={() => setActiveRouting({ ...routing, router: r })}
            />
            {r === 'waypoint' ? 'Waypoint (ELK)' : 'Pathfinding (A*)'}
          </label>
        ))}
      </div>
      {routing.router === 'pathfinding' ? <PathfindingControls /> : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button type="button" onClick={() => setActiveRouting(DEFAULT_ROUTING)}>
          Reset to defaults
        </button>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" onClick={apply}>
            Apply
          </button>
        </span>
      </div>
    </DialogShell>
  )
}
```

Adjust the `DialogShell` prop names (`title`/`onClose`) to match the actual signature you read in `src/DialogShell.tsx`; if it differs, use its real props.

- [ ] **Step 2: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --write src/DiagramSettingsDialog.tsx
git add src/DiagramSettingsDialog.tsx
git commit -m "feat(canvas): DiagramSettingsDialog (router + pathfinding knobs)"
```

---

### Task 8: Wire menu, dialog, seeding, buildGraph; remove demo panel

**Files:**
- Modify: `src/menus.ts` (`editMenu` — add the item)
- Modify: `src/App.tsx` (dispatch, dialog mount, seed store on active diagram, pass router to `buildDiagramGraph`, remove `RoutingKnobsPanel` + its `Panel`)
- Delete: `src/RoutingKnobsPanel.tsx`
- Test: `src/menus.test.ts` (add a case if the file exists; otherwise create)

**Interfaces:**
- Consumes: everything above; `effectiveRouting`, `setActiveRouting`, `useActiveRouting`, `DiagramSettingsDialog`.

- [ ] **Step 1: Write the failing menu test**

Add to `src/menus.test.ts` (create if missing, importing `editMenu` and a `MenuFlags` factory as the existing menus tests do — check the file first):

```ts
import { describe, expect, it } from 'vitest'
import { editMenu } from './menus'

const flags = {
  canUndo: false, canRedo: false, hasSelection: false, canGroup: false, canUngroup: false,
  canTidy: false, layoutEngine: 'elk', edgeStyle: 'default', showLegend: true, showMinimap: true,
  snapToGrid: false, noteSpellcheck: true, railVisible: true, railTab: 'inspector',
} as Parameters<typeof editMenu>[0]

describe('editMenu', () => {
  it('includes a Diagram settings item', () => {
    expect(editMenu(flags).some((i) => i.id === 'diagram-settings')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/menus.test.ts`
Expected: FAIL — no item with id `diagram-settings`.

- [ ] **Step 3: Add the menu item**

In `src/menus.ts`, in `editMenu`'s returned array, add at the end:

```ts
    { id: 'diagram-settings', label: 'Diagram settings…', separatorBefore: true },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/menus.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire App — dispatch, state, dialog mount**

In `src/App.tsx`:

1. Imports:

```tsx
import { DiagramSettingsDialog } from './DiagramSettingsDialog'
import { setActiveRouting, useActiveRouting } from './routingKnobs'
import { effectiveRouting } from '../shared/model'
```

2. Remove the `RoutingKnobsPanel` import and its `<Panel position="top-right">…</Panel>` block.

3. Add dialog open state near the existing `openDialog` state (~line 367):

```tsx
const [routingOpen, setRoutingOpen] = useState(false)
```

4. In the menu-item dispatch (where `itemId === 'legend'` etc. are handled, ~line 868), add:

```tsx
else if (itemId === 'diagram-settings') setRoutingOpen(true)
```

5. Seed the store whenever the active diagram changes, and expose its router for the graph build. Near where `activeId` and the active diagram are resolved, add:

```tsx
const activeRouting = useActiveRouting()
useEffect(() => {
  const d = model.diagrams.find((x) => x.id === activeId)
  if (d) setActiveRouting(effectiveRouting(d))
  // Seed ONLY when the active diagram changes. Depending on `model` here would
  // reseed on every model change and clobber an in-progress live preview (the
  // dialog edits the store, not the model, until Apply). Reading the latest
  // model inside is fine — we only need the initial seed for this diagram.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeId])
```

(Use whatever the file already calls the model object and active-diagram lookup; match the existing names.)

6. Pass the router into the graph build. Find the `buildDiagramGraph(diagram, templates)` call and change it to:

```tsx
buildDiagramGraph(diagram, templates, activeRouting.router)
```

Add `activeRouting.router` to that memo's dependency array so a router switch rebuilds edge types.

7. Mount the dialog next to the other dialog mounts (~line 1358):

```tsx
{routingOpen && (
  <DiagramSettingsDialog
    diagramId={activeId}
    committed={effectiveRouting(model.diagrams.find((d) => d.id === activeId)!)}
    onClose={() => setRoutingOpen(false)}
  />
)}
```

- [ ] **Step 6: Delete the demo panel**

```bash
git rm src/RoutingKnobsPanel.tsx
```

- [ ] **Step 7: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; all tests pass (≥ 651 + the new ones).

- [ ] **Step 8: Manual verification**

Run the dev app. Then:
1. Open Edit ▸ Diagram settings… → dialog shows, router defaults to Waypoint.
2. Switch to Pathfinding → knobs appear, edges re-route live as you drag sliders.
3. Apply → close, reopen → settings persisted (came back from the model).
4. Switch to another diagram → its own settings load (default Waypoint unless overridden).
5. Cancel after changing a knob → canvas reverts to the last-applied routing.

- [ ] **Step 9: Format and commit**

```bash
npx prettier --write src/menus.ts src/menus.test.ts src/App.tsx
git add -A
git commit -m "feat(canvas): per-diagram routing settings dialog + menu wiring"
```

---

## Notes for the implementer

- The prior throwaway commits on this branch (`3b72814` pathfinding demo, `ef44939` tuning panel) established the smart edge, the dep, and the store. This plan turns that demo into the real per-diagram feature; the `buildGraph` force and the global panel are removed as part of it.
- `@tisoap/react-flow-smart-edge` is already a dependency (added on this branch). Do not re-add it.
- If `DialogShell`'s real props differ from `title`/`onClose`, follow the file — the dialog content (router radio + `PathfindingControls` + Apply/Cancel/Reset) is what matters.

# Edge Remapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag an existing edge's endpoint to a different node, rewiring the connection, using React Flow's native reconnection.

**Architecture:** Wire React Flow v12 reconnection (`onReconnect` + `reconnectEdge` helper + per-edge `reconnectable`). No model changes: the canvas→model write-back already maps `edge.source/target → DEdge.from/to`, so a reconnect persists, undoes, and streams for free. Reconnect anchors are gated to the selected edge and elevated above others so overlapping endpoints at a shared node are individually grabbable.

**Tech Stack:** Vite + React + TypeScript, React Flow (`@xyflow/react`) v12.11.2, Vitest (node env), Playwright (MCP) for browser verification. Package root: `webapp/`.

**Spec:** `docs/superpowers/specs/2026-07-28-edge-remapping-design.md`

## Global Constraints

- All commands run from `webapp/`. Tests: `npx vitest run`; types: `npx tsc --noEmit`.
- Never use `window.alert` / `window.prompt` / `window.confirm` — use in-app dialogs (`useDialogs()` in `webapp/src/Dialog.tsx`). (Not expected to arise here.)
- App is served over plain-HTTP LAN — avoid secure-context-only browser APIs.
- Capitalize only the first letter of multi-letter acronyms (`RagService`, not `RAGService`).
- Do NOT commit `model.json` / `history.json` (git-ignored runtime state).
- Git commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **No model/schema changes.** Do not touch `model.ts`, ops, diff, or MCP. Reconnection persists purely through the existing `edgesToDEdges` write-back.
- **Preserve edge ids on reconnect.** `reconnectEdge` MUST be called with `{ shouldReplaceId: false }` — the default regenerates the id (verified: `e0-npm-authelia` → `xy-edge__...`), which would break flow references and the `e{i}-{from}-{to}` id scheme.
- A dev server is normally already running on `http://localhost:5173` serving the working tree; use it for browser verification. Do NOT start a second one.

## File Map

- `webapp/src/graph.ts` — add the pure `applyReconnect` helper (Task 1). Already imports `Edge`/`Connection`-adjacent types from `@xyflow/react`.
- `webapp/src/graph.test.ts` — NEW: unit tests for `applyReconnect` (Task 1).
- `webapp/src/App.tsx` — wire `onReconnect`, the `flowEdges` memo (reconnectable = selected), and the ReactFlow props (Task 2).
- `webapp/src/WaypointEdge.tsx` — **no change** (RF renders reconnect anchors above the custom edge content; verified in the RF source).

---

### Task 1: `applyReconnect` pure helper + unit test

**Files:**
- Modify: `webapp/src/graph.ts` (add `applyReconnect`; extend the existing `@xyflow/react` import)
- Test: `webapp/src/graph.test.ts` (new)

**Interfaces:**
- Consumes: `reconnectEdge` and the `Connection`/`Edge` types from `@xyflow/react`.
- Produces: `applyReconnect(oldEdge: Edge, conn: Connection, edges: Edge[]): Edge[]` — returns the edges array with `oldEdge` rewired to `conn`'s source/target/handles, its `id` preserved, and its `data.points` (manual waypoints) cleared. Other edges are unchanged. Task 2 (`App.tsx` `onReconnect`) calls this.

**Context:** `graph.ts` line 1 currently reads `import { type Node, type Edge, MarkerType } from '@xyflow/react'`. `reconnectEdge` is a pure function (verified to run in the node/vitest env) and `Connection` is a type — both come from `@xyflow/react`.

- [ ] **Step 1: Write the failing test**

Create `webapp/src/graph.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { Edge, Connection } from '@xyflow/react'
import { applyReconnect } from './graph'

const edge = (over: Partial<Edge> = {}): Edge => ({
  id: 'e0-npm-authelia', source: 'npm', target: 'authelia', type: 'waypoint',
  data: { points: [{ x: 5, y: 5 }], shape: 'default' }, ...over,
})

describe('applyReconnect', () => {
  it('rewires the target, preserves the id, and clears manual waypoints', () => {
    const edges = [edge()]
    const conn: Connection = { source: 'npm', target: 'sonarr', sourceHandle: null, targetHandle: null }
    const out = applyReconnect(edges[0], conn, edges)
    const e = out.find((x) => x.id === 'e0-npm-authelia')!
    expect(e).toBeTruthy()                          // id unchanged (NOT regenerated)
    expect(e.source).toBe('npm')
    expect(e.target).toBe('sonarr')                 // rewired
    expect((e.data as any).points).toEqual([])      // waypoints cleared
    expect((e.data as any).shape).toBe('default')   // other data preserved
  })

  it('rewires the source and its handle', () => {
    const edges = [edge()]
    const conn: Connection = { source: 'plex', target: 'authelia', sourceHandle: 'right', targetHandle: 'left' }
    const out = applyReconnect(edges[0], conn, edges)
    const e = out.find((x) => x.id === 'e0-npm-authelia')!
    expect(e.source).toBe('plex')
    expect(e.sourceHandle).toBe('right')
    expect(e.targetHandle).toBe('left')
  })

  it('leaves other edges untouched', () => {
    const other = edge({ id: 'e1-a-b', source: 'a', target: 'b', data: { points: [{ x: 1, y: 1 }] } })
    const edges = [edge(), other]
    const conn: Connection = { source: 'npm', target: 'sonarr', sourceHandle: null, targetHandle: null }
    const out = applyReconnect(edges[0], conn, edges)
    const e1 = out.find((x) => x.id === 'e1-a-b')!
    expect(e1.target).toBe('b')
    expect((e1.data as any).points).toEqual([{ x: 1, y: 1 }]) // its waypoints untouched
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd webapp && npx vitest run src/graph.test.ts`
Expected: FAIL — `applyReconnect` is not exported from `./graph`.

- [ ] **Step 3: Implement `applyReconnect`**

In `webapp/src/graph.ts`, change the first import line from:
```ts
import { type Node, type Edge, MarkerType } from '@xyflow/react'
```
to:
```ts
import { type Node, type Edge, type Connection, reconnectEdge, MarkerType } from '@xyflow/react'
```
Then add this exported helper (place it near the other edge helpers such as `makeEdge`):
```ts
// Rewire one edge's endpoint to a new connection. Keeps the edge id stable
// (shouldReplaceId:false — the default REGENERATES it, which would break flow
// references and our e{i}-{from}-{to} ids) and clears manual waypoints so the
// rewired edge gets a clean route instead of doglegs shaped for the old geometry.
export function applyReconnect(oldEdge: Edge, conn: Connection, edges: Edge[]): Edge[] {
  return reconnectEdge(oldEdge, conn, edges, { shouldReplaceId: false }).map((e) =>
    e.id === oldEdge.id ? { ...e, data: { ...e.data, points: [] } } : e,
  )
}
```

- [ ] **Step 4: Run the test + tsc**

Run: `cd webapp && npx vitest run src/graph.test.ts && npx tsc --noEmit`
Expected: 3 tests PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add src/graph.ts src/graph.test.ts
git commit -m "feat: applyReconnect helper — rewire an edge endpoint, keep id, clear waypoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire reconnection into the canvas

**Files:**
- Modify: `webapp/src/App.tsx` (add `onReconnect`, the `flowEdges` memo, and ReactFlow props)
- Verify: browser (Playwright)

**Interfaces:**
- Consumes: `applyReconnect(oldEdge, conn, edges)` from `./graph` (Task 1); `Connection` type and `edgesReconnectable`/`elevateEdgesOnSelect`/`onReconnect` props from `@xyflow/react`.
- Produces: no exports; this is the integration that makes reconnection live.

**Context (exact current state in `App.tsx`):**
- `import { ... type Edge, type Connection } from '@xyflow/react'` at the top (Connection already imported); add nothing there.
- `import { ... } from './graph'` exists — add `applyReconnect` to it.
- `const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])` (line ~176).
- `const [selEdge, setSelEdge] = ...`, set in `onSelectionChange` (line ~290): `setSelEdge(se[0]?.id ?? null)`.
- The `<ReactFlow ... >` opening tag is at line ~732 and currently has `nodes={nodes} edges={edges} onNodesChange=... onEdgesChange={onEdgesChange} onConnect={onConnect} onSelectionChange={onSelectionChange} ... connectionMode={ConnectionMode.Loose} zoomOnDoubleClick={false} proOptions={...}`.

**Why a `flowEdges` memo:** React Flow reads `reconnectable` off each edge object and (RF source, verified) renders the reconnect anchors only when `onReconnect` is set AND the edge is reconnectable. To make anchors appear on the SELECTED edge only, we pass RF a derived edges array where `reconnectable = (edge is selected)`. `onEdgesChange`/`useEdgesState` still own the base `edges` state; the memo just annotates it.

- [ ] **Step 1: Add `applyReconnect` to the graph import**

In `webapp/src/App.tsx`, find the `from './graph'` import group and add `applyReconnect` to the imported names (alphabetical or end of list — match the file's ordering).

- [ ] **Step 2: Add the `onReconnect` handler**

Add near the other edge handlers (e.g. just after `onConnect`, around line 372):
```tsx
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((els) => applyReconnect(oldEdge, newConnection, els))
    },
    [setEdges],
  )
```
No `onReconnectStart`/`onReconnectEnd` are needed: dropping an endpoint on empty canvas never calls `onReconnect`, so React Flow leaves the edge unchanged (revert-on-empty is the default).

- [ ] **Step 3: Add the `flowEdges` memo (reconnectable = selected)**

Add after `selEdge` and `edges` are defined (e.g. near the other `useMemo`s, before the `return`):
```tsx
  // Reconnect anchors are live only on the selected edge (so overlapping
  // endpoints at a shared node stay individually grabbable). Annotate a derived
  // copy; onEdgesChange still owns the base `edges` state. Return the SAME array
  // when nothing changed so React Flow doesn't churn.
  const flowEdges = useMemo(() => {
    let changed = false
    const next = edges.map((e) => {
      const want = e.id === selEdge
      if (!!e.reconnectable === want) return e
      changed = true
      return { ...e, reconnectable: want }
    })
    return changed ? next : edges
  }, [edges, selEdge])
```

- [ ] **Step 4: Update the ReactFlow props**

In the `<ReactFlow ...>` opening tag:
- change `edges={edges}` to `edges={flowEdges}`
- add `onReconnect={onReconnect}`
- add `edgesReconnectable={false}` (unselected edges are never reconnectable)
- add `elevateEdgesOnSelect` (raise the selected edge + its anchors above other edges sharing a node)

Resulting additions (place alongside the existing edge props):
```tsx
        edges={flowEdges}
        onReconnect={onReconnect}
        edgesReconnectable={false}
        elevateEdgesOnSelect
```

- [ ] **Step 5: Type-check**

Run: `cd webapp && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Browser-verify the interaction**

With the dev server running (already on `http://localhost:5173`), via Playwright MCP (load schemas with ToolSearch, e.g. `mcp__playwright__browser_navigate`, `browser_snapshot`, `browser_click`, `browser_drag`, `browser_console_messages`). On a diagram that has edges (e.g. "Logical"):
1. **Rewire:** click an edge to select it, then drag its endpoint anchor (at the source or target node) onto a different node. Confirm the edge now connects to the new node and stays after a moment (persisted). Confirm no console errors.
2. **Waypoints cleared:** on an edge with a manual bend (add one first by selecting the edge and clicking the line to drop a waypoint), reconnect an endpoint and confirm the bend is gone (clean route).
3. **Revert on empty:** start dragging an endpoint and drop it on empty canvas — the edge returns to its original connection, unchanged.
4. **Overlap / z-raise:** on a node where several edges terminate, select one edge and confirm its endpoint anchor is grabbable (sits above the others) and drags that specific edge.
5. Reload the page and confirm a rewired edge kept its new connection (persisted through the store).

Undo the test changes (Ctrl/Cmd-Z) or otherwise restore the diagram so the user's model isn't left modified; confirm via the app that it's back to the original.

- [ ] **Step 7: Run the full suite + tsc**

Run: `cd webapp && npx vitest run && npx tsc --noEmit`
Expected: full suite green (Task 1's tests included); tsc clean.

- [ ] **Step 8: Commit**

```bash
cd webapp && git add src/App.tsx
git commit -m "feat: reconnect edge endpoints by dragging (select-first, z-raised anchors)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Native RF reconnection, no model changes, persists via existing write-back → Architecture + Task 2. ✓
- `onReconnect` clears `data.points` → Task 1 (`applyReconnect`) + Task 2 wiring. ✓
- Revert on drop-to-empty → Task 2 Step 2 (default behavior; no delete). ✓
- Preserve edge id → Global Constraint + Task 1 (`shouldReplaceId: false`, verified). ✓
- Select-first + z-raised anchors (overlap solution) → Task 2 Steps 3-4 (`flowEdges` reconnectable=selected, `edgesReconnectable={false}`, `elevateEdgesOnSelect`). ✓
- WaypointEdge integration risk → resolved by RF render order (anchors above custom edge); documented as "no change", no task needed. ✓
- Self/same-node reconnect not special-cased → not handled (matches spec). ✓
- Detached endpoints deferred → not in plan (matches spec). ✓
- Testing: unit (round-trip: source/target rewired, id preserved, points cleared) → Task 1; browser (rewire persists, waypoints clear, revert, z-raise) → Task 2 Step 6. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step carries full code. Browser steps name concrete actions and expected outcomes.

**Type consistency:** `applyReconnect(oldEdge: Edge, conn: Connection, edges: Edge[]): Edge[]` defined in Task 1, imported and called with `(oldEdge, newConnection, els)` in Task 2 Step 2. `flowEdges` derived from `edges`/`selEdge` (both existing). ReactFlow prop names (`onReconnect`, `edgesReconnectable`, `elevateEdgesOnSelect`) verified against `@xyflow/react` 12.11.2 `component-props.d.ts`. `reconnectEdge` options `{ shouldReplaceId: false }` verified against `ReconnectEdgeOptions` and by running it.

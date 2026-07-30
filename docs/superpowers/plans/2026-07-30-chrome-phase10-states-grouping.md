# Empty State + Group/Ungroup (Chrome Phase 10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the empty "Fresh diagram" canvas state (placeholder + Tidy disabled when empty) and implement real **Group selection** / **Ungroup** actions wired to their selection-derived enabled-states.

**Architecture:** A new pure module `grouping.ts` holds the two node-array transforms (`groupNodes`, `ungroupNodes`) so the tricky reparent/coordinate logic is unit-tested with no DOM. `App.tsx` computes `canGroup`/`canUngroup` from the live `nodes` (which carry React Flow's `.selected`), enables the already-present-but-disabled Arrange menu items, adds dispatch + callbacks, and renders the empty-canvas placeholder + a `canTidy` gate on the pill's Tidy button.

**Tech Stack:** Vite + React 18 + TypeScript, React Flow v12 (`@xyflow/react`), plain CSS, Vitest (node env — pure-function tests only).

## Global Constraints

- Never use `window.alert` / `prompt` / `confirm` — in-app UI only. [[no-native-popups]]
- Never commit `webapp/model.json` or `webapp/history.json`.
- Capitalize only the first letter of multi-letter acronyms.
- App is served over plain-HTTP LAN — no secure-context-only APIs.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Scope decisions locked:** Group/Ungroup are **top-level only** in this phase — `canGroup` requires 2+ selected non-group nodes that are all top-level (`parentId == null`); `canUngroup` requires exactly one selected top-level group. Grouping already-nested nodes and ungrouping a nested group are deferred (they stay greyed). Group **preserves each node's on-screen arrangement** inside the new group (does NOT re-flow into a row). Keyboard shortcuts (⌘G / ⇧⌘G) are NOT wired in this phase — menu-click only (the menu still shows the hint); note this as a deferral.
- **Empty-state definition:** the canvas is "empty/fresh" when a diagram is open (`activeId != null`) and the live canvas has zero nodes of any kind (`nodes.length === 0`). Placeholder copy verbatim: **"Double-click anywhere to add your first entity"** at **12.5px** `#94a3b8`, centered. In this state the Tidy control renders disabled. (Undo is already `undoFlags`-driven — a fresh diagram has no history so it is already disabled; do NOT force-disable Undo, or undo-after-reset breaks.)

---

## File Structure

- **Create** `webapp/src/grouping.ts` — `groupNodes` / `ungroupNodes` pure transforms.
- **Create** `webapp/src/grouping.test.ts` — Vitest unit tests.
- **Modify** `webapp/src/App.tsx` — `canGroup`/`canUngroup` memos; `groupSelection`/`ungroupSelection` callbacks; enable + dispatch the Arrange `group`/`ungroup` items; empty-canvas placeholder; `canTidy` gate.
- **Modify** `webapp/src/CanvasPill.tsx` — add a `canTidy?: boolean` prop that disables the Tidy button.
- **Modify** `webapp/src/index.css` — `.canvas-fresh` placeholder styles.

---

### Task 1: `grouping.ts` pure transforms + tests

**Files:**
- Create: `webapp/src/grouping.ts`
- Test: `webapp/src/grouping.test.ts`

**Interfaces:**
- Consumes: nothing (pure module; self-contained constants).
- Produces:
  - `interface NodeLike { id: string; type?: string; position: { x: number; y: number }; parentId?: string; selected?: boolean; style?: { width?: number; height?: number }; measured?: { width?: number; height?: number }; data?: unknown; extent?: unknown; [k: string]: unknown }`
  - `groupNodes(nodes: NodeLike[], selectedIds: string[], groupId: string, label: string, color: string): NodeLike[]`
  - `ungroupNodes(nodes: NodeLike[], groupId: string): NodeLike[]`

Semantics:
- `groupNodes`: creates a new `type: 'group'` node at the selection's min-corner (minus padding) sized to the selection's bounding box (floored at 220×130); reparents each selected node into it with `parentId = groupId` and position **rebased to be relative to the group origin** (preserving arrangement); clears `selected` on everything except the new group (`selected: true`); returns the group first, then the rest (a valid parent-before-child order). Non-selected nodes are returned with `selected: false` and otherwise unchanged.
- `ungroupNodes`: removes the group node; each **direct** child (`parentId === groupId`) is lifted to absolute position (`group.position + child.position`), with `parentId` and `extent` stripped; grandchildren (nested groups' children) are untouched (they stay relative to their own now-absolute parent). Everything gets `selected: false`.

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/grouping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupNodes, ungroupNodes, type NodeLike } from './grouping'

const svc = (id: string, x: number, y: number): NodeLike => ({
  id, type: 'service', position: { x, y }, measured: { width: 180, height: 72 },
})

describe('groupNodes', () => {
  it('creates a group and reparents the selection, preserving arrangement', () => {
    const nodes = [svc('a', 100, 100), svc('b', 340, 180), svc('c', 999, 999)]
    const out = groupNodes(nodes, ['a', 'b'], 'g1', 'New Group', '#64748b')
    const g = out.find((n) => n.id === 'g1')!
    const a = out.find((n) => n.id === 'a')!
    const b = out.find((n) => n.id === 'b')!
    const c = out.find((n) => n.id === 'c')!
    expect(g.type).toBe('group')
    expect(out[0].id).toBe('g1') // group first (parent before children)
    expect(a.parentId).toBe('g1')
    expect(b.parentId).toBe('g1')
    expect(c.parentId).toBeUndefined() // unselected untouched
    // arrangement preserved: b was 240 right / 80 down of a
    expect(b.position.x - a.position.x).toBe(240)
    expect(b.position.y - a.position.y).toBe(80)
    // group sized at least the minimum
    expect(g.style!.width).toBeGreaterThanOrEqual(220)
    expect(g.style!.height).toBeGreaterThanOrEqual(130)
    // only the group is selected
    expect(g.selected).toBe(true)
    expect(a.selected).toBe(false)
  })

  it('is a no-op when no ids match', () => {
    const nodes = [svc('a', 0, 0)]
    expect(groupNodes(nodes, ['nope'], 'g1', 'X', '#000')).toEqual(nodes)
  })
})

describe('ungroupNodes', () => {
  it('removes the group and lifts children to absolute positions', () => {
    const nodes: NodeLike[] = [
      { id: 'g1', type: 'group', position: { x: 50, y: 60 }, style: { width: 300, height: 200 } },
      { id: 'a', type: 'service', position: { x: 16, y: 40 }, parentId: 'g1', extent: 'parent' },
    ]
    const out = ungroupNodes(nodes, 'g1')
    expect(out.find((n) => n.id === 'g1')).toBeUndefined()
    const a = out.find((n) => n.id === 'a')!
    expect(a.parentId).toBeUndefined()
    expect(a.extent).toBeUndefined()
    expect(a.position).toEqual({ x: 66, y: 100 }) // 50+16, 60+40
  })

  it('group then ungroup restores the original absolute positions', () => {
    const nodes = [svc('a', 100, 100), svc('b', 340, 180)]
    const grouped = groupNodes(nodes, ['a', 'b'], 'g1', 'G', '#64748b')
    const back = ungroupNodes(grouped, 'g1')
    const a = back.find((n) => n.id === 'a')!
    const b = back.find((n) => n.id === 'b')!
    expect(a.position).toEqual({ x: 100, y: 100 })
    expect(b.position).toEqual({ x: 340, y: 180 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp && npx vitest run src/grouping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `grouping.ts`**

Create `webapp/src/grouping.ts`:

```ts
// Pure node-array transforms for Group / Ungroup. DOM-free and dependency-free
// so they unit-test under Vitest's node env. Positions of nested children are
// RELATIVE to their parent (React Flow convention); these helpers do the
// absolute<->relative rebasing that grouping/ungrouping requires.

export interface NodeLike {
  id: string
  type?: string
  position: { x: number; y: number }
  parentId?: string
  selected?: boolean
  style?: { width?: number; height?: number }
  measured?: { width?: number; height?: number }
  data?: unknown
  extent?: unknown
  [k: string]: unknown
}

const GROUP_MIN = { width: 220, height: 130 }
const PAD_X = 24
const PAD_TOP = 44 // clears the group label

// Best-effort size for bounding-box math: explicit style/measured when present,
// else a service-node estimate.
function sizeOf(n: NodeLike): { width: number; height: number } {
  const w = Number(n.style?.width) || Number((n as any).width) || Number(n.measured?.width)
  const h = Number(n.style?.height) || Number((n as any).height) || Number(n.measured?.height)
  if (w && h) return { width: w, height: h }
  return { width: 180, height: 72 }
}

export function groupNodes(
  nodes: NodeLike[],
  selectedIds: string[],
  groupId: string,
  label: string,
  color: string,
): NodeLike[] {
  const selSet = new Set(selectedIds)
  const sel = nodes.filter((n) => selSet.has(n.id))
  if (sel.length === 0) return nodes

  const minX = Math.min(...sel.map((n) => n.position.x))
  const minY = Math.min(...sel.map((n) => n.position.y))
  const originX = minX - PAD_X
  const originY = minY - PAD_TOP
  const maxX = Math.max(...sel.map((n) => n.position.x + sizeOf(n).width))
  const maxY = Math.max(...sel.map((n) => n.position.y + sizeOf(n).height))
  const width = Math.max(GROUP_MIN.width, maxX - originX + PAD_X)
  const height = Math.max(GROUP_MIN.height, maxY - originY + PAD_X)

  const group: NodeLike = {
    id: groupId,
    type: 'group',
    position: { x: originX, y: originY },
    data: { label, color },
    style: { width, height },
    zIndex: -1,
    selected: true,
  }

  const rest = nodes.map((n) =>
    selSet.has(n.id)
      ? {
          ...n,
          parentId: groupId,
          selected: false,
          position: { x: n.position.x - originX, y: n.position.y - originY },
        }
      : { ...n, selected: false },
  )
  // Group first: it precedes its new children, and the pre-existing relative
  // order of everything else (already parent-before-child) is preserved.
  return [group, ...rest]
}

export function ungroupNodes(nodes: NodeLike[], groupId: string): NodeLike[] {
  const g = nodes.find((n) => n.id === groupId)
  if (!g) return nodes
  const gx = g.position.x
  const gy = g.position.y
  const out: NodeLike[] = []
  for (const n of nodes) {
    if (n.id === groupId) continue // drop the group node
    if (n.parentId === groupId) {
      const { parentId: _p, extent: _e, ...rest } = n
      out.push({ ...rest, selected: false, position: { x: gx + n.position.x, y: gy + n.position.y } })
    } else {
      out.push({ ...n, selected: false })
    }
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp && npx vitest run src/grouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/grouping.ts webapp/src/grouping.test.ts
git commit -m "feat(grouping): pure group/ungroup node transforms

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire Group / Ungroup into App

**Files:**
- Modify: `webapp/src/App.tsx`

**Interfaces:**
- Consumes: `groupNodes`, `ungroupNodes` (Task 1); existing `recomputeChildExtents` (already imported from `./graph`), `newId`, `nodes`, `setNodes`, `setSelNode`, `setSelEdge`, the `arrangeMenuItems` memo, and the `onMenuItem` arrange dispatch branch.
- Produces: enabled `group`/`ungroup` menu actions.

- [ ] **Step 1: Add the import**

Add near the other local imports: `import { groupNodes, ungroupNodes } from './grouping'`.

- [ ] **Step 2: Add `canGroup` / `canUngroup` and the action callbacks**

Add (near the other selection-derived values like `hasSelection`, ~App.tsx:1025 — place after `nodes`/`setNodes` and `newId` are in scope):

```ts
  // Group/Ungroup are top-level only this phase. canGroup: 2+ selected non-group
  // nodes, all top-level. canUngroup: exactly one selected top-level group.
  const groupableIds = useMemo(
    () => nodes.filter((n) => n.selected && n.type !== 'group' && n.parentId == null).map((n) => n.id),
    [nodes],
  )
  const canGroup = groupableIds.length >= 2
  const selectedTopGroup = useMemo(
    () => nodes.find((n) => n.selected && n.type === 'group' && n.parentId == null) ?? null,
    [nodes],
  )
  const canUngroup = selectedTopGroup != null

  const groupSelection = useCallback(() => {
    if (groupableIds.length < 2) return
    const gid = newId()
    setNodes((ns) => recomputeChildExtents(
      groupNodes(ns as any, groupableIds, gid, 'New Group', '#64748b') as any,
    ))
    setSelNode(gid)
    setSelEdge(null)
  }, [groupableIds, setNodes])

  const ungroupSelection = useCallback(() => {
    const g = selectedTopGroup
    if (!g) return
    setNodes((ns) => recomputeChildExtents(ungroupNodes(ns as any, g.id) as any))
    setSelNode(null)
    setSelEdge(null)
  }, [selectedTopGroup, setNodes])
```

(`as any` bridges `NodeLike[]` and React Flow's `Node[]`; the shapes are structurally compatible, and `recomputeChildExtents` already round-trips them. If `useMemo`/`useCallback` aren't imported, they already are — App uses both.)

- [ ] **Step 3: Enable the Arrange menu items**

In the `arrangeMenuItems` memo (~App.tsx:975-1002), change the two hardcoded lines:

```ts
    { id: 'group', label: 'Group selection', shortcut: '⌘G', disabled: !canGroup, separatorBefore: true },
    { id: 'ungroup', label: 'Ungroup', shortcut: '⇧⌘G', disabled: !canUngroup },
```

Add `canGroup, canUngroup` to that memo's dependency array. (Leave `bring-front` / `send-back` hardcoded `disabled: true` — out of scope.)

- [ ] **Step 4: Dispatch the actions**

In `onMenuItem`'s `if (menuId === 'arrange')` branch (~App.tsx:1057-1066), add before the `return`:

```ts
      else if (itemId === 'group') groupSelection()
      else if (itemId === 'ungroup') ungroupSelection()
```

Add `groupSelection, ungroupSelection` to the `onMenuItem` `useCallback` dependency array.

- [ ] **Step 5: Verify build + suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; suite green (276 + Task-1 tests).

- [ ] **Step 6: Commit**

```bash
git add webapp/src/App.tsx
git commit -m "feat(grouping): wire Group/Ungroup actions + selection-derived enabled states

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Empty "Fresh diagram" state + Tidy disabled

**Files:**
- Modify: `webapp/src/App.tsx`
- Modify: `webapp/src/CanvasPill.tsx`
- Modify: `webapp/src/index.css`

**Interfaces:**
- Consumes: `nodes`, `activeId` (App); the CanvasPill render.
- Produces: a `canTidy?: boolean` prop on CanvasPill.

- [ ] **Step 1: Add `canTidy` to CanvasPill**

In `webapp/src/CanvasPill.tsx`, add `canTidy?: boolean` to the props interface (default treated as enabled), and on the Tidy button (~CanvasPill.tsx:94-97) add `disabled={props.canTidy === false}` (match however the component reads props — if it destructures, add `canTidy` to the destructure with no default and use `disabled={canTidy === false}`). The Tidy button currently has no `disabled`; add it.

- [ ] **Step 2: Compute the empty/canTidy flags and render the placeholder**

In `webapp/src/App.tsx`:

Add near the other derived flags:

```ts
  const isEmptyCanvas = activeId != null && nodes.length === 0
  const canTidy = nodes.length > 0
```

Pass `canTidy={canTidy}` to `<CanvasPill … />` (the pill rendered in the top-center Panel).

Add the placeholder inside the canvas wrapper (the `<div ref={wrapperRef} …>` that already hosts the transport bar) — place it alongside the transport-bar mount, before the wrapper's closing `</div>`:

```tsx
      {isEmptyCanvas && (
        <div className="canvas-fresh">Double-click anywhere to add your first entity</div>
      )}
```

- [ ] **Step 3: Disable the Arrange Tidy items when empty (optional consistency)**

In `arrangeMenuItems`, set the tidy-related items disabled when `!canTidy`: change `tidy-up` and the Auto-layout `rerun-layout` item to `disabled: !canTidy` (leave `engine-*` and `edge-*` enabled). Add `canTidy` to the memo deps. (If the exact item ids differ, match the existing ids — the dispatch already maps `tidy-up`/`rerun-layout` to `tidy()`.)

- [ ] **Step 4: Add the placeholder CSS**

Append to `webapp/src/index.css`:

```css
/* ---- Empty "Fresh diagram" canvas placeholder ---- */
.canvas-fresh {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* double-click must pass through to the canvas */
  font-size: 12.5px;
  color: #94a3b8;
  z-index: 4;
}
```

- [ ] **Step 5: Verify build + suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; suite green.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/App.tsx webapp/src/CanvasPill.tsx webapp/src/index.css
git commit -m "feat(states): empty Fresh-diagram placeholder + Tidy disabled when empty

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Browser validation (controller-run)

**Files:** none (verification only; use a **throwaway** diagram [[sdd-smokes-use-throwaway-diagram]]).

- [ ] **Step 1: Empty state.** Create a new empty throwaway diagram (or clear one). Confirm the canvas shows "Double-click anywhere to add your first entity", the pill's **Tidy** is disabled, Undo is disabled (no history), and the tab meta reads "0 entities". Double-click the canvas → the add menu still opens (placeholder is click-through). Add an entity → placeholder disappears, Tidy enables.
- [ ] **Step 2: canGroup / canUngroup gating.** With nothing selected, Arrange ▸ Group selection and Ungroup are greyed. Select ONE node → Group still greyed. Shift-select TWO top-level nodes → Group enables, Ungroup greyed. Select a group → Ungroup enables, Group greyed.
- [ ] **Step 3: Group.** Select 2-3 top-level entities → Arrange ▸ Group selection. Confirm a new group appears wrapping them, the entities are now inside it (drag the group → children move with it), their relative arrangement is preserved, and the new group is selected. Verify it persists (reload) and the tab meta group count increments.
- [ ] **Step 4: Ungroup.** Select that group → Arrange ▸ Ungroup. Confirm the group disappears, the children remain at their on-screen positions (do NOT jump to the origin), and they're now top-level (drag one → it moves alone). Reload → persisted.
- [ ] **Step 5: Cleanup.** Delete the throwaway diagram; confirm `git status` shows no `model.json`/`history.json` staged; confirm no real diagram was touched.

---

## Self-Review

**Spec coverage:**
- Empty "Fresh diagram" placeholder + Tidy disabled → Task 3. ✅ (Undo already `undoFlags`-driven; not force-disabled by design.)
- `canGroup` = 2+ top-level non-group nodes selected; `canUngroup` = a top-level group selected; drive greyed states (never hide) → Task 2. ✅
- Group action (create group, reparent selection, preserve arrangement) → Task 1 `groupNodes` + Task 2 wiring. ✅
- Ungroup action (dissolve group, keep children at absolute positions) → Task 1 `ungroupNodes` + Task 2 wiring. ✅

**Placeholder scan:** none — all code steps are concrete. ✅

**Type consistency:** `NodeLike` / `groupNodes` / `ungroupNodes` signatures identical between Task 1 (definition) and Task 2 (consumption); `canTidy` prop identical between Task 3 CanvasPill definition and App usage. ✅

**Deferred (log to fast-follows if surfaced):** ⌘G / ⇧⌘G keyboard shortcuts (menu-click only this phase); grouping already-nested nodes / ungrouping a nested group (top-level only); the group's initial size uses estimated service-node dimensions (user can resize; a later pass could read RF `measured` sizes); read-only/sample mode (deferred by product decision); `bring-front`/`send-back` remain greyed (unimplemented).

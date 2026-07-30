# Chrome redesign — Phase 5: Edit + View menus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the two remaining empty menu-bar titles — **Edit** (Undo/Redo/Cut/Copy/Paste/Duplicate/Delete/Select-all/Deselect) and **View** (Zoom in/out/fit/actual + checkable Legend/Minimap/Inspector/Snap/Flows-panel toggles) — wiring the backed actions and rendering the unbacked ones disabled.

**Architecture:** Edit is pure menu wiring (`editMenuItems` model + `onMenuItem` branch, dispatching to existing `doUndo`/`doRedo`/`deleteSelected`; the rest disabled). View adds **new client toggle state** — `showLegend`/`showMinimap`/`showInspector` (default true) and `snapToGrid` (default false) — that gates the corresponding renders and feeds React Flow's `snapToGrid`/`snapGrid`; its zoom items call the existing `rf` (React Flow instance) methods. `MenuBar`/`menuNav` already support `checked` (✓) and disabled — no changes there.

**Tech Stack:** React 18 + React Flow v12, hand-written plain CSS. Vitest node env (no DOM). Verified by `tsc` + full suite + the controller Playwright pass (Task 3).

**Design source (authoritative — implementers read it):** `redesign-review/design_handoff_top_chrome/README.md` §"Menu contents → Edit" and §"Menu contents → View" (item lists, shortcuts, checkable items) and §"Menu contents" preamble (`✓` on checkable/checked items; disabled ≠ hidden).

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and the full `npx vitest run` green (currently 266/266). Run from `webapp/`.
- **No `MenuBar`/`menuNav` changes** — they already support `checked`/`disabled`/submenu.
- **Backed actions get wired; unbacked render `disabled` (never hidden), never given fake behavior.**
  - Edit — wired: Undo, Redo, Delete. Disabled: Cut, Copy, Paste, Duplicate, Select all, Deselect (no clipboard / not wired).
  - View — wired: Zoom in/out/fit/actual (via `rf`), and the toggles Legend/Minimap/Inspector/Snap (new state). Disabled: Flows panel (its home, the right rail, is a later phase).
- **Non-destructive to behavior:** `snapToGrid` defaults **false** (preserves today's free drag); the toggle turns it on. (This intentionally deviates from the handoff's "on by default" for Snap — enabling grid-snap silently would change drag behavior. Legend/Minimap/Inspector default **true**, matching today's always-rendered state.)
- **Enable/disable reflects state:** Undo/Redo enabled per `undoFlags`; Delete enabled only when something is selected (`selNode || selEdge`). Checkable toggles show `✓` when on.
- Capitalize only the first letter of multi-letter acronyms. No native popups. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Scope:** only the Edit + View menu contents + the toggle state they need. Do not touch the old toolbar, the pill, the Arrange/File menus, or build the Flows rail. Do not add browser-zoom-conflicting global shortcuts (see Task 2).

---

## Current-code integration points (read before starting)

- `src/App.tsx` (`Flow`):
  - `doUndo` (~791) / `doRedo` (~795); `undoFlags: { canUndo, canRedo }` prop. `deleteSelected` (~697) removes the selected node or edge. Selection state: `selNode` / `selEdge` (~224-225).
  - `rf` = `useReactFlow()` instance — has `zoomIn()`, `zoomOut()`, `fitView(opts)`, `zoomTo(level)`. `rf.fitView({ padding: 0.2 })` is already used (e.g. ~364).
  - `fileMenuItems` (~911) / `arrangeMenuItems` — the `MenuItem[]` useMemo pattern to mirror. The `menus` useMemo (~935-942) has `{ id:'edit', …, items: [] }` and `{ id:'view', …, items: [] }` — fill both. `onMenuItem(menuId, itemId)` (~874) — add `'edit'` and `'view'` branches.
  - Renders to gate: `<MiniMap …/>` (~1308); `<Inspector …/>` (~1374, inside the top-right `stack-tr` Panel); the **Legend** block (`<h4>Legend</h4>` … status rows, ~1393-1407, inside the top-left `stack-tl` Panel). `<ReactFlow …>` opening tag (~1290-1300) is where `snapToGrid`/`snapGrid` props go. `<FlowPanel …/>` (~1365) is NOT toggled this phase.
  - A `keydown` effect handles undo/redo/⌘⇧L/⌘⇧T (~1058-1069); another handles ⌘N/⌘⇧E/⌘O (~992-998). Add ⌘I (Inspector toggle) here; DO NOT add ⌘+/⌘−/⌘0 (they collide with browser zoom).
- `src/menuNav.ts` `MenuItem`: `{ id; label; shortcut?; disabled?; danger?; checked?; separatorBefore?; submenu? }`.

**Files this phase changes:** only `src/App.tsx`.

---

### Task 1: Edit menu

**Files:** Modify `src/App.tsx` (`Flow`).

**Interfaces:** Consumes `MenuItem`, `doUndo`, `doRedo`, `deleteSelected`, `undoFlags`, `selNode`, `selEdge`, the existing `menus`/`onMenuItem`.

- [ ] **Step 1: Add `editMenuItems`** (near `fileMenuItems`, ~911):
  ```tsx
  const hasSelection = selNode != null || selEdge != null
  const editMenuItems: MenuItem[] = useMemo(
    () => [
      { id: 'undo', label: 'Undo', shortcut: '⌘Z', disabled: !undoFlags.canUndo },
      { id: 'redo', label: 'Redo', shortcut: '⇧⌘Z', disabled: !undoFlags.canRedo },
      { id: 'cut', label: 'Cut', shortcut: '⌘X', disabled: true, separatorBefore: true },
      { id: 'copy', label: 'Copy', shortcut: '⌘C', disabled: true },
      { id: 'paste', label: 'Paste', shortcut: '⌘V', disabled: true },
      { id: 'duplicate', label: 'Duplicate', shortcut: '⌘D', disabled: true },
      { id: 'delete', label: 'Delete', shortcut: '⌫', disabled: !hasSelection },
      { id: 'select-all', label: 'Select all', shortcut: '⌘A', disabled: true, separatorBefore: true },
      { id: 'deselect', label: 'Deselect', shortcut: 'Esc', disabled: true },
    ],
    [undoFlags.canUndo, undoFlags.canRedo, hasSelection],
  )
  ```
- [ ] **Step 2: Plug into the `menus` array** (~938): `{ id: 'edit' as const, title: 'Edit', items: editMenuItems }`, and add `editMenuItems` to the useMemo deps.
- [ ] **Step 3: `onMenuItem` `'edit'` branch** (~874):
  ```tsx
  if (menuId === 'edit') {
    if (itemId === 'undo') doUndo()
    else if (itemId === 'redo') doRedo()
    else if (itemId === 'delete') deleteSelected()
    // cut/copy/paste/duplicate/select-all/deselect are disabled — never dispatched
    return
  }
  ```
  Add `doUndo`, `doRedo`, `deleteSelected` to `onMenuItem`'s useCallback deps if missing. (No new keyboard shortcuts — undo/redo/delete keys already exist.)
- [ ] **Step 4: tsc + suite green + commit.** `npx tsc --noEmit && npx vitest run`. Commit `feat(chrome): Edit menu (undo/redo/delete; clipboard items disabled)`.

---

### Task 2: View menu + toggle state

**Files:** Modify `src/App.tsx` (`Flow`).

**Interfaces:** Consumes `MenuItem`, `rf`, the `menus`/`onMenuItem`; produces `showLegend`/`showMinimap`/`showInspector`/`snapToGrid` state.

- [ ] **Step 1: Add toggle state** (near the other `useState`s in `Flow`, ~224):
  ```tsx
  const [showLegend, setShowLegend] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [showInspector, setShowInspector] = useState(true)
  const [snapToGrid, setSnapToGrid] = useState(false)
  ```
- [ ] **Step 2: Add `viewMenuItems`**:
  ```tsx
  const viewMenuItems: MenuItem[] = useMemo(
    () => [
      { id: 'zoom-in', label: 'Zoom in', shortcut: '⌘+' },
      { id: 'zoom-out', label: 'Zoom out', shortcut: '⌘−' },
      { id: 'zoom-fit', label: 'Zoom to fit', shortcut: '⇧1' },
      { id: 'zoom-actual', label: 'Actual size', shortcut: '⌘0' },
      { id: 'legend', label: 'Legend', checked: showLegend, separatorBefore: true },
      { id: 'minimap', label: 'Minimap', checked: showMinimap },
      { id: 'inspector', label: 'Inspector', shortcut: '⌘I', checked: showInspector },
      { id: 'snap', label: 'Snap to grid', checked: snapToGrid },
      { id: 'flows-panel', label: 'Flows panel', shortcut: '⌘⇧F', checked: false, disabled: true, separatorBefore: true },
    ],
    [showLegend, showMinimap, showInspector, snapToGrid],
  )
  ```
  Plug into the `menus` array (`{ id: 'view' as const, title: 'View', items: viewMenuItems }`) + add to deps.
- [ ] **Step 3: `onMenuItem` `'view'` branch**:
  ```tsx
  if (menuId === 'view') {
    if (itemId === 'zoom-in') rf.zoomIn()
    else if (itemId === 'zoom-out') rf.zoomOut()
    else if (itemId === 'zoom-fit') rf.fitView({ padding: 0.2 })
    else if (itemId === 'zoom-actual') rf.zoomTo(1)
    else if (itemId === 'legend') setShowLegend((v) => !v)
    else if (itemId === 'minimap') setShowMinimap((v) => !v)
    else if (itemId === 'inspector') setShowInspector((v) => !v)
    else if (itemId === 'snap') setSnapToGrid((v) => !v)
    // flows-panel is disabled — never dispatched
    return
  }
  ```
  Add `rf` to `onMenuItem` deps if missing. (The `useMemo` for menus already depends on the toggle states through `viewMenuItems`.)
- [ ] **Step 4: Gate the renders + wire snap.**
  - `<ReactFlow …>` (opening tag ~1290): add `snapToGrid={snapToGrid} snapGrid={[16, 16]}`.
  - `<MiniMap …/>` (~1308): wrap as `{showMinimap && <MiniMap …/>}`.
  - `<Inspector …/>` (~1374): wrap as `{showInspector && <Inspector …/>}` (keep the surrounding Panel; just gate the Inspector element — or gate whichever wrapper renders only the Inspector, without hiding the toolbar/FlowPanel in the same Panel).
  - The **Legend** block (~1393-1407): wrap the legend markup as `{showLegend && ( … )}` (gate only the Legend, not the whole `stack-tl` Panel / DiagramTabs).
- [ ] **Step 5: Add the ⌘I Inspector-toggle shortcut.** In the keydown effect with ⌘⇧L/⌘⇧T, add ⌘/Ctrl+I → `setShowInspector((v) => !v)` (input-focus guarded, `preventDefault`). DO NOT add ⌘+/⌘−/⌘0/⇧1 (⌘+/⌘−/⌘0 collide with browser zoom; keep zoom menu-click-only this phase — the menu shows the shortcut hints, but only ⌘I is wired as a new key).
- [ ] **Step 6: tsc + suite green + smoke + commit.** `npx tsc --noEmit && npx vitest run`. Playwright-MCP smoke on :5173 (**use a throwaway diagram or keep it read-only/visual — do NOT mutate the real "Homelab (sample)"**; note+skip or headless-fallback if the browser profile is locked): View opens with Zoom items + the toggles showing `✓` on Legend/Minimap/Inspector and none on Snap; toggling Legend/Minimap/Inspector hides/shows them and updates the `✓`; ⌘I toggles the Inspector; Snap toggles `✓`; Zoom in/out/fit/actual change the zoom; Flows panel is greyed; Edit menu (Task 1) shows Undo/Redo/Delete enabled-as-appropriate and the clipboard items greyed; no console errors. Restore any toggle you flipped. Commit `feat(chrome): View menu (zoom + Legend/Minimap/Inspector/Snap toggles)`.

---

### Task 3: Browser validation (controller-run, not a subagent task)

- [ ] Dev server up; reload. **Edit** opens: Undo/Redo reflect availability; Cut/Copy/Paste/Duplicate greyed; Delete greyed with nothing selected, enabled after selecting a node/edge (and deletes it); Select all / Deselect greyed.
- [ ] **View** opens: Zoom in/out/fit/actual work (canvas zoom changes); `✓` on Legend, Minimap, Inspector (default on), none on Snap; toggling each hides/shows the Legend / MiniMap / Inspector and flips its `✓`; Snap on then dragging a node snaps to the grid (off by default); ⌘I toggles the Inspector; Flows panel greyed.
- [ ] Do destructive checks (Delete, dragging with Snap) on a **throwaway diagram**, then delete it — or restore any real-diagram state you change. No console errors; screenshot Edit + View open.

---

## Self-Review

**Spec coverage (Edit+View):** Edit list with Undo/Redo/Delete wired + clipboard/select-all/deselect disabled (Task 1) ✓; View zoom items wired to `rf` (Task 2 Step 3) ✓; Legend/Minimap/Inspector/Snap checkable toggles with state + render gating + `✓` (Task 2 Steps 1-4) ✓; Inspector ⌘I shortcut (Step 5) ✓; Flows panel disabled/deferred (Step 2) ✓; enable/disable reflects `undoFlags`/selection (Task 1) ✓; browser pass (Task 3) ✓. Deviations stated: Snap defaults OFF (behavior-preserving); ⌘+/⌘−/⌘0/⇧1 keyboard not added (browser-zoom collision) — menu clicks still work. Out of scope: Flows rail, clipboard, the toolbar/pill.

**Placeholder scan:** none — both menu models, both `onMenuItem` branches, the toggle state, and the exact renders to gate are given concretely.

**Type consistency:** `editMenuItems`/`viewMenuItems` are `MenuItem[]` (same type the `menus` array + `MenuBar` consume). Item ids dispatched in `onMenuItem`'s `'edit'`/`'view'` branches exactly match the models. `checked` drives the `✓`. `rf.zoomIn/zoomOut/fitView/zoomTo` are React Flow instance methods. `setShowLegend/Minimap/Inspector/SnapToGrid` toggles are consumed by both the render gates and the `checked` flags (single source per toggle).

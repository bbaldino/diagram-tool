# Chrome redesign — Phase 4: Arrange menu

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the (currently empty) **Arrange** menu bar title with Tidy up, Auto-layout ▸ (engine + re-run), Edge style ▸ (Curved/Angular/Straight), and disabled Group/Ungroup + Bring-to-front/Send-to-back items — and retire the old toolbar's `Edges:` `<select>` (now driven from Arrange ▸ Edge style).

**Architecture:** Pure wiring — the `MenuBar` already renders submenus, checkmarks, and the current-value-in-row for submenu parents (`submenuValueLabel` reads the `checked` child). This phase adds an `arrangeMenuItems` model in `Flow` (mirroring `fileMenuItems`), plugs it into the existing `menus` array, extends `onMenuItem` with an `'arrange'` branch dispatching to existing handlers, adds a ⌘⇧T "Tidy up" shortcut, and removes the `Edges:` select. No new component; no `MenuBar`/`menuNav` changes.

**Tech Stack:** React 18 + React Flow v12, hand-written plain CSS. Vitest node env (no DOM). Verified by `tsc` + full suite + the controller Playwright pass (Task 2).

**Design source (authoritative — implementer reads it):** `redesign-review/design_handoff_top_chrome/README.md` §"Menu contents → Arrange" (the item list, shortcuts, submenus, disabled states) and §"Menu contents" preamble (submenu parent shows the current value in-row; `✓` on checkable/selected items).

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and the full `npx vitest run` green (currently 266/266). Run from `webapp/`.
- **No new test stack.** No `MenuBar`/`menuNav` changes — they already support submenu + `checked` + value-in-row.
- **Real, backed actions only get wired; everything else renders `disabled` (never hidden).** Backed this phase: **Tidy up** (`tidy`), **Auto-layout ▸** engine choice + Re-run (`chooseEngine`/`tidy`), **Edge style ▸** (`applyEdgeStyle`). NOT backed (render `disabled`, do not invent behavior): **Group selection**, **Ungroup**, **Bring to front**, **Send to back** (no handlers / no per-node z-order exist).
- **Submenu parents must NOT carry `separatorBefore`** (a submenu-parent with a divider above it mis-positions the flyout — known `MenuBar` constraint). Auto-layout ▸ and Edge style ▸ are not separator-prefixed here.
- `✓` (`checked`) marks the current engine (Auto-layout ▸) and current edge style (Edge style ▸) so the parent row shows e.g. "Auto-layout ▸ Graphviz" / "Edge style ▸ Curved".
- Capitalize only the first letter of multi-letter acronyms. No native popups. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Scope:** only the Arrange menu + the `Edges:` select removal. Leave the rest of the old toolbar (`+ Group`, `+ Note`, `Flow:`, `+ Flow`, `Edit`, `Play`, `Rename`, `Delete`) untouched — later phases. Do not touch Edit/View menus (still empty this phase).

---

## Current-code integration points (read before starting)

- `src/App.tsx` (`Flow`):
  - `tidy` (~800) → runs `/api/layout` with the current engine.
  - `layoutEngine: 'elk'|'graphviz'` (~226) + `chooseEngine(e)` (~230, persists).
  - `edgeStyle: 'default'|'smoothstep'|'straight'` (~226) + `applyEdgeStyle(style)` (~857, sets state + updates every edge's `data.shape`).
  - `fileMenuItems: MenuItem[] = useMemo(…, [...])` (~911) — the model pattern to mirror.
  - `menus = useMemo(() => [ {id:'file',title:'File',items:fileMenuItems}, {id:'edit',…,items:[]}, {id:'view',…,items:[]}, {id:'arrange',title:'Arrange',items:[]} ], [fileMenuItems])` (~935-942).
  - `onMenuItem(menuId, itemId)` (~874) — currently handles `'file'` items and the `'_save'` retry; add an `'arrange'` branch.
  - The shortcut `keydown` handling: undo/redo/⌘⇧L are in one effect (~1058-1069); ⌘N/⌘⇧E/⌘O in another (~992-998). Add ⌘⇧T next to ⌘⇧L (both call `tidy`).
  - The old toolbar `.panel.toolbar` still contains the `Edges:` `<label className="edgestyle"><select value={edgeStyle} onChange={(e) => applyEdgeStyle(e.target.value as any)}>…Curved/Angular/Straight…</select></label>` (~1313-1319) — REMOVE this block.
- `src/menuNav.ts` `MenuItem` type: `{ id; label; shortcut?; disabled?; danger?; checked?; separatorBefore?; submenu? }`.
- `src/MenuBar.tsx` `submenuValueLabel(item)` (~23): returns the `checked` child's label to show inline on the submenu-parent row — already wired; nothing to change.

**Files this phase changes:** only `src/App.tsx`.

---

### Task 1: Build the Arrange menu, wire it, retire the `Edges:` select

**Files:**
- Modify: `src/App.tsx` (`Flow`)

**Interfaces:**
- Consumes: `MenuItem` (from `./menuNav`), `tidy`, `layoutEngine`, `chooseEngine`, `edgeStyle`, `applyEdgeStyle`, the existing `menus`/`onMenuItem`.

- [ ] **Step 1: Add an `arrangeMenuItems` model** in `Flow` (near `fileMenuItems`, ~911):
  ```tsx
  const arrangeMenuItems: MenuItem[] = useMemo(
    () => [
      { id: 'tidy-up', label: 'Tidy up', shortcut: '⌘⇧T' },
      {
        id: 'auto-layout',
        label: 'Auto-layout',
        submenu: [
          { id: 'engine-graphviz', label: 'Graphviz', checked: layoutEngine === 'graphviz' },
          { id: 'engine-elk', label: 'elkjs', checked: layoutEngine === 'elk' },
          { id: 'rerun-layout', label: 'Re-run layout', shortcut: '⌘⇧L', separatorBefore: true },
        ],
      },
      {
        id: 'edge-style',
        label: 'Edge style',
        submenu: [
          { id: 'edge-default', label: 'Curved', checked: edgeStyle === 'default' },
          { id: 'edge-smoothstep', label: 'Angular', checked: edgeStyle === 'smoothstep' },
          { id: 'edge-straight', label: 'Straight', checked: edgeStyle === 'straight' },
        ],
      },
      { id: 'group', label: 'Group selection', shortcut: '⌘G', disabled: true, separatorBefore: true },
      { id: 'ungroup', label: 'Ungroup', shortcut: '⇧⌘G', disabled: true },
      { id: 'bring-front', label: 'Bring to front', disabled: true, separatorBefore: true },
      { id: 'send-back', label: 'Send to back', disabled: true },
    ],
    [layoutEngine, edgeStyle],
  )
  ```
  (Neither submenu parent has `separatorBefore` — only the disabled group/z-order items do, which is safe since they have no submenu.)

- [ ] **Step 2: Plug it into the `menus` array** (~940): change the arrange entry to `{ id: 'arrange' as const, title: 'Arrange', items: arrangeMenuItems }`, and add `arrangeMenuItems` to the `useMemo` dependency array (`[fileMenuItems, arrangeMenuItems]`).

- [ ] **Step 3: Extend `onMenuItem`** (~874) with an `'arrange'` branch dispatching to existing handlers:
  ```tsx
  if (menuId === 'arrange') {
    if (itemId === 'tidy-up' || itemId === 'rerun-layout') tidy()
    else if (itemId === 'engine-graphviz') chooseEngine('graphviz')
    else if (itemId === 'engine-elk') chooseEngine('elk')
    else if (itemId === 'edge-default') applyEdgeStyle('default')
    else if (itemId === 'edge-smoothstep') applyEdgeStyle('smoothstep')
    else if (itemId === 'edge-straight') applyEdgeStyle('straight')
    // group / ungroup / bring-front / send-back are disabled — never dispatched
    return
  }
  ```
  Place it consistently with the existing `'file'` / `'_save'` handling (early-return style). Ensure `onMenuItem`'s `useCallback` deps include `tidy`, `chooseEngine`, `applyEdgeStyle` (add any missing).

- [ ] **Step 4: Add the ⌘⇧T "Tidy up" shortcut.** In the same keydown effect that has ⌘⇧L (~1058-1069), add ⌘/Ctrl+⇧+T → `tidy()` (input-focus guarded like the others; `preventDefault`). No collision: ⌘⇧E (export) and ⌘⇧L (re-run) are distinct; plain `t` isn't otherwise bound. (Group/Ungroup ⌘G/⇧⌘G are NOT wired this phase — those items are disabled.)

- [ ] **Step 5: Remove the `Edges:` select** from the old `.panel.toolbar` (~1313-1319): delete the `<label className="edgestyle">Edges: <select …>…</select></label>` block. KEEP `edgeStyle`/`applyEdgeStyle` (now consumed by Arrange ▸ Edge style) and everything else in the toolbar.

- [ ] **Step 6: tsc + suite green + smoke + commit.** `npx tsc --noEmit && npx vitest run` (stay 266/266). Quick Playwright-MCP smoke on :5173 (fall back to a headless script or note+skip if the browser profile is locked): Arrange opens with Tidy up (⌘⇧T), Auto-layout ▸ (row shows the current engine; submenu has `✓` on it + Re-run layout ⌘⇧L), Edge style ▸ (row shows the current style; submenu `✓` on it), and Group/Ungroup + Bring/Send rendered greyed; picking an engine / edge style / Tidy up / Re-run all take effect; ⌘⇧T tidies; the old `Edges:` select is gone from the toolbar; no console errors. Commit `feat(chrome): Arrange menu (tidy/auto-layout/edge-style), retire Edges select`.

---

### Task 2: Browser validation (controller-run, not a subagent task)

- [ ] Dev server up; reload. Click **Arrange** — the menu opens with: **Tidy up** (⌘⇧T); **Auto-layout ▸** with the current engine shown in the row (e.g. "Auto-layout ▸ elkjs"); **Edge style ▸** with the current style in the row (e.g. "Edge style ▸ Curved"); a separator; **Group selection ⌘G** and **Ungroup ⇧⌘G** greyed; a separator; **Bring to front** and **Send to back** greyed.
- [ ] Auto-layout ▸ submenu: `✓` on the current engine; switching to the other engine updates the `✓` and the parent-row value, and persists across reload; Re-run layout (⌘⇧L) re-lays-out.
- [ ] Edge style ▸ submenu: `✓` on the current style; picking Angular/Straight/Curved re-renders the edges in that style and updates the parent-row value.
- [ ] Tidy up (and ⌘⇧T) re-lays-out the diagram.
- [ ] The old top-right toolbar no longer has the `Edges:` select; the remaining controls still work.
- [ ] Greyed items (Group/Ungroup/Bring/Send) don't respond to clicks. No console errors; screenshot Arrange open (+ one submenu).

---

## Self-Review

**Spec coverage (Arrange phase):** Tidy up + ⌘⇧T (Task 1 Steps 1,3,4) ✓; Auto-layout ▸ engine + Re-run, with `✓`/value-in-row (Steps 1-3, MenuBar already supports) ✓; Edge style ▸ + retire `Edges:` select (Steps 1,3,5) ✓; Group/Ungroup + Bring/Send rendered disabled (Step 1) ✓; no submenu-parent has `separatorBefore` (Step 1) ✓; browser pass (Task 2) ✓. Out of scope (stated): Edit/View menu contents, the rest of the toolbar, and actually implementing group/z-order behavior.

**Placeholder scan:** none — Task 1 carries the full `arrangeMenuItems` model + the `onMenuItem` branch + the exact select block to remove; no TBDs.

**Type consistency:** `arrangeMenuItems` is `MenuItem[]` (same type `fileMenuItems` uses and `MenuBar` consumes). `checked` drives both the `✓` and `submenuValueLabel`'s parent-row value (existing `MenuBar` behavior). Item ids dispatched in `onMenuItem`'s `'arrange'` branch exactly match the ids declared in Step 1. `chooseEngine` takes `'elk'|'graphviz'`; `applyEdgeStyle` takes `'default'|'smoothstep'|'straight'` — the branch passes those literals. `tidy` is the shared layout action for Tidy up, Re-run layout, ⌘⇧T, and ⌘⇧L.

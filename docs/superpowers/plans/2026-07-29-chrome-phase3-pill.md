# Chrome redesign — Phase 3: Canvas pill (Undo / Redo / Tidy / Auto-layout)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the redesign's floating **canvas pill** (top-center: Undo · Redo · | · Tidy · Auto-layout ▾) and move those frequently-used controls off the old top-right toolbar into it, with the Auto-layout ▾ dropdown replacing the `Layout:` `<select>`.

**Architecture:** A new presentational `CanvasPill` component renders inside `Flow` as a React Flow `<Panel position="top-center">`, floating over the canvas. It's props-driven (undo/redo enablement + handlers, tidy, current layout engine + choose/re-run). Its Auto-layout ▾ dropdown reuses the existing `.menu*` dropdown styles from Phase 1 (DRY). The four controls (Undo/Redo/Tidy + the `Layout:` select) are removed from the old `.toolbar` in the same task that mounts the pill.

**Tech Stack:** React 18 + React Flow v12, hand-written plain CSS (match existing `index.css`). Vitest node env (no DOM) — the pill is presentational, verified by `tsc` + full suite + the controller Playwright pass (Task 3). No pure-logic helper this phase.

**Design source (authoritative — implementers must read the cited sections):**
`redesign-review/design_handoff_top_chrome/README.md` — §"Canvas pill — 4a, 5b" (pill container + each control + the Auto-layout dropdown), §"Menu contents" / §"Interactions → Pill" (dropdown item styling + open behavior), §"Design tokens". To *see* it: `cd redesign-review/design_handoff_top_chrome && python3 -m http.server 8899` and open `Toolbar Explorations.dc.html` (section **4a** = resting; **5b** = the Auto-layout dropdown open).

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and the full `npx vitest run` green (currently 266/266). Run all commands from `webapp/`.
- **No new test stack** (no jsdom/RTL). The pill is presentational; verified by `tsc` + suite + the Task 3 Playwright pass.
- **Match the handoff's exact values** — colors/sizes/radii/shadows in README §"Canvas pill" + §"Design tokens" are final; type them into `index.css`.
- **Reuse the existing `.menu*` dropdown styles** (from Phase 1's MenuBar) for the Auto-layout ▾ dropdown items — do NOT invent a parallel item style. Only add pill-specific container/button classes (`.pill*`).
- **Real layout engines only:** the app supports exactly `layoutEngine: 'elk' | 'graphviz'` (labels "elkjs" / "Graphviz"). The Auto-layout dropdown lists those two with a `✓` on the current one, a separator, then **Re-run layout ⌘⇧L**. Do NOT add Dagre / ELK-layered / Manual (they don't exist in this codebase — the handoff lists them aspirationally).
- **The pill is capped at 5 controls** (Undo, Redo, divider, Tidy, Auto-layout ▾). Disabled controls grey out, never disappear (so the pill never changes width).
- Icons are the handoff's Unicode stand-ins (`↶` undo, `↷` redo, `◫` tidy, `▾` dropdown, `✓` check) at the given sizes — no new assets.
- No native popups. Capitalize only the first letter of multi-letter acronyms. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Scope:** ONLY the pill's four controls + the `Layout:` select move/are-removed this phase. Leave the rest of the old toolbar (`+ Group`, `+ Note`, `Flow:` select, `+ Flow`, `Edit`, `Play`, `Rename`, `Delete`, `Edges:` select) untouched — they belong to later phases. The pill coexists with the shrinking toolbar.

---

## Current-code integration points (read before starting)

- `src/App.tsx` inner `Flow`:
  - `doUndo` (~791) / `doRedo` (~795) `useCallback`s; enablement via the `undoFlags: { canUndo, canRedo }` prop (line ~216, passed from outer `App`'s `undoMap`).
  - `tidy` (~800): `fetch('/api/layout', { method:'POST', body: JSON.stringify({ diagramId: activeId, engine: layoutEngine }) })` then re-fits. This IS "run layout with the current engine".
  - `layoutEngine` state `'elk'|'graphviz'` (~226) + `chooseEngine(e)` (~231, persists to `localStorage['homelab-layout-engine']`).
  - A `keydown` listener (~1058-1066) handles undo/redo (`z`/`shift+z`/`y`); other shortcut listeners (⌘N/⌘⇧E/⌘O) live in their own effect(s). Text-input focus guards are used by the File/Open shortcuts.
  - The old toolbar is a `<Panel position="top-right" className="stack-tr">` → `<div className="panel toolbar">` containing (in order) `+ Group`, `+ Note`, **`↶ Undo`** (~1261), **`↷ Redo`** (~1262), **`Tidy`** (~1263), a **`Layout:` `<label className="edgestyle"><select>`** (~1264-1271), then `Flow:`/`+ Flow`/`Edit`/`Play`/`Rename`/`Delete`/`Edges:`.
- Phase 1 CSS in `src/index.css`: `.menu`, `.menu__item` (+`.is-active`/`.is-disabled`), `.menu__shortcut`, `.menu__check`, `.menu__sep` — reuse these for the Auto-layout dropdown items.
- React Flow `<Panel position="top-center">` positions a floating panel centered at the top of the canvas — use it to host the pill (the handoff's `top:14px; left:50%` is what `top-center` approximates; add a small top offset if needed via the panel's own margin).

**Files this phase creates/changes:**
- Create: `src/CanvasPill.tsx`.
- Modify: `src/App.tsx` (mount the pill in `Flow`; remove the Undo/Redo/Tidy buttons + the `Layout:` select from the old toolbar; add the ⌘⇧L re-run-layout shortcut), `src/index.css` (append `.pill*` blocks).

---

### Task 1: `CanvasPill` component + CSS

**Files:**
- Create: `src/CanvasPill.tsx`
- Modify: `src/index.css` (append `.pill*` blocks; reuse existing `.menu*` for the dropdown items)

**Interfaces:**
- Consumes: nothing from prior phases at runtime except the shared `.menu*` CSS classes.
- Produces:
  `CanvasPill({ canUndo, canRedo, onUndo, onRedo, onTidy, engine, engines, onChooseEngine, onReRun }: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onTidy: () => void; engine: string; engines: { id: string; label: string }[]; onChooseEngine: (id: string) => void; onReRun: () => void })`
  Renders the pill: an Undo icon button (disabled when `!canUndo`), a Redo icon button (disabled when `!canRedo`), a vertical divider, a Tidy text button (leading `◫`), and an Auto-layout ▾ text button that toggles a dropdown. The dropdown lists each `engines[]` entry as a `.menu__item` with a leading `✓` (`.menu__check`) on the one whose `id === engine` (click → `onChooseEngine(id)` + close), then a `.menu__sep`, then a **Re-run layout** item with shortcut `⌘⇧L` (click → `onReRun()` + close). The dropdown closes on outside-click (capture-phase document listener, mirroring `MenuBar`/`CanvasAddMenu`) and on Esc; the Auto-layout button shows an open/active state while open.

**Design values (read README §"Canvas pill — 4a" + §Interactions → Pill):** container absolute/floating, flex `align-items:center`, `gap:3px`, `padding:5px`, `background:#fff`, `border:1px solid #dfe3ea`, `border-radius:10px`, `box-shadow:0 3px 12px rgba(15,23,42,0.09)`. Undo/Redo: icon button **31×29px**, `border-radius:6px`, icon **15px**, color `#475569`, hover `background:#f1f2f4`, disabled color `#cbd5e1`. Divider: `width:1px; height:18px; background:#e6e9ee; margin:0 4px`. Tidy: text button, height **29px**, padding `0 11px`, `gap:6px`, font **13px/550**, leading `◫` in `#64748b`, disabled label `#b0b8c4`. Auto-layout ▾: same text-button shape, trailing `▾` at **10px** `#94a3b8`; open state button `background:#f1f2f4`. Dropdown: **216px** wide, `.menu`-style panel (reuse), anchored to the button's left edge, item styling per the reused `.menu__item` (checkmark on current engine, separator, Re-run layout with mono `⌘⇧L` shortcut).

**Verification:** `tsc` + full suite green + the Task 3 Playwright pass. No DOM unit test.

- [ ] **Step 1: Build `CanvasPill.tsx`** — the container + Undo/Redo icon buttons (disabled per props) + divider + Tidy + Auto-layout ▾ with its dropdown (open state, engine list with `✓` on current, separator, Re-run layout ⌘⇧L). Outside-click (capture-phase) + Esc close the dropdown. Props exactly as the interface above.
- [ ] **Step 2: Append CSS** to `src/index.css` — `.pill`, `.pill__btn` (icon buttons, +`:disabled`), `.pill__divider`, `.pill__text` (Tidy / Auto-layout text buttons, +`.is-open` for Auto-layout), `.pill__caret`. Reuse `.menu`/`.menu__item`/`.menu__check`/`.menu__shortcut`/`.menu__sep` for the dropdown contents (do not duplicate them). Use the exact token values above.
- [ ] **Step 3: tsc + suite green + commit** — `npx tsc --noEmit && npx vitest run`; commit `feat(chrome): CanvasPill component + styles`. (Not mounted yet — Task 2 mounts it.)

---

### Task 2: Mount the pill, wire it, remove the moved toolbar controls

**Files:**
- Modify: `src/App.tsx` (`Flow`)

**Interfaces:**
- Consumes: `CanvasPill` (Task 1); existing `doUndo`, `doRedo`, `undoFlags`, `tidy`, `layoutEngine`, `chooseEngine`.

- [ ] **Step 1: Mount the pill.** In `Flow`, add a `<Panel position="top-center">` (a sibling of the existing `top-right`/`top-left` panels, inside `<ReactFlow>`) rendering:
  ```tsx
  <CanvasPill
    canUndo={undoFlags.canUndo}
    canRedo={undoFlags.canRedo}
    onUndo={doUndo}
    onRedo={doRedo}
    onTidy={tidy}
    engine={layoutEngine}
    engines={[{ id: 'graphviz', label: 'Graphviz' }, { id: 'elk', label: 'elkjs' }]}
    onChooseEngine={(id) => chooseEngine(id as 'elk' | 'graphviz')}
    onReRun={tidy}
  />
  ```
  (`onReRun` = `tidy`: re-running layout with the current engine is exactly what `tidy` does.)
- [ ] **Step 2: Remove the moved controls from the old toolbar.** Delete the `↶ Undo` `<button>` (~1261), the `↷ Redo` `<button>` (~1262), the `Tidy` `<button>` (~1263), and the entire `Layout:` `<label className="edgestyle">…</label>` select block (~1264-1271) from the `.panel.toolbar`. Leave `+ Group`, `+ Note`, and everything from `Flow:` onward untouched. `doUndo`/`doRedo`/`tidy`/`layoutEngine`/`chooseEngine` all remain (now consumed by the pill) — do not delete them.
- [ ] **Step 3: Add the Re-run-layout shortcut.** In the existing shortcut `keydown` handling in `Flow`, add ⌘/Ctrl+⇧+L → `tidy()` (guard against text-input/textarea/contentEditable focus, matching the other shortcuts; `preventDefault`). Ensure no collision with the existing `z`/`y`/`n`/`e`/`o` shortcuts.
- [ ] **Step 4: tsc + suite green + smoke + commit.** `npx tsc --noEmit && npx vitest run` (stay 266/266). Quick Playwright-MCP smoke on :5173 (fall back to a headless script or note+skip if the shared browser profile is locked): the pill appears top-center with Undo/Redo/Tidy/Auto-layout ▾; Undo/Redo enable/disable correctly and work; Tidy re-lays-out; Auto-layout ▾ opens a dropdown with `✓` on the current engine, switching engines works, Re-run layout works, ⌘⇧L re-lays-out; the old toolbar no longer has Undo/Redo/Tidy or the `Layout:` select. Commit `feat(chrome): mount canvas pill, remove moved toolbar controls, add re-run-layout shortcut`.

---

### Task 3: Browser validation (controller-run, not a subagent task)

- [ ] Dev server up; reload. The floating **pill** sits top-center over the canvas: `↶ ↷ | ◫ Tidy  Auto-layout ▾`.
- [ ] Undo/Redo: greyed when unavailable; after an edit, Undo is enabled and reverts; Redo re-applies. (Pill width doesn't change as they enable/disable.)
- [ ] Tidy re-runs layout (nodes reposition).
- [ ] Auto-layout ▾ opens a 216px dropdown: `✓` on the current engine (Graphviz or elkjs); clicking the other engine switches it (and persists — reload keeps it); Re-run layout re-lays-out; the dropdown closes on outside-click / Esc / choosing an item.
- [ ] ⌘⇧L re-runs layout (ignored while typing in an input).
- [ ] The old top-right toolbar no longer shows Undo / Redo / Tidy or the `Layout:` select; the remaining toolbar controls still work.
- [ ] No console errors; screenshot the pill (resting + Auto-layout open).

---

## Self-Review

**Spec coverage (Phase-3 scope):** pill container + Undo + Redo + divider + Tidy + Auto-layout ▾ (Task 1) ✓; Auto-layout dropdown with current-engine `✓` + separator + Re-run layout ⌘⇧L (Task 1) ✓; mounted top-center over canvas (Task 2) ✓; the four controls removed from the old toolbar incl. the `Layout:` select (Task 2) ✓; ⌘⇧L shortcut (Task 2) ✓; disabled-not-hidden so width is stable (Task 1 CSS) ✓; reuse `.menu*` styles (Global Constraints + Task 1) ✓; real engines only (Global Constraints) ✓; browser pass (Task 3) ✓. Explicitly out of scope: the rest of the old toolbar (+Group/+Note/Flow/Edit/Play/Rename/Delete/Edges) — later phases.

**Placeholder scan:** none — Task 1 pins props/behavior + exact README values (same proven pattern as Phases 1-2); Task 2 gives exact JSX + the specific buttons/select to remove by line.

**Type consistency:** `CanvasPill`'s props (Task 1) are supplied verbatim in Task 2's mount snippet. `engine: string` / `engines: {id,label}[]` / `onChooseEngine(id: string)` accept the app's `'elk'|'graphviz'` (cast at the `chooseEngine` call site). `onTidy` and `onReRun` both map to the existing `tidy`. `canUndo`/`canRedo` come from `undoFlags`. No renamed symbols.

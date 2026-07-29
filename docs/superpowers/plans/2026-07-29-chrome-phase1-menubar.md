# Chrome redesign — Phase 1: Menu bar + File menu

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's plain 40px save-status strip with the redesign's **menu bar** (brand + File / Edit / View / Arrange + save status), and move the File-domain commands (New / Rename / Delete / Import / Export▸JSON / Reset) off the floating toolbar and DiagramBar into a working **File** menu.

**Architecture:** A new full-width `MenuBar` renders at the top of the `Flow` component (a flex column: menu bar above, canvas area below), replacing the outer `App`'s `.tabbar`. A small, reusable menu-dropdown system (open/close, hover-to-switch, keyboard nav, submenus) drives the four menu titles. Only **File** is populated and wired this phase; Edit/View/Arrange render as titles that open (empty for now — later phases). Net-new-feature items in File (Open diagram…, Duplicate, PNG/SVG export) render **disabled/greyed**, not hidden.

**Tech Stack:** React 18 + React Flow v12, hand-written plain CSS (no framework — match existing `index.css` conventions). Vitest runs in the **node env (no DOM)** — component behavior is verified by `tsc` + a controller Playwright pass; only pure helpers get unit tests.

**Design source (authoritative — implementers must read the cited sections):**
`redesign-review/design_handoff_top_chrome/README.md` — §"Menu bar — 4a" (bar + File menu contents + dropdown/item styling), §"Design tokens" (colors/type/spacing/radii/shadows), §"Interactions & behavior → Menus", §"Assets" (Unicode icon map). To *see* it: `cd redesign-review/design_handoff_top_chrome && python3 -m http.server 8899` and open `Toolbar Explorations.dc.html` (section **4a** = resting state + final menus; **5b** = Export submenu + save states).

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and the full `npx vitest run` green.
- **No new test stack** (no jsdom/RTL). Pure helpers are unit-tested in the node env; the React components are verified by `tsc` + the Phase-1 controller Playwright pass.
- **Match the handoff's exact values** — colors, sizes, radii, shadows in README §"Design tokens" are final; type them straight into `index.css`. Follow existing CSS conventions (plain stylesheet, BEM-ish class names like `.iconinput__menu`).
- **Free-standing, non-destructive to behavior:** commands that move must keep their exact current behavior (same handlers, same dialogs). Destructive items (Reset, Delete) keep their existing confirm dialogs.
- **Disabled ≠ hidden:** not-yet-built File items (Open diagram…, Duplicate, Export▸PNG/SVG) render greyed/disabled per the handoff, never removed.
- Brand wordmark is a **placeholder** ("Diagram" is fine) — the indigo brand square + a low-key label; do not invent a product name.
- Icons in the handoff are Unicode stand-ins — use the same Unicode glyphs at the given sizes for now (this phase adds no icon assets).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No native popups (menus/dialogs are in-app; the app already uses `useDialogs`).

---

## Current-code integration points (read before starting)

- `src/App.tsx` **outer `App`** returns `<> <div className="tabbar"><span className="tabbar__save">…save…</span></div> {model && <ReactFlowProvider><Flow …/></ReactFlowProvider>} </>`. `saveState`/`saveLabel`/`saveColor` are computed in `App` (~lines 1255-1270).
- `src/App.tsx` **inner `Flow`** returns `<div ref={wrapperRef} style={{ width:'100vw', height:'calc(100vh - 40px)' }} …><ReactFlow …>… <Panel position="top-right" className="stack-tr"><div className="panel toolbar">…buttons…</div> …Inspector/FlowPanel… </Panel> <Panel position="top-left" className="stack-tl"><DiagramBar …/> …Legend… </Panel> </ReactFlow></div>`.
- Commands living in `Flow`: `exportJson` (button ~1068), `onImport` + `fileRef` file input (~692, 1069-1077), `reset` (~1070). Diagram commands passed to `DiagramBar`: `newDiagram` (onNew), `renameDiagramById` (onRename), `deleteActiveDiagram` (onDelete) (~1108-1115).
- `src/DiagramBar.tsx` renders the diagram `<select>` + `+ Diagram` / `Rename` / `Delete` buttons using `useDialogs()` (`showPrompt`/`showConfirm`).
- `src/Dialog.tsx` exports `useDialogs()` → `{ showPrompt, showConfirm }`.

**Files this phase creates/changes:** create `src/MenuBar.tsx`, `src/menuNav.ts` (+ test); modify `src/App.tsx` (move save state into `MenuBar`, restructure `Flow` layout, remove the moved toolbar buttons, trim `DiagramBar` usage), `src/DiagramBar.tsx` (drop the New/Rename/Delete buttons — keep the `<select>`), `src/index.css` (`.menubar*` / `.menu*` styles; the old `.tabbar` rule may be removed or repurposed).

---

### Task 1: Pure menu model + keyboard-nav helper

**Files:**
- Create: `src/menuNav.ts`
- Test: `src/menuNav.test.ts`

**Interfaces:**
- Produces:
  - `type MenuItem = { id: string; label: string; shortcut?: string; disabled?: boolean; danger?: boolean; checked?: boolean; separatorBefore?: boolean; submenu?: MenuItem[] }`
  - `moveMenuHighlight(items: MenuItem[], current: number, delta: 1 | -1): number` — pure: skips disabled items and separators-only rows, wraps; `current = -1` + `+1` → first enabled; empty/all-disabled → -1.
  - `firstEnabledIndex(items) / lastEnabledIndex(items)` — for Home/End.

**Why:** the only genuinely testable logic in the menu is cursor movement over enabled/disabled items; keep it pure so the component stays a thin view.

- [ ] **Step 1: Write failing tests** (`src/menuNav.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { moveMenuHighlight, firstEnabledIndex, lastEnabledIndex, type MenuItem } from './menuNav'

const items: MenuItem[] = [
  { id: 'new', label: 'New diagram' },
  { id: 'open', label: 'Open diagram…', disabled: true },
  { id: 'rename', label: 'Rename…' },
  { id: 'reset', label: 'Reset diagram…', danger: true },
]

describe('menuNav', () => {
  it('moves down skipping disabled, wrapping', () => {
    expect(moveMenuHighlight(items, -1, 1)).toBe(0)      // none → first enabled
    expect(moveMenuHighlight(items, 0, 1)).toBe(2)        // skip disabled 'open'
    expect(moveMenuHighlight(items, 2, 1)).toBe(3)
    expect(moveMenuHighlight(items, 3, 1)).toBe(0)        // wrap
  })
  it('moves up skipping disabled, wrapping', () => {
    expect(moveMenuHighlight(items, -1, -1)).toBe(3)      // none + up → last enabled
    expect(moveMenuHighlight(items, 2, -1)).toBe(0)       // skip disabled 'open'
    expect(moveMenuHighlight(items, 0, -1)).toBe(3)       // wrap
  })
  it('first/last enabled', () => {
    expect(firstEnabledIndex(items)).toBe(0)
    expect(lastEnabledIndex(items)).toBe(3)
  })
  it('all-disabled → -1', () => {
    const d = items.map((i) => ({ ...i, disabled: true }))
    expect(moveMenuHighlight(d, -1, 1)).toBe(-1)
    expect(firstEnabledIndex(d)).toBe(-1)
  })
})
```

- [ ] **Step 2: Run to confirm RED** — `npx vitest run src/menuNav.test.ts` (module missing).
- [ ] **Step 3: Implement `src/menuNav.ts`** — the type + the three pure helpers. An item is "focusable" when `!disabled`. `moveMenuHighlight` walks `delta` from `current` (treating `-1` as before-first for `+1` / after-last for `-1`), wrapping, up to `items.length` steps; returns -1 if none focusable.
- [ ] **Step 4: Run to confirm GREEN** — `npx vitest run src/menuNav.test.ts`.
- [ ] **Step 5: Full green + commit** — `npx vitest run && npx tsc --noEmit`; commit `feat(chrome): pure menu model + keyboard-nav helper`.

---

### Task 2: `MenuBar` + dropdown/menu components + CSS (File menu wired last task)

**Files:**
- Create: `src/MenuBar.tsx`
- Modify: `src/index.css` (append `.menubar*` and `.menu*` blocks)

**Interfaces:**
- Consumes: `MenuItem`, `moveMenuHighlight`, `firstEnabledIndex`, `lastEnabledIndex` from `./menuNav`.
- Produces:
  `MenuBar({ menus, saveState }: { menus: { id: 'file'|'edit'|'view'|'arrange'; title: string; items: MenuItem[] }[]; onItem: (menuId: string, itemId: string) => void; saveState: { label: string; kind: 'saved'|'saving'|'error' } })`
  Renders the 31px bar (brand square + placeholder wordmark + the four titles) and, on the right, the save status (text only, never a button except `error` which is clickable and calls `onItem('_save','retry')`). Manages `openMenu`/`openSubmenu`/`highlight` internally; renders the open menu's dropdown; calls `onItem(menuId, itemId)` when an enabled item is chosen, then closes.

**Design values:** read README §"Menu bar — 4a" (bar: 31px, `#fbfbfc`, bottom border `1px #eceff3`, padding 12px; brand 13×13 `#4f46e5` r3 + wordmark 13px/650; titles 13px/400, padding `4px 9px`, r5, hover `#eceff3`, open `#eceff3`+500) and §"Menu contents" (dropdown panel `#fff`, border `1px #dfe3ea`, r `0 0 9px 9px`, shadow `0 12px 32px rgba(15,23,42,0.15)`, padding 6px, width 252–268px; item row flex space-between, padding `6px 9px`, r5, 13px, hover `#f1f2f9`; shortcut mono 11px `#94a3b8`; disabled `#b0b8c4`; danger `#b91c1c`; separator 1px `#eceff3` margin `5px 4px`; submenu parent trailing `›` + current value in-row, opens flush to panel's right edge, top-aligned to its row) and §"Interactions → Menus" (click to open; hover a sibling title switches without a click; click-outside/Esc/choose closes; ↑↓ move, →/← enter/leave submenu, ⏎ activates, Home/End jump; z-index above canvas/legend/inspector). Save states + colors: README §"Menu bar" bullet list + tokens (`saved` `#16a34a`, `saving` `#64748b`, `error` `#b91c1c`).

**Verification note:** no DOM test stack — this task is verified by `tsc` clean + full suite green + the Phase-1 Playwright pass (Task 4). Do NOT add jsdom/RTL. Keep behavior logic delegated to `menuNav` (Task 1).

- [ ] **Step 1: Build `MenuBar.tsx`** — the bar, brand, titles, save status; `openMenu` state (click toggles; hovering another title while one is open switches it); `useEffect` capture-phase document listener to close on outside click (mirror the existing add-menu dismiss pattern in `App.tsx` — capture phase, since d3-zoom stops bubbling); Esc closes. Render the active menu's dropdown positioned under its title. Keyboard: when a menu is open, ↑/↓ via `moveMenuHighlight`, Home/End via first/last, ⏎ activates the highlighted item (calls `onItem`, closes), Esc closes; `→` opens a highlighted item's submenu, `←` closes the submenu. Submenu renders flush-right of the panel, top-aligned to its parent row (absolute within the item row, NOT canvas coords — see README note). Enabled item click → `onItem` + close; disabled item → no-op.
- [ ] **Step 2: Append CSS** to `src/index.css` — `.menubar`, `.menubar__brand`, `.menubar__word`, `.menubar__title` (+`.is-open`), `.menubar__save` (+ kind modifiers), `.menu` (dropdown), `.menu__item` (+`.is-active`,`.is-disabled`,`.is-danger`), `.menu__shortcut`, `.menu__check`, `.menu__sep`, `.menu__submenu-parent` (trailing `›` + value), `.menu__submenu`. Use the exact token values above. z-index above the pill/panels.
- [ ] **Step 3: tsc + suite green + commit** — `npx tsc --noEmit && npx vitest run`; commit `feat(chrome): MenuBar shell + dropdown/menu components + styles`. (MenuBar is not yet mounted; that happens in Task 3.)

---

### Task 3: Mount the menu bar, wire File, and remove the moved controls

**Files:**
- Modify: `src/App.tsx` (both `App` and `Flow`), `src/DiagramBar.tsx`

**Interfaces:**
- Consumes: `MenuBar` (Task 2), the existing command handlers in `Flow`.

**Why:** land the redesign — the File menu becomes the working home for New/Rename/Delete/Import/Export▸JSON/Reset, and the old buttons for those disappear.

- [ ] **Step 1: Restructure `Flow`'s layout** — wrap `Flow`'s return in a flex column `<div className="shell">`: first child `<MenuBar … />` (full width, 31px), second child the existing canvas wrapper. Change the wrapper's fixed `height: calc(100vh - 40px)` to fill the remaining space (e.g. `flex: 1; min-height: 0` on the wrapper and `height: 100vh; display: flex; flex-direction: column` on `.shell`). Verify the canvas still fills and React Flow sizes correctly (it measures its container).
- [ ] **Step 2: Move save state into the bar** — pass `saveState` from `App` down to `Flow` as a prop (lift `saveState`/`saveLabel` or pass the raw state and compute the label/kind in `Flow`/`MenuBar`), and delete the outer `App`'s `<div className="tabbar">…</div>`. `App`'s return becomes just `{!model ? null : <ReactFlowProvider><Flow … saveState=… /></ReactFlowProvider>}`.
- [ ] **Step 3: Build the File menu model + handlers** in `Flow` and pass to `MenuBar`. Items (README §File table), with `onItem('file', id)` dispatching:
  - `new` "New diagram" ⌘N → existing new-diagram flow (`newDiagram` — same prompt).
  - `open` "Open diagram…" ⌘O → **disabled** (Phase 3).
  - `rename` "Rename…" → `renameDiagramById(activeId)` (existing prompt).
  - `duplicate` "Duplicate" → **disabled** (new feature, later).
  - separator.
  - `import` "Import JSON…" → `fileRef.current?.click()` (existing hidden file input stays).
  - `export` "Export ▸" submenu: `export-json` "JSON" ⌘⇧E → `exportJson()`; `export-png-view` / `export-png-all` / `export-svg` → **disabled** (new).
  - separator.
  - `reset` "Reset diagram…" (danger) → `reset()` (existing confirm).
  - `delete` "Delete diagram…" (danger) → `deleteActiveDiagram()` (existing confirm).
- [ ] **Step 4: Remove the moved controls.** In `Flow`'s toolbar delete the `Export`, `Import`, and `Reset` `<button>`s (keep the hidden `fileRef` `<input>`). In `DiagramBar.tsx` remove the `+ Diagram`, `Rename`, and `Delete` `<button>`s (New/Rename/Delete now live in File) — keep the diagram `<select>` (diagram switching stays here until Phase 3) and drop the now-unused `onNew`/`onRename`/`onDelete` props + their `useDialogs` usage if no longer needed. Update `Flow`'s `<DiagramBar …/>` props accordingly.
- [ ] **Step 5: Minimal shortcuts (wired commands only)** — register a single `keydown` listener (in `Flow`) for the File shortcuts that map to existing commands: ⌘/Ctrl+N → new, ⌘/Ctrl+O → (Open — disabled, ignore for now), ⌘/Ctrl+⇧+E → export JSON. **Ignore when a text input/textarea is focused.** (Broader shortcuts come with later phases; keep this small.)
- [ ] **Step 6: tsc + suite green + commit** — `npx tsc --noEmit && npx vitest run` (255 tests unaffected). Commit `feat(chrome): mount menu bar, wire File menu, remove moved toolbar/DiagramBar controls`.

---

### Task 4: Browser validation (controller-run, not a subagent task)

- [ ] Dev server up; open the app. The top shows the **menu bar** (brand + File / Edit / View / Arrange, save status on the right); the old floating toolbar no longer has Export/Import/Reset, and DiagramBar no longer has +Diagram/Rename/Delete.
- [ ] Click **File** → dropdown opens with the specified items; Open diagram…, Duplicate, and Export▸PNG/SVG render greyed; Reset/Delete are red.
- [ ] Keyboard: with File open, ↓/↑ move highlight (skipping disabled), Esc closes; hovering **Edit** while File is open switches menus.
- [ ] Exercise each wired command: New diagram (prompt), Rename… (prompt), Import JSON… (file picker), Export ▸ JSON (downloads), Reset/Delete (confirm dialogs). Each behaves exactly as before.
- [ ] Submenu: Export ▸ opens flush to the panel's right edge, top-aligned to its row (not mis-placed in canvas coordinates).
- [ ] No console errors; canvas still fills below the bar; screenshot the menu bar + open File menu.

---

## Self-Review

**Spec coverage (Phase 1 scope):** menu bar shell + brand + 4 titles + save status (Task 2/3) ✓; open/close + hover-switch + keyboard nav + submenu (Task 1 helper + Task 2) ✓; File menu populated with existing commands wired and new-feature items disabled (Task 3) ✓; old Export/Import/Reset + DiagramBar New/Rename/Delete removed (Task 3) ✓; layout restructure so the bar sits above the canvas (Task 3) ✓; exact design tokens via README reference ✓; browser pass (Task 4) ✓. Edit/View/Arrange **contents**, the pill, tabs, rail, and dialog restyle are **out of scope** (later phases) — their titles render but open empty menus for now.

**Placeholder scan:** none — helper code + tests are concrete; component/CSS values are pinned to README sections the implementer reads.

**Type consistency:** `MenuItem` and the `menuNav` helpers (Task 1) are consumed unchanged by `MenuBar` (Task 2). `MenuBar`'s `menus`/`onItem`/`saveState` props (Task 2) are supplied by `Flow` (Task 3). Command handlers reused by id verbatim (`newDiagram`, `renameDiagramById`, `deleteActiveDiagram`, `exportJson`, `reset`, `fileRef`).

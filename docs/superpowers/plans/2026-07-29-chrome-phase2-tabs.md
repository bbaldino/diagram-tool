# Chrome redesign — Phase 2: Diagram tab strip + Open dialog

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the corner diagram `<select>` (the current `DiagramBar`) with the redesign's **diagram tab strip** — a 34px full-width strip below the menu bar showing open diagrams as tabs (click to switch, ×/middle-click to close, `+` to create, active-diagram meta line) — and add a working **Open diagram** dialog that lights up `File ▸ Open diagram…` (⌘O).

**Architecture:** A new full-width `DiagramTabs` strip renders as the second row of `Flow`'s existing `.shell` flex column (menu bar → tab strip → canvas). "Open tabs" is new **client-side** state in the outer `App` (`openTabs: string[]`, persisted to `localStorage`), with the active tab being the existing `activeId` (one source of truth). A new `OpenDiagramDialog` modal component (bespoke, styled like the existing `Dialog.tsx` modal) lists all diagrams filterably and opens the chosen one into a tab. Pure open-tabs list logic lives in a testable `tabsState.ts` helper.

**Tech Stack:** React 18 + React Flow v12, hand-written plain CSS (match existing `index.css` conventions — no framework). Vitest runs in the **node env (no DOM)** — pure helpers get unit tests; components are verified by `tsc` + full suite + the controller Playwright pass (Task 5).

**Design source (authoritative — implementers must read the cited sections):**
`redesign-review/design_handoff_top_chrome/README.md` — §"Diagram tab strip — 4a, 5b" (strip + tab + `+` + meta styling), §"Dialogs — 5c" → "Open diagram (⌘O)" (dialog shell + rows + footer), §"Design tokens" (colors/type/spacing/radii/shadows), §"Interactions & behavior". To *see* it: `cd redesign-review/design_handoff_top_chrome && python3 -m http.server 8899` and open `Toolbar Explorations.dc.html` (section **4a** = tab strip resting; **5b** = overflow/meta states; **5c** = Open dialog).

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and the full `npx vitest run` green (currently 259/259). Run all commands from `webapp/`.
- **No new test stack** (no jsdom/RTL). Pure helpers are unit-tested in the node env; React components are verified by `tsc` + the controller Playwright pass.
- **Match the handoff's exact values** — colors, sizes, radii, shadows in README §"Design tokens" are final; type them straight into `index.css`. Follow existing conventions (plain stylesheet, BEM-ish class names like `.menubar__title`).
- **No native popups** — the Open dialog is an in-app modal (its own component); diagram naming keeps using the existing `useDialogs().showPrompt`.
- **Lean first cut (scope):** IN — tabs render + click-to-switch + ×/middle-click close + `+` new + active-tab styling + right-side meta line + a filterable Open dialog that lights up File▸Open (⌘O). OUT (deferred to a later polish phase, do NOT build): drag-to-reorder, the overflow "+N more" picker chip, the Open dialog's "Recent"/"Open tabs" sub-tabs, real diagram thumbnails, and any "edited Xm ago" timestamp (the model has no timestamp field).
- **Open tabs persist across reload** via `localStorage` (new key `homelab-open-tabs`), like the existing `homelab-active-diagram` key.
- Icons stay the handoff's Unicode stand-ins (`×` close, `⌕` filter, etc.) at the given sizes — no new assets.
- Capitalize only the first letter of multi-letter acronyms. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Current-code integration points (read before starting)

- `src/model.ts`: `Diagram = { id, name, title?, type?, nodes: Node[], groups: Group[], notes: Note[], edges: Edge[], flows? }`. Meta counts = `d.nodes.length` (labelled "entities"), `d.groups.length`, `d.edges.length`. **No timestamp field exists.** `getDiagram(model, id)` returns a diagram or undefined; `model.diagrams: Diagram[]`.
- `src/App.tsx` **outer `App`** owns `const [activeId, setActiveId] = useState<string | null>(null)` (~1293), seeds it on load (~1330), persists it via `handleSetActive` / an effect and `ACTIVE_KEY = 'homelab-active-diagram'` (line 59). Passes `activeId` + `setActiveId={handleSetActive}` into `<Flow>`.
- `src/App.tsx` **inner `Flow`** returns `.shell` (flex column: `height:100vh`) → `<MenuBar …/>` (31px) → canvas wrapper (`flex:1; min-height:0`) → `<ReactFlow>`. Inside ReactFlow, a `Panel position="top-left"` (class `stack-tl`) currently renders `<DiagramBar …/>` **and** the Legend. Handlers in `Flow`: `selectDiagram(id)` (~405, flush-then-setActive), `newDiagram(name?)` (~413, creates a diagram via `M.addDiagram`, prompts name through `showPrompt`, returns/sets the new id), `renameDiagramById`, `deleteActiveDiagram` (~433, picks a neighbor `nextId` when deleting the active one), the hidden `fileRef` import `<input>` + `onImport` (Phase 1), and `onMenuItem` (~874) with the File menu model array (~838-860; the `open` item is `{ id:'open', label:'Open diagram…', shortcut:'⌘O', disabled:true }`). A `keydown` listener in `Flow` handles ⌘N / ⌘⇧E and currently ignores ⌘O.
- `src/DiagramBar.tsx`: the tiny `<select>`-only component being **replaced** by `DiagramTabs`.
- `src/Dialog.tsx`: `useDialogs()` → `{ showPrompt, showConfirm }` (used for naming/confirm). The Open dialog is a **separate** modal component, not part of this API, but should visually match `Dialog.tsx`'s modal (scrim + centered panel).

**Files this phase creates/changes:**
- Create: `src/tabsState.ts` (+ `src/tabsState.test.ts`), `src/DiagramTabs.tsx`, `src/OpenDiagramDialog.tsx`.
- Modify: `src/App.tsx` (open-tabs state + persistence + open/close/new-in-tab handlers in `App`; mount `DiagramTabs` in `Flow`'s shell; empty state; wire File▸Open + ⌘O to the dialog; enable the `open` menu item), `src/index.css` (`.tabstrip*`, `.tab*`, `.opendlg*` blocks).
- Delete: `src/DiagramBar.tsx` and its import/usage (fully replaced).

---

### Task 1: Pure open-tabs state helpers

**Files:**
- Create: `src/tabsState.ts`
- Test: `src/tabsState.test.ts`

**Interfaces (produced):**
- `sanitizeOpenTabs(openTabs: string[], diagramIds: string[], activeId: string | null): string[]` — drop ids not in `diagramIds`, dedupe preserving order, and if `activeId` is a real diagram id ensure it's present (append if missing). Returns a clean ordered list.
- `closeTab(openTabs: string[], activeId: string | null, closeId: string): { openTabs: string[]; activeId: string | null }` — remove `closeId`; if it was the active tab, choose the neighbor (the tab to its left, else the new tab now at that index, else `null` when none remain); otherwise keep `activeId`. Never returns a removed id as active.
- `addTab(openTabs: string[], id: string): string[]` — append `id` if absent (preserve order), else return unchanged.

**Why:** tab open/close/neighbor selection and load-time reconciliation are the only genuinely testable logic; keep them pure so the components/`App` stay thin.

- [ ] **Step 1: Write the failing tests** (`src/tabsState.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeOpenTabs, closeTab, addTab } from './tabsState'

describe('tabsState', () => {
  it('addTab appends when absent, no-op when present', () => {
    expect(addTab(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(addTab(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })
  it('sanitizeOpenTabs drops unknown ids, dedupes, keeps order', () => {
    expect(sanitizeOpenTabs(['a', 'x', 'b', 'a'], ['a', 'b', 'c'], 'a')).toEqual(['a', 'b'])
  })
  it('sanitizeOpenTabs ensures a real activeId is present', () => {
    expect(sanitizeOpenTabs(['a', 'b'], ['a', 'b', 'c'], 'c')).toEqual(['a', 'b', 'c'])
    expect(sanitizeOpenTabs([], ['a', 'b'], 'b')).toEqual(['b'])
    expect(sanitizeOpenTabs(['a'], ['a', 'b'], null)).toEqual(['a']) // null active: leave as-is
  })
  it('closeTab of a non-active tab keeps active', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'a')).toEqual({ openTabs: ['b', 'c'], activeId: 'b' })
  })
  it('closeTab of the active tab picks the left neighbor', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'b')).toEqual({ openTabs: ['a', 'c'], activeId: 'a' })
  })
  it('closeTab of the active first tab picks the new first', () => {
    expect(closeTab(['a', 'b', 'c'], 'a', 'a')).toEqual({ openTabs: ['b', 'c'], activeId: 'b' })
  })
  it('closeTab of the only tab yields empty + null active', () => {
    expect(closeTab(['a'], 'a', 'a')).toEqual({ openTabs: [], activeId: null })
  })
})
```

- [ ] **Step 2: Run to confirm RED** — `npx vitest run src/tabsState.test.ts` (module missing).
- [ ] **Step 3: Implement `src/tabsState.ts`** — the three pure functions per the interfaces above. `closeTab`: compute `idx = openTabs.indexOf(closeId)`; `next = openTabs.filter(id => id !== closeId)`; if `closeId !== activeId` return `{ openTabs: next, activeId }`; else new active = `next[idx - 1] ?? next[idx] ?? null` (left neighbor, else the element that shifted into `idx`, else null). `sanitizeOpenTabs`: `const known = new Set(diagramIds)`; filter to known + dedupe (track a `seen` set); if `activeId && known.has(activeId) && !result.includes(activeId)` push it.
- [ ] **Step 4: Run to confirm GREEN** — `npx vitest run src/tabsState.test.ts`.
- [ ] **Step 5: Full green + commit** — `npx vitest run && npx tsc --noEmit`; commit `feat(chrome): pure open-tabs state helpers`.

---

### Task 2: `DiagramTabs` strip component + CSS

**Files:**
- Create: `src/DiagramTabs.tsx`
- Modify: `src/index.css` (append `.tabstrip*` / `.tab*` blocks)

**Interfaces:**
- Consumes: nothing from Task 1 (pure presentational; parent passes already-computed props).
- Produces:
  `DiagramTabs({ tabs, activeId, onSelect, onClose, onNew, meta }: { tabs: { id: string; name: string }[]; activeId: string | null; onSelect: (id: string) => void; onClose: (id: string) => void; onNew: () => void; meta: { entities: number; groups: number; edges: number } | null })`
  Renders the 34px full-width strip: each tab (active vs inactive styling), a `×` close affordance per tab, a trailing `+` button, and a right-aligned meta line (`{entities} entities · {groups} groups · {edges} edges`) for the active diagram (render nothing on the right if `meta` is null). Clicking a tab body → `onSelect(id)`; clicking its `×` (stopPropagation) or **middle-click** (`onMouseDown` with `e.button === 1`, prevent default autoscroll) → `onClose(id)`; `+` → `onNew()`. `white-space: nowrap` on labels.

**Design values (read README §"Diagram tab strip — 4a"):** strip height **34px**, background `#f4f5f7`, bottom border `1px solid #dfe3ea`, horizontal padding **10px**, flex `align-items: flex-end; justify-content: space-between`, tabs sit flush on the bottom edge. Active tab: height **27px**, padding `0 9px 0 12px`, `background:#fff`, `border:1px solid #dfe3ea` with `border-bottom-color:#fff`, `border-radius:7px 7px 0 0`, font **13px/600**, close `×` in `#94a3b8`. Inactive: height **25px**, no border/bg, font **13px** `#475569`, `border-radius:7px 7px 0 0`, close `×` in `#cbd5e1`, hover `background:#eceff3`. Tab gap **3px**. `+` button: 24×25px, font 15px, `#64748b`. Right meta: **12px**, `#94a3b8`, padding-bottom 4px. (Do NOT implement overflow/drag — deferred.)

**Verification:** `tsc` + full suite green + the Task 5 Playwright pass. No DOM unit test; keep it presentational.

- [ ] **Step 1: Build `DiagramTabs.tsx`** — the strip, tabs (active/inactive), per-tab `×` (stopPropagation → `onClose`) + middle-click close, `+` button (`onNew`), right meta line. Props exactly as the interface above.
- [ ] **Step 2: Append CSS** to `src/index.css` — `.tabstrip`, `.tabstrip__tabs`, `.tab` (+`.is-active`), `.tab__close`, `.tabstrip__new`, `.tabstrip__meta`, using the exact token values above.
- [ ] **Step 3: tsc + suite green + commit** — `npx tsc --noEmit && npx vitest run`; commit `feat(chrome): DiagramTabs strip component + styles`. (Not mounted yet — Task 3 mounts it.)

---

### Task 3: Open-tabs state in `App`, mount the strip, empty state

**Files:**
- Modify: `src/App.tsx` (outer `App`: state + persistence; inner `Flow`: mount strip, layout, handlers, empty state), delete `src/DiagramBar.tsx` + its import/usage.

**Interfaces:**
- Consumes: `sanitizeOpenTabs`, `closeTab`, `addTab` (Task 1); `DiagramTabs` (Task 2); existing `selectDiagram`, `newDiagram`, `getDiagram`, `activeId`/`setActiveId`.
- Produces: `openTabs` state + `openDiagram(id)` / `closeDiagramTab(id)` / `newDiagramInTab()` handlers used by Task 4's dialog wiring.

- [ ] **Step 1: Add persisted `openTabs` state in the outer `App`.**
  Add `const [openTabs, setOpenTabs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('homelab-open-tabs') || '[]') } catch { return [] } })`. On model load (where `activeId` is seeded, ~1330) and whenever `model`/`activeId` change, reconcile: `setOpenTabs((t) => sanitizeOpenTabs(t, model.diagrams.map(d => d.id), activeId))` (guard against no-op churn: only set when the sanitized array differs by `JSON.stringify`). Persist with an effect: `useEffect(() => { localStorage.setItem('homelab-open-tabs', JSON.stringify(openTabs)) }, [openTabs])`.
- [ ] **Step 2: Thread tabs into `Flow`.** Pass `openTabs`, `setOpenTabs` (or purpose-built callbacks) into `<Flow>`. In `Flow`, derive `tabs = openTabs.map(id => ({ id, name: getDiagram(model, id)?.name ?? id })).filter(t => getDiagram(model, id))` and `meta` from the active diagram (`const d = getDiagram(model, activeId); meta = d ? { entities: d.nodes.length, groups: d.groups.length, edges: d.edges.length } : null`).
- [ ] **Step 3: Handlers in `Flow`.**
  - `openDiagram(id)`: `setOpenTabs(t => addTab(t, id)); selectDiagram(id)` (selectDiagram already flushes canvas + setActiveId).
  - `closeDiagramTab(id)`: `const r = closeTab(openTabs, activeId, id); setOpenTabs(r.openTabs); if (r.activeId !== activeId) { if (r.activeId) selectDiagram(r.activeId); else setActiveId(null) }`.
  - `newDiagramInTab()`: call the existing `newDiagram` flow; it returns/sets the new id — ensure that id is added to `openTabs` (wrap: capture the created id and `setOpenTabs(t => addTab(t, id))`). If `newDiagram` doesn't return the id, have it call `openDiagram(newId)` internally instead of `setActiveId(newId)`.
- [ ] **Step 4: Mount `DiagramTabs` in the shell; remove `DiagramBar`.** In `Flow`'s `.shell`, insert `<DiagramTabs tabs={tabs} activeId={activeId} onSelect={selectDiagram} onClose={closeDiagramTab} onNew={newDiagramInTab} meta={meta} />` as the row **between** `<MenuBar/>` and the canvas wrapper (so chrome is menu bar 31px + tab strip 34px, then canvas). Remove `<DiagramBar …/>` from the `top-left` Panel (keep the Legend in that Panel), remove the `import { DiagramBar }`, and delete `src/DiagramBar.tsx`.
- [ ] **Step 5: Empty state (no tabs open).** When `openTabs.length === 0` / `activeId == null`, render — in place of the `<ReactFlow>` canvas — a centered empty panel: a message "No diagram open" (**13px/600**, `#475569`) and below it, **12.5px** `#64748b`, "Open one from File ▸ Open diagram… or create a new diagram." with two text-buttons `Open diagram…` (calls the Task 4 dialog opener) and `New diagram` (calls `newDiagramInTab`). Keep the menu bar + (empty) tab strip visible above it. Use classes `.canvas-empty` / `.canvas-empty__title` / `.canvas-empty__body` / `.canvas-empty__actions`. (This "no tabs open" state is distinct from a fresh-but-open diagram; the handoff's fresh-diagram empty copy is not this.)
- [ ] **Step 6: tsc + suite green + smoke + commit.** `npx tsc --noEmit && npx vitest run`. Quick Playwright-MCP smoke on :5173 (if the shared browser profile is locked, note + skip; a controller pass follows in Task 5): tab strip renders below the menu bar with the active diagram as a tab; clicking another tab switches; `+` creates a diagram as a new active tab; `×` closes a tab and switches to a neighbor; closing all tabs shows the empty state; reload restores the open tabs. Commit `feat(chrome): open-tabs state + mount DiagramTabs, replace DiagramBar, empty state`.

---

### Task 4: `OpenDiagramDialog` + wire File ▸ Open / ⌘O

**Files:**
- Create: `src/OpenDiagramDialog.tsx`
- Modify: `src/App.tsx` (dialog open state in `Flow`; enable the File `open` item; handle `open` in `onMenuItem`; wire ⌘O in the keydown listener; wire the empty-state "Open diagram…" button), `src/index.css` (append `.opendlg*` block)

**Interfaces:**
- Consumes: `openDiagram(id)`, `newDiagramInTab()` (Task 3); the existing `fileRef` import trigger (Phase 1); `model.diagrams`; `openTabs` (to mark already-open rows).
- Produces:
  `OpenDiagramDialog({ diagrams, openTabIds, onOpen, onNew, onImport, onClose }: { diagrams: { id: string; name: string; entities: number }[]; openTabIds: string[]; onOpen: (id: string) => void; onNew: () => void; onImport: () => void; onClose: () => void })`
  A modal: scrim + centered **560px** panel. Title "Open diagram". A filter field (`⌕` + placeholder "Filter by name…") filtering rows by name (case-insensitive). Rows (one per diagram, filtered): a placeholder thumbnail tile (42×30, `border-radius:5px`, `#eceff3`), the name (**13.5px/650** when selected, 600 otherwise), a sub-line **11.5px** `#64748b` = `"{entities} entities"`, and an `open` chip (**11px**, `#eceff3`, `#64748b`, padding `2px 7px`, radius 5) when `openTabIds.includes(id)`. Selected row `background:#f1f2f9`. **Single-click selects; double-click** (or the primary button) opens → `onOpen(id)` + `onClose()`. Footer: left text-actions `Import JSON…` (`onImport`) and `New diagram` (`onNew`); right `Cancel` (`onClose`) + primary `Open in new tab` (disabled until a row is selected). `Esc` cancels, `⏎` opens the selected row. (Do NOT build the All/Recent/Open-tabs sub-tabs or real thumbnails — deferred.)

**Design values (read README §"Dialogs — 5c" → Open diagram + shared shell):** panel `background:#fff`, `border:1px solid #d7dce4`, `border-radius:12px`, `box-shadow:0 12px 34px rgba(15,23,42,0.14)`; scrim `rgba(15,23,42,0.28)`; title **15.5px/700** padding `15px 18px 0`; filter field margin `10px 14px 4px`, padding `7px 10px`, `border:1px solid #dfe3ea`, `border-radius:8px`, **12.5px**; rows padding `10px 11px`, `border-radius:8px`, `gap:12px`; footer padding `11px 14px`, `border-top:1px solid #eceff3`, `background:#fbfbfc`, secondary buttons `border:1px solid #dfe3ea` `border-radius:7px` **12.5px/550**, primary `background:#4f46e5` `#fff` **12.5px/600**, disabled primary `background:#c7cdfa`; footer text-actions **12.5px** `#475569`.

- [ ] **Step 1: Build `OpenDiagramDialog.tsx`** — the modal per the interface + design values above: filter state, selected-id state, row list, footer actions, `Esc`/`⏎` handling, click-outside-scrim to cancel.
- [ ] **Step 2: Append CSS** to `src/index.css` — `.opendlg__scrim`, `.opendlg`, `.opendlg__title`, `.opendlg__filter`, `.opendlg__list`, `.opendlg__row` (+`.is-selected`), `.opendlg__thumb`, `.opendlg__name`, `.opendlg__sub`, `.opendlg__open-chip`, `.opendlg__footer`, `.opendlg__textaction`, `.opendlg__btn` (+`--primary`, `:disabled`). Exact token values above.
- [ ] **Step 3: Wire it into `Flow`.** Add `const [openDialog, setOpenDialog] = useState(false)`. Render `{openDialog && <OpenDiagramDialog diagrams={model.diagrams.map(d => ({ id: d.id, name: d.name, entities: d.nodes.length }))} openTabIds={openTabs} onOpen={(id) => openDiagram(id)} onNew={() => { setOpenDialog(false); newDiagramInTab() }} onImport={() => { setOpenDialog(false); fileRef.current?.click() }} onClose={() => setOpenDialog(false)} />}` (have `onOpen` also `setOpenDialog(false)`). Enable the File `open` item (remove `disabled: true` from the `{ id:'open' … }` entry). In `onMenuItem`, add `if (itemId === 'open') { setOpenDialog(true); return }` (before/within the file branch). In `Flow`'s keydown listener, wire ⌘/Ctrl+O → `setOpenDialog(true)` (guard against text-input focus, matching the existing shortcut guards; `preventDefault`). Point the Task 3 empty-state "Open diagram…" button at `() => setOpenDialog(true)`.
- [ ] **Step 4: tsc + suite green + smoke + commit.** `npx tsc --noEmit && npx vitest run`. Playwright-MCP smoke (or note+skip if locked): `File ▸ Open diagram…` and ⌘O both open the dialog; filtering narrows the list; already-open diagrams show the `open` chip; double-click / `Open in new tab` opens the diagram into a tab and focuses it; `Import JSON…` opens the file picker; `New diagram` creates one; `Esc`/`Cancel` closes; no console errors. Commit `feat(chrome): Open diagram dialog, wire File▸Open + ⌘O`.

---

### Task 5: Browser validation (controller-run, not a subagent task)

- [ ] Dev server up; reload the app. Top chrome shows menu bar (31px) **and** the new tab strip (34px) below it; the old corner diagram `<select>` is gone; the canvas fills below both.
- [ ] Tab strip: the active diagram shows as the active tab (white, merged into canvas); other open diagrams as inactive tabs; right side shows `N entities · M groups · K edges` for the active diagram. Click an inactive tab → switches (canvas re-renders that diagram). `+` → creates a new diagram, opened as the active tab.
- [ ] Close: clicking a tab's `×` closes it and switches to a neighbor; middle-clicking a tab closes it. Closing the **last** tab shows the "No diagram open" empty state with working `Open diagram…` / `New diagram` buttons.
- [ ] Persistence: open 2–3 tabs, reload → the same tabs reopen with the last-active focused.
- [ ] Open dialog: `File ▸ Open diagram…` and ⌘O open it; filter by name works; an already-open diagram shows the `open` chip; double-click and the primary `Open in new tab` both open into a tab; footer `Import JSON…` opens the picker and `New diagram` creates one; `Esc`/`Cancel`/scrim-click close it.
- [ ] No console errors; screenshot the tab strip + the Open dialog.

---

## Self-Review

**Spec coverage (Phase-2 lean scope):** tab strip (render/active-inactive/`+`/meta) — Task 2 + mount Task 3 ✓; click-switch/close-×/middle-click — Task 2 behavior + Task 3 handlers ✓; open-tabs state + persistence + reconciliation — Task 1 (pure) + Task 3 (wire) ✓; replace `DiagramBar`/`<select>` — Task 3 ✓; empty state on last close — Task 3 ✓; Open dialog (filterable list, open chip, open-in-new-tab, footer New/Import) + File▸Open + ⌘O — Task 4 ✓; browser pass — Task 5 ✓. Deferred-and-stated (drag-reorder, overflow picker, Recent/Open-tabs sub-tabs, real thumbnails, edited-time) — Global Constraints ✓.

**Placeholder scan:** none — Task 1 carries full helper code + tests; component tasks pin props/behavior + exact README design values (same proven pattern as Phase 1); integration steps name exact handlers/state/lines.

**Type consistency:** `sanitizeOpenTabs`/`closeTab`/`addTab` signatures (Task 1) are consumed unchanged in Task 3. `DiagramTabs` props (Task 2) are supplied by `Flow` (Task 3). `OpenDiagramDialog` props (Task 4) are supplied by `Flow` (Task 4 Step 3). `openDiagram`/`closeDiagramTab`/`newDiagramInTab` are defined in Task 3 and reused in Task 4. Meta uses `d.nodes.length`/`d.groups.length`/`d.edges.length` consistently (the real model fields). `openTabs`/`activeId` are the single source of truth throughout.

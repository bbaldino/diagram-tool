# Chrome redesign — Phase 7: Flows-tab redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rough relocated flow UI in the rail's **Flows** tab with the redesigned §3a layout — a flow **list** (rows with ▶ / name / step-count / a `⋯` menu for rename/duplicate/delete + a "+ New flow" row), a **steps block** (selected-step card with element chips + "+ click canvas", other-step rows, Reorder, "+ Add step"), a pinned **footer** (`▶ Play flow` + a `⋯` menu), and the two empty states.

**Architecture:** A new `FlowsTab` component (per handoff §"Flows tab — 3a") replaces the Phase-6 `FlowsPane` (and the old `FlowPanel`) inside the rail's Flows slot. It is props-driven; `App` owns the flow model + handlers. New in `App`: a `duplicateFlow` handler, step reorder (up/down) + add/remove/caption via `onStepsChange`, `selectFlow` now enters edit mode, `▶ Play flow` enters the existing play mode (canvas light-up + arrow-key stepping — the transport bar remains a later phase), and a `chipLabel` helper to resolve element ids to display names.

**Tech Stack:** React 18 + React Flow v12, hand-written plain CSS. Vitest node env (no DOM). Verified by `tsc` + full suite + the controller Playwright pass (Task 3).

**Design source (authoritative — implementers read it):** the UPDATED `redesign-review/design_handoff_top_chrome/README.md` §"Flows tab (3a)" (list rows, steps block, footer, per-row + footer `⋯`, both empty states) and §"Right rail — 5a".

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and the full `npx vitest run` green (currently 266/266). Run from `webapp/`.
- **No `MenuBar`/`menuNav`/`Inspector`/`RightRail` changes** — `RightRail` already renders whatever node is passed as its `flows` slot.
- **Decisions (from scoping):** `▶ Play flow` = **minimal play now** — enters the existing play mode (`setFlowMode('play')`); the canvas already dims/lights per step (`flowClassOf`) and arrow keys step; Esc / the footer button toggling exits back to edit. The full **transport bar** + canvas dim/highlight polish is a later phase. **Reorder = implemented** (up/down, persisted via `onStepsChange`). **Duplicate flow = implemented** (new handler).
- **Behavior-preserving where it already works:** canvas node/edge click toggling an element into the selected step (`toggleInStep`, gated on edit mode) is unchanged; flow canvas light-up (`flowClassOf`) is unchanged; step caption editing is preserved (as the selected-step card's title field).
- Match the handoff §3a values (colors/px/weights/radii). Capitalize only the first letter of multi-letter acronyms. No native popups (rename uses the existing `showPrompt`; the `⋯` menus are in-app popovers). Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Browser smokes:** do destructive flow actions (create/duplicate/delete flow, add/remove/reorder steps) on a **throwaway diagram** (new tab), never on the real "Homelab (sample)".
- **Scope:** only the Flows tab. Do NOT build the transport bar, touch other rail tabs/menus, or restyle the Inspector.

---

## Current-code integration points (read before starting)

- `src/App.tsx` (`Flow`): flow state/handlers —
  - `flowMode` ('none'|'edit'|'play'), `currentFlowId`, `currentFlow` (memo), `selStep`, `currentStep`, `setSelStep`, `setCurrentStep`.
  - `selectFlow(id)` (~542): sets `currentFlowId`/`currentStep`/`selStep` — does NOT set mode. `createFlow` (~548): `M.addFlow` empty + `setFlowMode('edit')`. `renameFlowById(id)` (~560, showPrompt→updateFlow name). `deleteFlowById(id)` (~570, `M.removeFlow`, clears if current). `toggleInStep(elementId)` (~582): edit-mode-gated; toggles an element into `currentFlow.steps[selStep]`; wired to `onNodeClick`/`onEdgeClick` (~1384-1385). Arrow-key play stepping (~1222-1225). `currentStep` clamp effect (~1236).
  - `newId()` for ids; `active?.flows`; `M.addFlow`/`M.updateFlow`/`M.removeFlow` (model.ts ~192/198/205); `FlowStep = { id, elementIds, caption? }`, `Flow = { id, name, steps }`.
  - Node/edge display names: nodes carry `(n.data as any).label`; `edges` have `label`. (Build a `chipLabel(id)` that returns the node label, or `\`${edgeLabel} →\`` for an edge — the handoff wants node names and `label →` for edges.)
  - The rail's `flows` slot currently renders `<FlowsPane … />` (Phase 6). `FlowsPane`/`FlowPanel` are retired this phase.
- `src/FlowsPane.tsx` (Phase 6 relocation) and `src/FlowPanel.tsx` (old step editor) — both REPLACED by `FlowsTab`; delete their usages + files.

**Files this phase changes:** create `src/FlowsTab.tsx`; modify `src/App.tsx`, `src/index.css` (append `.flowstab*`); delete `src/FlowsPane.tsx` + `src/FlowPanel.tsx`.

---

### Task 1: `FlowsTab` component + CSS

**Files:** Create `src/FlowsTab.tsx`; modify `src/index.css` (append `.flowstab*`).

**Interfaces (produced):**
`FlowsTab({ flows, currentFlowId, currentFlow, mode, selStep, currentStep, onSelStep, onSelectFlow, onCreateFlow, onRenameFlow, onDuplicateFlow, onDeleteFlow, onStepsChange, newStepId, onPlay, onStop, chipLabel }: {...})` where:
- `flows: Flow[]`, `currentFlowId: string|null`, `currentFlow: Flow|null`, `mode: 'none'|'edit'|'play'`, `selStep: number`, `currentStep: number`.
- `onSelStep(i)`, `onSelectFlow(id)`, `onCreateFlow()`, `onRenameFlow(id)`, `onDuplicateFlow(id)`, `onDeleteFlow(id)`, `onStepsChange(steps: FlowStep[])`, `newStepId(): string`, `onPlay()`, `onStop()`, `chipLabel(elementId: string): string`.

Renders per handoff §3a:
- [ ] **Step 1: Build `FlowsTab.tsx`.**
  - **Flow list block:** one row per `flows` — leading `▶` (11px; active row `▶` `#4338ca`), name (**13px**, active weight 650), step count `{f.steps.length} steps` (**11.5px** `#94a3b8`), and a trailing `⋯` shown on hover that opens a small popover menu with **Rename…** → `onRenameFlow(f.id)`, **Duplicate** → `onDuplicateFlow(f.id)`, **Delete…** → `onDeleteFlow(f.id)`. Active row (`f.id === currentFlowId`) `background:#f1f2f9`; hover `#f6f7f9`; clicking a row → `onSelectFlow(f.id)`. Last row: **+ New flow** (**12.5px/600** `#4f46e5`) → `onCreateFlow()`.
  - **Steps block** (rendered when `currentFlow` is non-null): header `Steps · {currentFlow.name}` (mono **10px** uppercase `#64748b`) with a right-aligned **Reorder** link (**11.5px/600** `#4f46e5`) that toggles an internal `reorderMode`. Step list:
    - The **selected step** (`selStep`): a card (`border:1px solid #c7cdfa`, radius 8) — header strip (`background:#f1f2f9`, padding `8px 9px`): index (mono **11px/700** `#4338ca`), an editable **title** = the step's caption (a text input; on change → `onStepsChange` with that step's `caption` updated; placeholder "caption…"), trailing `⋮`. Body (padding 9): wrapping **element chips** — **11px**, `background:#eef0fb`, `#4338ca`, padding `3px 7px`, radius 5, text = `chipLabel(id)`; each chip has a small `×` to remove it (→ `onStepsChange` removing that id from the step). Plus a dashed **+ click canvas** affordance (`border:1px dashed #cbd5e1`, `#64748b`) — informational (the actual toggling happens by clicking the canvas; App wires that).
    - **Other steps:** compact rows (padding `8px 9px`, `border:1px solid #eceff3`, radius 8) — index (**11px/700** `#94a3b8`) + title (**12.5px** `#475569`, the caption or "(no caption)"). Click → `onSelStep(i)`.
    - When `reorderMode` is on, each step row shows small **↑ / ↓** buttons that move that step within the array (→ `onStepsChange(movedSteps)`); disable ↑ on the first, ↓ on the last.
    - **+ Add step** footer (full width, dashed, **12.5px** `#64748b`) → `onStepsChange([...steps, { id: newStepId(), elementIds: [], caption: '' }])` and select the new step (`onSelStep(steps.length)`).
  - **Footer** (pinned to the bottom, `border-top:1px solid #eceff3`, `background:#fbfbfc`, padding `11px 12px`, flex `gap:7px`): a primary button — `▶ Play flow` when `mode !== 'play'` (→ `onPlay()`), or **Stop** when `mode === 'play'` (→ `onStop()`) — (`flex:1`, `background:#4f46e5`, `#fff`, **12.5px/600**); and a secondary `⋯` (34px, `border:1px solid #dfe3ea`, radius 7) opening the same Rename/Duplicate/Delete menu, targeting `currentFlowId`.
  - **Empty states:** when `currentFlow` is null but `flows.length > 0` → render the list block, and in place of the steps block + footer a centered empty state (padding `26px 18px`, gap 12): a 34×34 `#f1f2f4` r9 tile with `▶` (13px `#94a3b8`), title **13px/600** "No flow selected", body **12px/1.55** `#64748b` "Pick a flow above to see and edit its steps, or create one to walk through a path in this diagram." When `flows.length === 0` → the list collapses to just the **+ New flow** row and the body copy reads "No flows yet."
  - The `⋯` popover: a small in-app menu (reuse `.menu`/`.menu__item` classes from the menu bar, or a minimal `.flowstab__menu`); close on outside-click (capture-phase, mirroring existing dismissers) / Esc / choose.
- [ ] **Step 2: Append CSS** to `src/index.css` — `.flowstab` + subclasses (`__list`, `__row` (+`.is-active`), `__row-name`, `__row-count`, `__row-more`, `__new`, `__steps`, `__steps-head`, `__reorder`, `__step` (+`.is-sel`), `__step-head`, `__step-idx`, `__step-title`, `__chip` (+`__chip-x`), `__addchip`, `__addstep`, `__footer`, `__play`, `__more`, `__empty*`) using the §3a values. Reuse `.menu*` for the `⋯` popover if practical.
- [ ] **Step 3: tsc + suite green + commit** — `npx tsc --noEmit && npx vitest run`; commit `feat(chrome): FlowsTab redesign component + styles`. (Not mounted yet — Task 2.)

---

### Task 2: New handlers; mount `FlowsTab`; retire `FlowsPane`/`FlowPanel`

**Files:** Modify `src/App.tsx`; delete `src/FlowsPane.tsx`, `src/FlowPanel.tsx`.

- [ ] **Step 1: `selectFlow` enters edit mode.** Change `selectFlow(id)` so a non-null id also `setFlowMode('edit')` (and a null id → `setFlowMode('none')`), keeping the `currentStep`/`selStep` resets. (Selecting a flow in the new list shows + edits its steps directly.)
- [ ] **Step 2: Add `duplicateFlow(id)`.**
  ```tsx
  const duplicateFlow = useCallback((id: string) => {
    if (!activeId) return
    const f = active?.flows?.find((x) => x.id === id)
    if (!f) return
    const copyId = newId()
    const steps = f.steps.map((s) => ({ ...s, id: newId() }))
    setModel((m) => M.addFlow(m, activeId, { id: copyId, name: `${f.name} copy`, steps }))
    selectFlow(copyId)
  }, [activeId, active, setModel, selectFlow])
  ```
- [ ] **Step 3: Play/Stop + chipLabel + newStepId helpers.** `onPlay = () => setFlowMode('play')`; `onStop = () => setFlowMode('edit')`. Ensure Esc during play exits to edit — add ⎋ handling to the existing play keydown effect (or a small effect): when `flowMode === 'play'` and Escape → `setFlowMode('edit')`. `chipLabel(id)`: look the id up among the diagram's nodes (`(n.data as any).label`) → the node label; else among `edges` → `\`${edge.label ?? 'edge'} →\``; fallback the raw id. `newStepId = () => newId()` (pass the function).
- [ ] **Step 4: Swap the rail's `flows` slot to `FlowsTab`.** Replace the `<FlowsPane …/>` passed as `flows={…}` with:
  ```tsx
  <FlowsTab
    flows={active?.flows ?? []} currentFlowId={currentFlowId} currentFlow={currentFlow}
    mode={flowMode} selStep={selStep} currentStep={currentStep}
    onSelStep={(i) => (flowMode === 'play' ? setCurrentStep(i) : setSelStep(i))}
    onSelectFlow={selectFlow} onCreateFlow={createFlow}
    onRenameFlow={renameFlowById} onDuplicateFlow={duplicateFlow} onDeleteFlow={deleteFlowById}
    onStepsChange={(steps) => activeId && currentFlow && setModel((m) => M.updateFlow(m, activeId, currentFlow.id, { steps }))}
    newStepId={newId} onPlay={() => setFlowMode('play')} onStop={() => setFlowMode('edit')}
    chipLabel={chipLabel}
  />
  ```
  Remove the `import { FlowsPane }` and (if present) any remaining `FlowPanel` import from `App.tsx`.
- [ ] **Step 5: Delete `src/FlowsPane.tsx` and `src/FlowPanel.tsx`** (now unused). Resolve any resulting unused-symbol fallout in `App.tsx` by deletion (but KEEP `toggleInStep`, `selectFlow`, `createFlow`, `renameFlowById`, `deleteFlowById`, `setFlowMode`, `setSelStep`, `setCurrentStep`, `currentStep`, `flowMode`, `currentFlow` — all still used).
- [ ] **Step 6: tsc + suite green + smoke + commit.** `npx tsc --noEmit && npx vitest run` (stay 266/266). Playwright-MCP smoke on a **throwaway diagram** (create a new diagram tab; do NOT touch the real "Homelab (sample)"; note+skip/headless-fallback if the profile is locked): in the Flows tab — "No flows yet" empty state initially; **+ New flow** creates a flow and shows the steps block; **+ Add step** adds a step (selected as a card); clicking a canvas node/edge toggles it as a chip in the selected step; the chip `×` removes it; selecting another step switches the card; **Reorder** shows ↑/↓ and moving reorders; the row `⋯` and footer `⋯` both offer Rename/Duplicate/Delete (test **Duplicate** → a "… copy" flow appears and is selected); **▶ Play flow** enters play (canvas lights up, arrow keys step), the button becomes **Stop**, Esc/Stop returns to edit; "No flow selected" empty state when no flow is current. Delete the throwaway diagram afterward. No console errors. Commit `feat(chrome): redesigned Flows tab (list/steps/footer/empty states), retire FlowsPane+FlowPanel`.

---

### Task 3: Browser validation (controller-run, not a subagent task)

- [ ] Dev server up; reload; open the rail's **Flows** tab. On a **throwaway diagram**, verify: empty states ("No flows yet" → "No flow selected" after creating then… ), flow list rows (▶/name/count, active highlight), + New flow, per-row `⋯` (Rename/Duplicate/Delete), the steps block (selected-step card with editable caption + element chips + `×` + "+ click canvas", other-step rows, Reorder ↑/↓, + Add step), the footer (▶ Play flow / Stop + `⋯`), Duplicate producing a "… copy", and click-canvas-to-toggle a chip.
- [ ] Play flow lights up the canvas + arrow-key steps; Stop/Esc returns to edit.
- [ ] Confirm the real "Homelab (sample)" is untouched (its existing flows still intact); delete any throwaway diagram created. No console errors; screenshot the Flows tab (a flow selected with steps + one empty state).

---

## Self-Review

**Spec coverage (Flows-tab §3a):** flow list rows + active + step counts + per-row `⋯` + New flow (Task 1) ✓; steps block (selected-step card, chips + `×` + "+ click canvas", other-step rows, Reorder ↑/↓, + Add step) (Task 1) ✓; footer (Play flow/Stop + `⋯`) (Task 1) ✓; both empty states (Task 1) ✓; Duplicate handler (Task 2 Step 2) ✓; selectFlow→edit, Play/Stop + Esc, chipLabel (Task 2 Steps 1,3) ✓; swap in + retire FlowsPane/FlowPanel (Task 2 Steps 4-5) ✓; browser pass (Task 3) ✓. Deferred-and-stated: transport bar + canvas dim/highlight polish (next phase); drag-reorder (implemented as up/down instead).

**Placeholder scan:** none — component behavior + the App handlers/swap are concrete; `duplicateFlow` carries full code.

**Type consistency:** `FlowsTab` props (Task 1) are supplied verbatim in Task 2 Step 4. `Flow`/`FlowStep` from `./model`. `onStepsChange`/`newStepId`/`chipLabel`/`onSelStep` signatures match between the component and the App wiring. `duplicateFlow` uses `M.addFlow` (existing) + `newId` + `selectFlow`. Play/Stop map to `setFlowMode('play'|'edit')`; `toggleInStep` (unchanged) still targets `selStep` in edit mode.

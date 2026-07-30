# Chrome redesign — Phase 6: Right rail (Inspector + Flows tabs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating top-right Inspector/FlowPanel overlay with a real **292px right rail** docked beside the canvas, holding two tabs — **Inspector** (the existing inspector) and **Flows** (the existing flow list/steps/controls, relocated) — and retire the old toolbar's flow controls (Flow: select, +Flow, Edit, Play, Rename, Delete).

**Architecture:** A new presentational `RightRail` shell (292px, `border-left`, full height, tab header with a Flows count badge) renders the active tab's content. A new `FlowsPane` gathers the currently-scattered flow UI (the toolbar's flow `<select>`/+Flow/Edit/Play/Rename/Delete + the existing `<FlowPanel>`) into one component for the Flows tab. `Flow`'s canvas area becomes a flex **row** — `<ReactFlow>` (flex:1) beside the rail — and rail state (`railVisible` + `railTab`) replaces Phase 5's `showInspector`. View ▸ Inspector (⌘I) and View ▸ Flows panel (⌘⇧F) drive the rail; entering a flow Edit/Play mode switches to the Flows tab.

**Tech Stack:** React 18 + React Flow v12, hand-written plain CSS. Vitest node env (no DOM). Verified by `tsc` + full suite + the controller Playwright pass (Task 3).

**Design source (authoritative — implementers read it):** `redesign-review/design_handoff_top_chrome/README.md` §"Right rail — 4a, 3a, 5a" (rail width/border/tab-header/badge; field styling is reference — see scope note) and §"Interactions → Rail" (tab switch is instant; call `fitView` after the width change). §"State management" lists `railTab`/`railVisible`.

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and the full `npx vitest run` green (currently 266/266). Run from `webapp/`.
- **No `MenuBar`/`menuNav` changes.**
- **SCOPE — relocate, don't rebuild.** IN: the rail shell + tabs; move the existing `<Inspector>` into the Inspector tab and the existing flow controls + `<FlowPanel>` into the Flows tab (a `FlowsPane` wrapper); retire the toolbar's flow controls; wire ⌘I/⌘⇧F + rail toggle; flex-row layout + `fitView` on rail show/hide.
  OUT (deferred — do NOT build): the flow **playback transport bar** + canvas dim/highlight (a later phase); the handoff's from-scratch **Flows-tab redesign** (flow-list-then-steps rows, ⋯ menus) — keep the existing flow UI as-is inside the tab; **pixel-perfect Inspector field restyle** to the §5a field specs — keep the Inspector's current internal markup, just host it in the rail. (These are tracked fast-follows.)
- **Rail dimensions:** width **292px**, `border-left: 1px solid #dfe3ea`, `background: #fff`, full height of the canvas area, flex column. Tab header per §"Right rail": padding `7px 8px 0`, bottom border `1px #eceff3`; tab font **12.5px**, active weight **650** + `border-bottom: 2px solid #4f46e5` + `margin-bottom: -1px`, inactive weight 550 `#64748b`; the Flows tab carries a count badge (**10.5px**, `background:#eceff3`, padding `1px 5px`, `border-radius:4px`).
- **Behavior-preserving:** the Inspector/Flows content and every flow handler keep their exact current behavior; only their *location* + the show/hide mechanism change. Flow canvas light-up (`flowClassOf`) is unchanged.
- Capitalize only the first letter of multi-letter acronyms. No native popups. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Browser smokes:** use a throwaway diagram for any destructive action (delete flow, etc.) — never mutate the real "Homelab (sample)".

---

## Current-code integration points (read before starting)

- `src/App.tsx` (`Flow`):
  - Layout: `.shell` column → `<MenuBar/>` → `<DiagramTabs/>` → the canvas wrapper (`flex:1; min-height:0`) containing `<ReactFlow>`. `<ReactFlow>` has the `snapToGrid`/`snapGrid` props (Phase 5).
  - The top-right `<Panel position="top-right" className="stack-tr">` (~1393-1460) contains: `.panel.toolbar` with `+ Group`, `+ Note`, and the FLOW controls — `Flow:` `<select>` (value `currentFlowId`, `onChange`→`selectFlow`), `+ Flow` (`createFlow`), `Edit` (toggles `flowMode` edit; `disabled={!currentFlow}`), `Play` (toggles `flowMode` play), `Rename` (`renameFlowById(currentFlowId)`), `Delete` (`deleteFlowById(currentFlowId)`) — then a ternary: `flowMode !== 'none' && currentFlow ? <FlowPanel …/> : (showInspector && <Inspector …/>)`.
  - Flow state/handlers: `flowMode` ('none'|'edit'|'play', ~241), `currentFlowId` (~242), `currentFlow` (~299), `selectFlow` (~521), `createFlow` (~527), `renameFlowById`/`deleteFlowById`, `selStep`/`currentStep`/`setSelStep`/`setCurrentStep`, `active?.flows`. Inspector props: `node`/`edge`/`groups`/`onNodeData`/`onNodeParent`/`onEdge`/`onShrink`/`onGroupSize`/`onDelete`/`fields`/`onFieldShow`/`diagramColors` (~1444-1456).
  - Phase-5 state to REPLACE: `showInspector` (default true) + its View-menu wiring (`inspector` item `checked: showInspector`; `flows-panel` item `disabled: true`) + the ⌘I handler (`setShowInspector`), all become rail state (below).
  - `rf = useReactFlow()` (has `fitView`).
- `src/FlowPanel.tsx` — the flow step editor/player; props `{ flow, mode:'edit'|'play', selStep, onSelStep, onChange, onExit }`. Reuse as-is inside `FlowsPane`.
- `src/Inspector.tsx` — the inspector; reuse as-is inside the rail's Inspector tab.

**Files this phase changes:** create `src/RightRail.tsx`, `src/FlowsPane.tsx`; modify `src/App.tsx`, `src/index.css` (append `.rightrail*` + reuse existing `.insp*`/`.flow*` styles). Leave `FlowPanel.tsx`/`Inspector.tsx` unchanged.

---

### Task 1: `RightRail` + `FlowsPane` components + CSS

**Files:** Create `src/RightRail.tsx`, `src/FlowsPane.tsx`; modify `src/index.css` (append `.rightrail*`).

**Interfaces (produced):**
- `RightRail({ tab, onTab, flowCount, inspector, flows }: { tab: 'inspector'|'flows'; onTab: (t: 'inspector'|'flows') => void; flowCount: number; inspector: React.ReactNode; flows: React.ReactNode })` — renders the 292px column: a tab header with **Inspector** and **Flows** tabs (Flows shows a count badge = `flowCount`), then a scrollable body containing `tab === 'inspector' ? inspector : flows`. Clicking a tab calls `onTab`. (Visibility is the parent's job — the parent renders `{railVisible && <RightRail …/>}`.)
- `FlowsPane({ flows, currentFlowId, onSelectFlow, onCreateFlow, flowMode, onSetMode, currentFlow, selStep, currentStep, onSelStep, onStepsChange, onExit, onRenameFlow, onDeleteFlow }: {...})` — the flow controls (a flow `<select>`/list, `+ Flow`, `Edit`/`Play` toggles disabled when no `currentFlow`, `Rename`, `Delete`) followed by `{currentFlow && flowMode !== 'none' && <FlowPanel flow={currentFlow} mode={flowMode==='edit'?'edit':'play'} selStep={flowMode==='edit'?selStep:currentStep} onSelStep={onSelStep} onChange={onStepsChange} onExit={onExit} />}`. This is a straight relocation of the existing toolbar flow controls + FlowPanel — keep behavior identical.

- [ ] **Step 1: Build `RightRail.tsx`** — the shell + tab header (Inspector / Flows·badge) + body slot per the interface. Presentational; no data/state beyond nothing (parent owns `tab`).
- [ ] **Step 2: Build `FlowsPane.tsx`** — relocate the flow `<select>`/+Flow/Edit/Play/Rename/Delete controls + the `<FlowPanel>` (import `FlowPanel` from `./FlowPanel`). Props exactly as above; behavior identical to today's toolbar+ternary.
- [ ] **Step 3: Append CSS** to `src/index.css` — `.rightrail` (292px, `border-left:1px solid #dfe3ea`, `background:#fff`, full height, flex column), `.rightrail__tabs` (padding `7px 8px 0`, bottom border `1px #eceff3`, flex gap 2px), `.rightrail__tab` (+`.is-active` → weight 650 + `border-bottom:2px solid #4f46e5` + `margin-bottom:-1px`; inactive weight 550 `#64748b`), `.rightrail__badge` (10.5px, `#eceff3`, padding `1px 5px`, radius 4), `.rightrail__body` (`flex:1; overflow:auto`). Reuse existing `.insp*`/`.flowpanel`/`.flowstep*` styles for the tab contents (do not duplicate).
- [ ] **Step 4: tsc + suite green + commit** — `npx tsc --noEmit && npx vitest run`; commit `feat(chrome): RightRail + FlowsPane components + styles`. (Not mounted yet — Task 2 mounts them.)

---

### Task 2: Mount the rail; move Inspector + Flows in; retire toolbar flow controls

**Files:** Modify `src/App.tsx` (`Flow`).

**Interfaces:** Consumes `RightRail`/`FlowsPane` (Task 1); the existing Inspector props, flow state + handlers, `rf`.

- [ ] **Step 1: Rail state** — in `Flow`, replace `const [showInspector, setShowInspector] = useState(true)` with `const [railVisible, setRailVisible] = useState(true)` and `const [railTab, setRailTab] = useState<'inspector' | 'flows'>('inspector')`. Add two `useCallback` helpers:
  ```tsx
  const showRailTab = useCallback((t: 'inspector' | 'flows') => {
    setRailTab(t); setRailVisible(true)
  }, [])
  const toggleRailTab = useCallback((t: 'inspector' | 'flows') => {
    setRailVisible((v) => !(v && railTab === t))   // collapse only when already showing this tab
    setRailTab(t)
  }, [railTab])
  ```
  (`toggleRailTab` re-shows the rail on the requested tab, or collapses it if that tab is already the visible one. `railTab` is in its deps so the collapse test reads the current tab.)
- [ ] **Step 2: Layout row** — wrap the canvas wrapper + rail in a flex row so the rail docks beside the canvas. The canvas wrapper (currently `flex:1; min-height:0`, holding `<ReactFlow>`) becomes the first child of a `<div style={{ display:'flex', flex:1, minHeight:0 }}>`; the `<ReactFlow>` wrapper gets `flex:1; minWidth:0`; the second child is `{railVisible && <RightRail …/>}`. React Flow measures its container, so keep the ReactFlow wrapper a real sized box. After `railVisible` changes, call `rf.fitView({ padding: 0.2 })` (a `useEffect` on `[railVisible]`, or in the toggle handlers) so the diagram re-centers.
- [ ] **Step 3: Render `RightRail`** with the two tab contents:
  ```tsx
  {railVisible && (
    <RightRail
      tab={railTab}
      onTab={setRailTab}
      flowCount={active?.flows?.length ?? 0}
      inspector={
        <Inspector node={selectedNode} edge={selectedEdge} groups={groupParentOptions}
          onNodeData={updateNodeData} onNodeParent={reparent} onEdge={updateEdge}
          onShrink={shrinkGroup} onGroupSize={setGroupSize} onDelete={deleteSelected}
          fields={inspectorFields} onFieldShow={onFieldShow} diagramColors={diagramColors} />
      }
      flows={
        <FlowsPane flows={active?.flows ?? []} currentFlowId={currentFlowId}
          onSelectFlow={selectFlow} onCreateFlow={createFlow} flowMode={flowMode}
          onSetMode={setFlowMode} currentFlow={currentFlow} selStep={selStep}
          currentStep={currentStep}
          onSelStep={(i) => (flowMode === 'edit' ? setSelStep(i) : setCurrentStep(i))}
          onStepsChange={(steps) => activeId && setModel((m) => M.updateFlow(m, activeId, currentFlow!.id, { steps }))}
          onExit={() => setFlowMode('none')}
          onRenameFlow={renameFlowById} onDeleteFlow={deleteFlowById} />
      }
    />
  )}
  ```
- [ ] **Step 4: Remove the old top-right Inspector/FlowPanel + flow controls.** Delete the `flowMode !== 'none' … ? <FlowPanel/> : (showInspector && <Inspector/>)` ternary (~1433-1459) from the `stack-tr` Panel. In that Panel's `.panel.toolbar`, delete the flow controls — the `Flow:` `<label>`/`<select>`, `+ Flow`, `Edit`, `Play`, `Rename`, `Delete` buttons — leaving `+ Group` and `+ Note`. (The rail now renders the Inspector + FlowsPane; the toolbar keeps only +Group/+Note for now.)
- [ ] **Step 5: Auto-switch to Flows on flow-edit/play.** When `setFlowMode` is invoked to enter `'edit'` or `'play'` (the Edit/Play buttons now live in `FlowsPane`), also `showRailTab('flows')`. Simplest: wrap the FlowsPane `onSetMode` so entering a non-'none' mode calls `showRailTab('flows')` (e.g. `onSetMode={(m) => { setFlowMode(m); if (m !== 'none') showRailTab('flows') }}`).
- [ ] **Step 6: Wire the View menu + shortcuts.** In `viewMenuItems`: `inspector` item `checked: railVisible && railTab === 'inspector'`; `flows-panel` item — remove `disabled: true`, set `checked: railVisible && railTab === 'flows'`. In `onMenuItem`'s `'view'` branch: `inspector` → `toggleRailTab('inspector')`; `flows-panel` → `toggleRailTab('flows')`. Update the `viewMenuItems` useMemo deps to `[railVisible, railTab, showLegend, showMinimap, snapToGrid]`. In the keydown effect, change ⌘I from `setShowInspector(...)` to `toggleRailTab('inspector')`, and add ⌘/Ctrl+⇧+F → `toggleRailTab('flows')` (input-focus guarded, `preventDefault`; keep the ⌘I `!e.shiftKey && !e.altKey` guard from the Phase-5 fix). Ensure `railVisible`/`railTab` are read via current state (deps or functional updates) so the handlers aren't stale.
- [ ] **Step 7: tsc + suite green + smoke + commit.** `npx tsc --noEmit && npx vitest run` (stay 266/266). Playwright-MCP smoke on :5173 (throwaway diagram for destructive bits; note+skip/headless-fallback if locked): the 292px rail docks on the right with Inspector | Flows·N tabs; selecting a node shows its editor in the Inspector tab; the Flows tab has the flow select/+Flow/Edit/Play/Rename/Delete + steps; entering Edit switches to the Flows tab; ⌘I / View▸Inspector and ⌘⇧F / View▸Flows-panel switch/toggle the rail (checkmarks track); toggling the rail off re-centers the canvas (fitView) with the rail gone; the old toolbar no longer has the flow controls (only +Group/+Note); canvas + rail both size correctly; no console errors. Commit `feat(chrome): dock right rail (Inspector + Flows tabs), retire toolbar flow controls`.

---

### Task 3: Browser validation (controller-run, not a subagent task)

- [ ] Dev server up; reload. A **292px rail** is docked on the right (border-left), with **Inspector | Flows·N** tabs; the canvas fills the remaining width; the old floating top-right Inspector/FlowPanel overlay is gone.
- [ ] Inspector tab: selecting a node/group/edge shows its editor (same fields as before); nothing-selected shows the empty hint.
- [ ] Flows tab: the flow selector, +Flow, Edit/Play (disabled with no flow), Rename, Delete are present; selecting a flow + Edit shows the step editor and **auto-switches to the Flows tab**; Play works; canvas light-up still works during play.
- [ ] View ▸ Inspector (⌘I) and View ▸ Flows panel (⌘⇧F) switch/toggle the rail; their `✓` reflects the visible tab; toggling the rail closed re-centers the canvas (fitView) and reopening restores it.
- [ ] Old top-right toolbar has only +Group/+Note (no Flow:/+Flow/Edit/Play/Rename/Delete).
- [ ] Do destructive checks (delete a flow) on a throwaway diagram; restore. No console errors; screenshot the rail (Inspector tab + Flows tab).

---

## Self-Review

**Spec coverage (rail structure scope):** 292px rail shell + Inspector/Flows tabs + count badge (Task 1) ✓; Inspector moved into the Inspector tab (Task 2 Step 3) ✓; flow controls + FlowPanel relocated into the Flows tab via `FlowsPane` (Task 1-2) ✓; toolbar flow controls retired (Task 2 Step 4) ✓; flex-row layout + fitView on toggle (Step 2) ✓; ⌘I/⌘⇧F + View items wired, `showInspector`→rail state (Steps 1,6) ✓; auto-switch to Flows on Edit/Play (Step 5) ✓; browser pass (Task 3) ✓. Deferred-and-stated: transport bar, Flows-tab redesign, Inspector field restyle.

**Placeholder scan:** none — component interfaces + the exact App wiring/removals are concrete. `FlowsPane` and the rail render block carry full prop lists mapped to existing handlers.

**Type consistency:** `RightRail`/`FlowsPane` prop shapes (Task 1) are supplied verbatim in Task 2 Step 3. `railTab: 'inspector'|'flows'` and `railVisible: boolean` replace `showInspector` everywhere it was read (View item `checked`, the render gate, ⌘I). `flowMode`/`currentFlow`/`selStep`/`currentStep` and every flow handler (`selectFlow`/`createFlow`/`renameFlowById`/`deleteFlowById`/`setFlowMode`/`M.updateFlow`) keep their existing signatures — `FlowsPane` just forwards them. `flowCount = active?.flows?.length ?? 0`.

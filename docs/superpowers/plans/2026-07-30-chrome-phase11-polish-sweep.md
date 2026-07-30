# Merge-Readiness Polish Sweep (Chrome Phase 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the accumulated chrome-redesign fast-follows that should land before merging to `main`: dead-code removal, consistency/correctness fixes, the Group/Ungroup keyboard shortcuts (+ honest shortcut hints), an accessibility pass, and menu/popover/playback polish. (The Inspector §5a restyle is a separate follow-on phase.)

**Architecture:** Small, surgical edits across existing files, grouped by concern so each task is an independently reviewable unit. No new modules except where a task needs a tiny helper.

**Tech Stack:** Vite + React 18 + TypeScript, React Flow v12, plain CSS, Vitest (node env).

## Global Constraints

- Never use `window.alert` / `prompt` / `confirm` — in-app UI only. [[no-native-popups]]
- Never commit `webapp/model.json` or `webapp/history.json`.
- Capitalize only the first letter of multi-letter acronyms.
- App is served over plain-HTTP LAN — no secure-context-only APIs.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Behavior-preserving unless a task explicitly changes behavior. Keep the full Vitest suite green (currently 280).

---

## File Structure

- **Modify** `webapp/src/index.css` — remove dead CSS; add menu transition; scrubber hit-area.
- **Modify** `webapp/src/graph.ts` — remove dead `buildSeed` (keep `GROUPS`).
- **Modify** `webapp/src/DiagramTabs.tsx` — meta pluralization; tab-strip a11y.
- **Modify** `webapp/src/App.tsx` — ⌘O guard; engine-id guard; fitView rAF; Group/Ungroup shortcuts + mutual exclusion; drop zoom hints.
- **Modify** `webapp/src/DialogShell.tsx` — initial focus + focus trap.
- **Modify** `webapp/src/MenuBar.tsx` — `role="menu"`/`role="menuitem"`.
- **Modify** `webapp/src/FlowsTab.tsx` — gate step editing to edit mode; footer `⋯` edge-flip.

---

### Task 1: Dead-code / CSS cleanup

**Files:** `webapp/src/index.css`, `webapp/src/graph.ts`

**Interfaces:** none (pure removal; behavior-preserving).

Confirmed dead (from exploration): the old `.dialog*` block, the `.dialog` token in the shared `user-select` selector, the `.menu__submenu-parent{position:relative}` rule, and `graph.ts` `buildSeed` (0 callers). NOT dead (do NOT remove): `.pill__text:disabled` (now exercised by the Tidy button's `canTidy` disable), and `graph.ts` `GROUPS` (still feeds `GROUP_COLOR`/`PARENT_OF`).

- [ ] **Step 1: Remove the dead `.dialog*` CSS block** — delete the `.dialog__overlay` … `.dialog__btn--danger` block (index.css ~262-291). Verify by grep that no `.tsx` emits `.dialog`/`.dialog__*` classes (only `role="dialog"` attributes should remain).

- [ ] **Step 2: Drop `.dialog` from the shared selector** — change `.panel, .palette, .addmenu, .colorpick, .dialog {` (index.css:119) to `.panel, .palette, .addmenu, .colorpick {`.

- [ ] **Step 3: Remove the dead `.menu__submenu-parent{position:relative}` rule** — grep `menu__submenu-parent` in `.tsx`; if unused, delete the rule.

- [ ] **Step 4: Remove `buildSeed` from `graph.ts`** — delete the `buildSeed` function (graph.ts ~509). Keep `GROUPS`. If `buildSeed` was the only user of any local helper, leave those helpers if still exported/used; only remove what becomes truly unreferenced. Confirm with grep that `buildSeed` has no remaining references anywhere in `webapp/src`.

- [ ] **Step 5: Verify + commit**

```bash
cd webapp && npx tsc --noEmit && npx vitest run   # expect 280 passed
git add webapp/src/index.css webapp/src/graph.ts
git commit -m "chore(redesign): remove dead dialog CSS + buildSeed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Consistency + hardening fixes

**Files:** `webapp/src/DiagramTabs.tsx`, `webapp/src/App.tsx`

**Interfaces:** none new; small behavior fixes.

- [ ] **Step 1: Meta pluralization.** In `DiagramTabs.tsx` (~line 52) the meta renders `{meta.entities} entities · {meta.groups} groups · {meta.edges} edges`. Replace with a pluralizing render, e.g. a local helper:

```tsx
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + (one.endsWith('y') ? '' : 's')}`
// entities is irregular: "1 entity" / "2 entities"
const entities = `${meta.entities} ${meta.entities === 1 ? 'entity' : 'entities'}`
// …render: `${entities} · ${plural(meta.groups, 'group')} · ${plural(meta.edges, 'edge')}`
```

Render "1 entity · 1 group · 1 edge" vs "2 entities · 3 groups · 9 edges".

- [ ] **Step 2: ⌘O shift guard.** In App.tsx's shortcut effect (~line 1190) the `else if (key === 'o')` branch opens the Open dialog without the `!e.shiftKey` guard the other shortcuts use. Change to `else if (key === 'o' && !e.shiftKey)` so ⌘⇧O no longer opens it. (Match the `preventDefault` pattern of the neighboring branches.)

- [ ] **Step 3: Engine-id runtime guard.** In App.tsx (~line 1496) `onChooseEngine={(id) => chooseEngine(id as 'elk' | 'graphviz')}` — replace the unchecked cast with a guard:

```tsx
onChooseEngine={(id) => { if (id === 'elk' || id === 'graphviz') chooseEngine(id) }}
```

- [ ] **Step 4: `.rightrail` flex-shrink.** In `index.css`, add `flex-shrink: 0;` to the `.rightrail` rule so the 292px rail can't shrink below its basis.

- [ ] **Step 5: fitView rAF.** In App.tsx, the `useEffect` that calls `rf.fitView(...)` on rail visibility change — wrap the call in `requestAnimationFrame(() => rf.fitView({ padding: 0.2 }))` so it runs after React Flow's ResizeObserver settles. (Locate by the `railVisible`/rail-toggle effect; if it uses a `setTimeout`, replace with rAF.)

- [ ] **Step 6: Group/Ungroup mutual exclusion.** In App.tsx make `canGroup` and `canUngroup` mutually exclusive: `canGroup` should additionally require that no group is in the selection, and `canUngroup` should require the group is the ONLY selected node. Concretely:

```ts
const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes])
const canGroup = groupableIds.length >= 2 && !selectedNodes.some((n) => n.type === 'group')
const canUngroup = selectedNodes.length === 1 && selectedTopGroup != null
```

(Keep `groupableIds`/`selectedTopGroup` as-is; just tighten the two booleans. Adjust the memo deps accordingly.)

- [ ] **Step 7: Verify + commit**

```bash
cd webapp && npx tsc --noEmit && npx vitest run
git add webapp/src/DiagramTabs.tsx webapp/src/App.tsx webapp/src/index.css
git commit -m "fix(redesign): meta pluralization, ⌘O guard, engine guard, rail shrink, fitView rAF, group/ungroup exclusivity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Group/Ungroup keyboard shortcuts + honest zoom hints

**Files:** `webapp/src/App.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Wire ⌘G / ⇧⌘G.** In the App shortcut effect that already handles ⌘Z/⌘⇧Z/⌘⇧L/⌘⇧T/⌘I (~lines 1253-1260, gated on `metaKey||ctrlKey`), add before its close:

```ts
      else if (key === 'g' && !e.shiftKey) { e.preventDefault(); if (canGroup) groupSelection() }
      else if (key === 'g' && e.shiftKey) { e.preventDefault(); if (canUngroup) ungroupSelection() }
```

Ensure this effect is inert while a text input/textarea/contentEditable is focused (add the same guard the play-mode effect uses if this effect lacks it: `const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return`). Add `canGroup, groupSelection, canUngroup, ungroupSelection` to the effect's dependency array.

- [ ] **Step 2: Drop the unwired zoom hints.** In App.tsx the View menu items (~lines 1046-1049) advertise `shortcut: '⌘+'`/`'⌘−'`/`'⇧1'`/`'⌘0'` that are not bound. Remove the `shortcut` field from all four zoom items (`zoom-in`, `zoom-out`, `zoom-fit`, `zoom-actual`) so the menu no longer advertises keys that don't work. (Menu-click still zooms via the existing dispatch.)

- [ ] **Step 3: Verify + commit**

```bash
cd webapp && npx tsc --noEmit && npx vitest run
git add webapp/src/App.tsx
git commit -m "feat(redesign): wire ⌘G/⇧⌘G group/ungroup; drop unwired zoom hints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Accessibility pass (tabs, dialogs, menus)

**Files:** `webapp/src/DiagramTabs.tsx`, `webapp/src/DialogShell.tsx`, `webapp/src/MenuBar.tsx`

**Interfaces:** none new; additive ARIA/keyboard.

- [ ] **Step 1: Tab strip a11y.** In `DiagramTabs.tsx`: give the tabs container `role="tablist"`; each tab `role="tab"`, `tabIndex={0}`, `aria-selected={tab.id === activeId}`, and an `onKeyDown` that activates on Enter/Space (`onSelect(tab.id)`) and moves between tabs with ArrowLeft/ArrowRight (focus + select the prev/next tab). Make the `×` close a real `<button type="button">` with `aria-label={`Close ${tab.name}`}` (keep its `onClick` + `stopPropagation`). Do not change the visual layout.

- [ ] **Step 2: Dialog initial focus + focus trap.** In `DialogShell.tsx`: on mount, focus the first focusable element inside the dialog body, or the primary footer button if the body has none (query `input, textarea, select, button`). Add a `Tab`/`Shift+Tab` trap in the existing keydown handler so focus cycles within the dialog (compute the focusable list, and when Tab would leave the last (or Shift+Tab the first), wrap to the other end). Keep Esc→onCancel and Enter→onSubmit. This makes `DestructiveDialog`/`ImportDialog`/prompt/confirm all focus-managed.

- [ ] **Step 3: Menu roles.** In `MenuBar.tsx`: give each open menu panel `role="menu"` and each item `role="menuitem"` (align with the pill dropdown, which already sets `role="menuitem"`). Add `aria-disabled={item.disabled}` on disabled items. Keep existing keyboard nav.

- [ ] **Step 4: Verify + commit**

```bash
cd webapp && npx tsc --noEmit && npx vitest run
git add webapp/src/DiagramTabs.tsx webapp/src/DialogShell.tsx webapp/src/MenuBar.tsx
git commit -m "a11y(redesign): tab-strip roles/keyboard, dialog focus trap, menu roles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Menu/popover/playback polish

**Files:** `webapp/src/index.css`, `webapp/src/FlowsTab.tsx`, `webapp/src/TransportBar.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Menu open transition.** Add the handoff's 120ms ease-out fade + 2px rise to menus/dropdowns. Since menus mount/unmount, use a CSS keyframe applied on mount. In `index.css`:

```css
@keyframes menuIn {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
.menu, .pill__menu, .transport__speedmenu, .flowstab__menu {
  animation: menuIn 120ms ease-out;
}
@media (prefers-reduced-motion: reduce) { .menu, .pill__menu, .transport__speedmenu, .flowstab__menu { animation: none; } }
```

(Match the actual dropdown class names in the codebase — verify each exists; drop any that don't. Do not animate the rail tab switch.)

- [ ] **Step 2: Gate FlowsTab step editing to edit mode.** In `FlowsTab.tsx`, when `mode === 'play'` the step controls (caption `<input>`, element chip `×` buttons, "+ click canvas", "+ Add step", and Reorder ↑/↓) should be read-only/hidden — render them only when `mode === 'edit'`. During play, the selected-step card shows caption + chips as static text (no inputs/×/add). Keep the step list navigable (clicking a step still selects it). This closes the "steps editable during play" fast-follow.

- [ ] **Step 3: Footer `⋯` popover edge-flip.** In `FlowsTab.tsx`, the flow-row/footer `⋯` popover (`.flowstab__menu`) opens at a fixed offset and can run off the right viewport edge. On open, measure the trigger's `getBoundingClientRect()` and, when there isn't room to the right, add a modifier class (e.g. `.flowstab__menu--left`) that anchors it to the right edge of the trigger (opens leftward). Add the CSS for the left variant.

- [ ] **Step 4: Scrubber hit target.** In `TransportBar.tsx` / `index.css`, keep the 5px visual bar but enlarge the clickable area: give `.transport__bar` more height with transparent top/bottom padding and `background-clip: content-box` (so the painted bar stays 5px while the button is ~16px tall), or add an invisible `::before` overlay. Verify the bars still render 5px visually and remain click-to-jump.

- [ ] **Step 5: Verify + commit**

```bash
cd webapp && npx tsc --noEmit && npx vitest run
git add webapp/src/index.css webapp/src/FlowsTab.tsx webapp/src/TransportBar.tsx
git commit -m "polish(redesign): menu transition, play-mode step lock, popover edge-flip, scrubber hit area

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Browser validation (controller-run)

**Files:** none (verification only; use a **throwaway** diagram [[sdd-smokes-use-throwaway-diagram]]).

- [ ] **Step 1: Consistency.** Confirm a 1-entity/1-group/1-edge diagram's tab meta reads "1 entity · 1 group · 1 edge" (singular); ⌘⇧O no longer opens the Open dialog (⌘O still does); the rail doesn't shrink; toggling the rail fits the view without a jump.
- [ ] **Step 2: Shortcuts.** Select 2 top-level nodes → ⌘G groups them; select the group → ⇧⌘G ungroups; both are inert while a text field is focused. View menu no longer shows ⌘+/⌘−/⌘0/⇧1 hints. Group and Ungroup are never both enabled at once.
- [ ] **Step 3: A11y.** Tab through the tab strip (Enter/Space activates, arrows move); the close `×` is a labeled button. Open a dialog → focus lands inside, Tab cycles within it, Esc cancels. Menus expose menu/menuitem roles (spot-check via the accessibility tree).
- [ ] **Step 4: Polish.** Menus fade+rise on open (unless reduced-motion). In a flow, Play mode → the steps block is read-only (no caption input / × / add / reorder); Exit → editable again. The footer `⋯` opens fully on-screen even near the right edge. The scrubber bars are easier to click but still render 5px.
- [ ] **Step 5: Cleanup.** Delete the throwaway; confirm no `model.json`/`history.json` staged; confirm the real diagrams were untouched.

---

## Self-Review

**Coverage of the targeted fast-follows:**
- Dead `.dialog*` CSS + `.dialog` token + `.menu__submenu-parent` + `buildSeed` → Task 1. ✅ (`.pill__text:disabled` correctly kept — now live.)
- Meta pluralization, ⌘O guard, engine-id guard, `.rightrail` flex-shrink, fitView rAF, group/ungroup exclusivity → Task 2. ✅
- ⌘G/⇧⌘G shortcuts + drop zoom hints → Task 3. ✅ (per the user's decision)
- Tab-strip a11y, dialog focus/trap, menu roles → Task 4. ✅
- Menu transition, steps-editable-during-play, footer `⋯` edge-flip, scrubber hit target → Task 5. ✅

**Placeholder scan:** none — each step names the file, anchor, and concrete change. ✅

**Explicitly NOT in this phase (documented deferrals, still tracked):** Inspector §5a restyle (next phase). Product decisions left as-is: empty-state-not-persisted-across-reload, snap-to-grid default, flow-switch-while-playing, notes-groupable, periodic no-op write-back during playback (pre-existing race). Design-deferred features: tab drag-reorder, overflow "+N more" chip, Open-dialog sub-tabs/thumbnails/"edited Xm ago" (no model timestamp), multi-select Inspector + Diagram "Last edited" block. `setPlaying`-inside-updater (cosmetic StrictMode note). Cosmetic micro-items (`newDiagram` dead return, `.tab` CSS redundancy, Open-dialog inline style, submenu-hover-orphan) — harmless, left for a future tidy.

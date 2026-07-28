# Ad-hoc-first Entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make entity creation ad-hoc-first and shelve the entity-library UI (reversibly), so authoring a diagram for an unrelated domain no longer clutters a shared, browsable catalog.

**Architecture:** Keep `model.entities[]` global and every existing lookup untouched (zero churn to buildGraph/MCP/ops/diff/persistence). Add one model rule — an orphan sweep on diagram delete — so the now-hidden store doesn't accumulate dead entities. Relocate entity *creation* from the catalog Palette into the on-canvas ＋ menu, then remove the two library surfaces (the bottom-left Palette panel and the Entities page tab).

**Tech Stack:** Vite + React + TypeScript, React Flow (`@xyflow/react`), Vitest for unit tests, Playwright (MCP) for browser verification. Package root: `webapp/`.

**Spec:** `docs/superpowers/specs/2026-07-28-adhoc-entities-design.md`

## Global Constraints

- All commands run from the `webapp/` directory. Tests: `npx vitest run`; types: `npx tsc --noEmit`.
- Never use `window.alert` / `window.prompt` / `window.confirm`. Use the in-app dialogs from `webapp/src/Dialog.tsx` (`useDialogs()` → `showPrompt` / `showConfirm`).
- App is served over plain-HTTP LAN — avoid secure-context-only browser APIs.
- Capitalize only the first letter of multi-letter acronyms (e.g. `RagService`, not `RAGService`).
- Do NOT commit `model.json` / `history.json` (git-ignored runtime state).
- Git commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Keep the global entity store.** No structural model change, no `adhoc`/`library` flag in this plan (both are explicitly deferred to the library's future return).
- **Keep templates unchanged.** Do not touch `Template`, `applyTemplate`, `addTemplate`, `deleteTemplate`, or the templates sub-tab.
- **Do not change MCP tools** (`list_entities`, `place_entity`, authoring). They stay working on the same model.
- Leave `webapp/src/EntitiesPage.tsx` on disk (unreferenced after Task 3) so the library can return by re-wiring rather than rewriting.

## File Map

- `webapp/src/model.ts` — `deleteDiagram()` gains the orphan sweep (Task 1).
- `webapp/src/model.test.ts` — update the existing delete test's contract + add sweep tests (Task 1).
- `webapp/src/CanvasAddMenu.tsx` — "Entity" mode flips from search-existing → create-new (Task 2).
- `webapp/src/App.tsx` — pass a create callback into `CanvasAddMenu`; then remove the `<Palette>` panel and the Entities nav tab + route (Tasks 2–3).
- `webapp/src/Palette.tsx` — becomes unused after Task 3; the import/usage is removed from `App.tsx`. Leave the file on disk.

---

### Task 1: Orphan sweep on diagram delete (model)

**Files:**
- Modify: `webapp/src/model.ts` (`deleteDiagram`, currently at lines 312-314)
- Test: `webapp/src/model.test.ts` (existing test at line 139; `model mutations` describe block, `base` at line 95)

**Interfaces:**
- Consumes: existing `Model`, `Diagram`, `Placement` types; existing `deleteDiagram(model, id)` signature is unchanged (`(model: Model, id: string) => Model`).
- Produces: same `deleteDiagram(model, id): Model` signature, now also removing this diagram's newly-orphaned entities. Both `ops.ts` (`M.deleteDiagram`) and `App.tsx` (`deleteActiveDiagram`) call this and inherit the behavior — no changes needed there.

Current implementation (for reference — you are replacing the body):
```ts
export function deleteDiagram(model: Model, id: string): Model {
  return { ...model, diagrams: model.diagrams.filter((d) => d.id !== id) }
}
```

- [ ] **Step 1: Update the existing delete test's contract + add sweep tests**

In `webapp/src/model.test.ts`, find this existing test (around line 139) and REPLACE it:
```ts
  it('deleteDiagram never touches the catalog', () => {
    const { model, id } = addDiagram(base, 'Temp', 'canvas')
    const m = deleteDiagram(model, id)
    expect(m.diagrams.find((x) => x.id === id)).toBeUndefined()
    expect(m.entities).toHaveLength(2)
  })
```
with these three tests (the first preserves the old assertion under an accurate name; the other two cover the sweep):
```ts
  it('deleteDiagram leaves the catalog intact when the removed diagram had no placements', () => {
    const { model, id } = addDiagram(base, 'Temp', 'canvas')
    const m = deleteDiagram(model, id)
    expect(m.diagrams.find((x) => x.id === id)).toBeUndefined()
    expect(m.entities.map((e) => e.id)).toEqual(['plex', 'users']) // untouched
  })
  it('deleteDiagram sweeps entities that were only placed in the removed diagram', () => {
    // add a second diagram that solely places a brand-new ad-hoc entity
    const withEntity = addEntity(base, { id: 'adhoc1', label: 'Ad-hoc', fields: [] })
    const { model: m2, id: d2 } = addDiagram(withEntity, 'Scratch', 'canvas')
    const placed = addPlacement(m2, d2, { entityId: 'adhoc1', position: { x: 0, y: 0 }, parentId: null })
    const after = deleteDiagram(placed, d2)
    expect(after.entities.map((e) => e.id)).toEqual(['plex', 'users']) // adhoc1 swept
  })
  it('deleteDiagram keeps an entity still placed in another diagram', () => {
    // 'plex' is placed in 'logical'; also place it in a second diagram, then delete that second one
    const { model: m2, id: d2 } = addDiagram(base, 'Second', 'canvas')
    const placed = addPlacement(m2, d2, { entityId: 'plex', position: { x: 0, y: 0 }, parentId: null })
    const after = deleteDiagram(placed, d2)
    expect(after.entities.map((e) => e.id)).toEqual(['plex', 'users']) // plex survives (still in 'logical')
  })
  it('deleteDiagram does not sweep pre-existing catalog-only entities', () => {
    // 'orphanCatalog' is never placed anywhere; deleting an unrelated diagram must not remove it
    const withOrphan = addEntity(base, { id: 'orphanCatalog', label: 'Never Placed', fields: [] })
    const { model: m2, id: d2 } = addDiagram(withOrphan, 'Unrelated', 'canvas')
    const after = deleteDiagram(m2, d2)
    expect(after.entities.some((e) => e.id === 'orphanCatalog')).toBe(true)
  })
```

- [ ] **Step 2: Run the tests to confirm the sweep tests fail**

Run: `cd webapp && npx vitest run src/model.test.ts -t "deleteDiagram"`
Expected: the "leaves the catalog intact" and "does not sweep pre-existing" tests PASS (behavior unchanged for those), while "sweeps entities that were only placed in the removed diagram" FAILS (entity `adhoc1` is still present because the current `deleteDiagram` never touches the catalog). "keeps an entity still placed in another diagram" PASSES.

- [ ] **Step 3: Implement the orphan sweep**

In `webapp/src/model.ts`, replace `deleteDiagram` with:
```ts
export function deleteDiagram(model: Model, id: string): Model {
  const removed = model.diagrams.find((d) => d.id === id)
  const diagrams = model.diagrams.filter((d) => d.id !== id)
  if (!removed) return { ...model, diagrams }
  // Sweep this diagram's ad-hoc entities: those placed in the removed diagram
  // that now have no placement in any remaining diagram. Never touches entities
  // that weren't placed in the removed diagram (e.g. pre-existing catalog-only).
  const candidates = new Set(removed.placements.map((p) => p.entityId))
  if (candidates.size === 0) return { ...model, diagrams }
  const stillPlaced = new Set<string>()
  for (const d of diagrams) for (const p of d.placements) stillPlaced.add(p.entityId)
  const entities = model.entities.filter((e) => !candidates.has(e.id) || stillPlaced.has(e.id))
  return { ...model, diagrams, entities }
}
```

- [ ] **Step 4: Run the full model test file + tsc**

Run: `cd webapp && npx vitest run src/model.test.ts && npx tsc --noEmit`
Expected: all `deleteDiagram` tests PASS; whole `model.test.ts` green; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add src/model.ts src/model.test.ts
git commit -m "feat: sweep a diagram's ad-hoc entities on delete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: On-canvas ＋ menu creates a new entity (relocate creation)

**Files:**
- Modify: `webapp/src/CanvasAddMenu.tsx` (whole "Entity" mode, lines 5-127)
- Modify: `webapp/src/App.tsx` (the `<CanvasAddMenu ... />` usage, around lines 869-880; `createEntity` at line 364; helpers)
- Verify: browser (Playwright)

**Interfaces:**
- Consumes from App: `createEntity(entity: Entity)` (App.tsx:364) — already creates + places an entity on the active diagram in one step (`addPlacement(addEntity(base, entity), activeId, {...})`). This is the exact call the new create flow will trigger.
- Consumes `Entity` type from `./model`: `{ id: string; label: string; icon?: string; fields: EntityField[]; ... }`.
- Produces: `CanvasAddMenu` gains an `onCreateEntity(label: string)` prop and drops its dependence on a pre-filtered `entities` list for placement. App owns id-slugging (so ids stay unique against `model.entities`).

**Context:** After this task the app has TWO create paths (the new ＋-menu one and the old Palette panel). That's fine and intentional — Task 3 removes the Palette. Keeping them both here means Task 2 leaves the app fully working and is independently reviewable.

- [ ] **Step 1: Add id-slug helpers + an `onCreateEntity` handler in App.tsx**

The slug/unique-id helpers currently live only in `Palette.tsx`. Add local copies in `App.tsx` (near the other `useCallback` handlers, e.g. just above `createEntity` at line 364) so App can mint a unique id from a label:
```ts
  const createEntityFromLabel = useCallback(
    (rawLabel: string, at?: { x: number; y: number }) => {
      if (!model || !activeId) return
      const label = rawLabel.trim()
      if (!label) return
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entity'
      const existing = new Set(model.entities.map((e) => e.id))
      let id = slug
      for (let n = 2; existing.has(id); n++) id = `${slug}-${n}`
      const pos = at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 })
      const base = flushCanvasInto(model, activeId, nodes, edges)
      setModel(addPlacement(addEntity(base, { id, label, fields: [] }), activeId, { entityId: id, position: pos, parentId: null }))
      pendingSelect.current = id
    },
    [model, activeId, rf, nodes, edges],
  )
```
(This mirrors the existing `createEntity`/`placeEntity` bodies — same `flushCanvasInto` → `addPlacement(addEntity(...))` → `pendingSelect` shape — but takes a label and an optional drop position so the entity lands where the ＋ menu was opened.)

- [ ] **Step 2: Repurpose CanvasAddMenu's Entity mode to create-new**

Replace `webapp/src/CanvasAddMenu.tsx` in full with:
```tsx
import { useEffect, useRef, useState } from 'react'

interface Props {
  x: number
  y: number
  onCreateEntity: (label: string) => void
  onAddGroup: () => void
  onAddNote: () => void
  onClose: () => void
}

// A small "Add" menu shown where the user double-clicks empty canvas. Group and
// Note create a fresh node; Entity prompts for a label and creates a new ad-hoc
// entity placed at the click point (entities are no longer browsed from a shared
// catalog — creation is ad-hoc-first).
export function CanvasAddMenu({ x, y, onCreateEntity, onAddGroup, onAddNote, onClose }: Props) {
  const [mode, setMode] = useState<'root' | 'entity'>('root')
  const [label, setLabel] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const submit = () => {
    const l = label.trim()
    if (!l) return
    onCreateEntity(l)
    onClose()
  }

  return (
    <div ref={ref} className="addmenu" style={{ left: x, top: y }}>
      {mode === 'root' ? (
        <>
          <div className="addmenu__title">Add</div>
          <button className="addmenu__item" onClick={() => setMode('entity')}>
            <span className="addmenu__ico">◇</span>
            <span>Entity</span>
            <span className="addmenu__more">›</span>
          </button>
          <button
            className="addmenu__item"
            onClick={() => {
              onAddGroup()
              onClose()
            }}
          >
            <span className="addmenu__ico">▭</span>
            <span>Group</span>
          </button>
          <button
            className="addmenu__item"
            onClick={() => {
              onAddNote()
              onClose()
            }}
          >
            <span className="addmenu__ico">✎</span>
            <span>Note</span>
          </button>
        </>
      ) : (
        <div className="addmenu__entity">
          <input
            autoFocus
            className="addmenu__search"
            placeholder="New entity label…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <button className="addmenu__item" onClick={submit} disabled={!label.trim()}>
            <span className="addmenu__ico">＋</span>
            <span>Create “{label.trim() || '…'}”</span>
          </button>
          <button className="addmenu__back" onClick={() => setMode('root')}>
            ‹ Back
          </button>
        </div>
      )}
    </div>
  )
}
```
Notes:
- The `ICON_BASE` and `Entity` imports are dropped (no longer needed).
- The `entities`, `onPlaceEntity` props are removed. Group/Note behavior is unchanged.

- [ ] **Step 3: Update the CanvasAddMenu usage in App.tsx**

Find the usage (around lines 869-880) and replace it:
```tsx
      {addMenu && (
        <CanvasAddMenu
          x={addMenu.sx}
          y={addMenu.sy}
          entities={model.entities
            .filter((e) => !placedIds.has(e.id))
            .sort((a, b) => a.label.localeCompare(b.label))}
          onPlaceEntity={(id) => placeEntity(id, addMenu.flow)}
          onAddGroup={() => addGroup(addMenu.flow)}
          onAddNote={() => addNote(addMenu.flow)}
          onClose={() => setAddMenu(null)}
        />
      )}
```
with:
```tsx
      {addMenu && (
        <CanvasAddMenu
          x={addMenu.sx}
          y={addMenu.sy}
          onCreateEntity={(label) => createEntityFromLabel(label, addMenu.flow)}
          onAddGroup={() => addGroup(addMenu.flow)}
          onAddNote={() => addNote(addMenu.flow)}
          onClose={() => setAddMenu(null)}
        />
      )}
```
(`addMenu.flow` is the flow-coordinate drop point already used by `addGroup`/`addNote`; it becomes the new entity's position.)

- [ ] **Step 4: Type-check**

Run: `cd webapp && npx tsc --noEmit`
Expected: clean. (If tsc flags `placeEntity` or `placedIds` as now-unused, leave them — they are still consumed by the `<Palette>` panel until Task 3. If it flags them unused because nothing else references them, that means the Palette already went; it hasn't in this task, so they should still be used.)

- [ ] **Step 5: Browser-verify the create flow**

Start the dev server if not already running (`cd webapp && npm run dev`), open the app, then with Playwright MCP:
1. Double-click empty canvas → the Add menu appears.
2. Click **Entity** → type a label (e.g. `TestBox`) → press Enter (or click Create).
3. Confirm a node labeled `TestBox` appears on the canvas at roughly the click point and is selected (Inspector shows it).
4. Confirm no console errors.
Then delete the `TestBox` node (select it, Delete) so the model isn't polluted, and verify via the app that it's gone.

- [ ] **Step 6: Commit**

```bash
cd webapp && git add src/CanvasAddMenu.tsx src/App.tsx
git commit -m "feat: create ad-hoc entities from the on-canvas add menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Remove the library surfaces (Palette panel + Entities tab)

**Files:**
- Modify: `webapp/src/App.tsx` (Palette import ~line 36; `<Panel position="bottom-left">` block ~lines 856-858; the `view` state ~line 888; the tab bar buttons ~lines 1009-1021; the `EntitiesPage` route ~lines 1025-1045)
- Leave on disk (do NOT delete): `webapp/src/Palette.tsx`, `webapp/src/EntitiesPage.tsx`
- Verify: browser (Playwright)

**Interfaces:**
- Consumes: nothing new. This task only removes UI wiring.
- Produces: the app renders the diagrams canvas only; there is no Entities tab and no bottom-left catalog panel. `EntitiesPage.tsx` and `Palette.tsx` remain unreferenced modules on disk for the library's future return.

**Context:** After Task 2, entity creation no longer needs the Palette. This task removes the two catalog surfaces. Because the whole app now has a single view, the two-item tab bar collapses to just the save indicator.

- [ ] **Step 1: Remove the bottom-left Palette panel from App.tsx**

Delete the `<Panel position="bottom-left">…</Panel>` block that renders `<Palette>` (around lines 856-858):
```tsx
        <Panel position="bottom-left">
          {model && (
            <Palette
              entities={model.entities}
              placedIds={placedIds}
              onPlace={placeEntity}
              onCreate={createEntity}
            />
          )}
        </Panel>
```
Remove the now-unused `import { Palette } from './Palette'` (line 36).

- [ ] **Step 2: Remove the Entities tab + route, collapse the tab bar**

Remove the `view` state (`const [view, setView] = useState<'diagrams' | 'entities'>('entities')`, line 888) and the `EntitiesPage` import (line 36 area: `import { EntitiesPage } from './EntitiesPage'`).

Replace the tab bar + conditional render (roughly lines 1007-1046) — currently:
```tsx
      <div className="tabbar">
        <button
          className={view === 'entities' ? 'active' : ''}
          onClick={() => setView('entities')}
        >
          Entities
        </button>
        <button
          className={view === 'diagrams' ? 'active' : ''}
          onClick={() => setView('diagrams')}
        >
          Diagrams
        </button>
        <span className="tabbar__save" style={{ color: saveColor }}>
          {saveLabel}
        </span>
      </div>
      {!model ? null : view === 'diagrams' ? (
        <ReactFlowProvider>
          <Flow
            model={model}
            setModel={setModelNonNull}
            activeId={activeId!}
            setActiveId={handleSetActive}
            undoFlags={undoMap[activeId!] ?? { canUndo: false, canRedo: false }}
          />
        </ReactFlowProvider>
      ) : (
        <EntitiesPage
          model={model}
          setModel={setModelNonNull}
          onJump={(id) => {
            setActiveId(id)
            localStorage.setItem(ACTIVE_KEY, id)
            setView('diagrams')
          }}
        />
      )}
```
with (single view, tab bar keeps only the save indicator):
```tsx
      <div className="tabbar">
        <span className="tabbar__save" style={{ color: saveColor }}>
          {saveLabel}
        </span>
      </div>
      {!model ? null : (
        <ReactFlowProvider>
          <Flow
            model={model}
            setModel={setModelNonNull}
            activeId={activeId!}
            setActiveId={handleSetActive}
            undoFlags={undoMap[activeId!] ?? { canUndo: false, canRedo: false }}
          />
        </ReactFlowProvider>
      )}
```

- [ ] **Step 3: Clean up any now-unused App.tsx symbols**

Run: `cd webapp && npx tsc --noEmit`
Expected: tsc reports unused symbols that only the removed surfaces used. Resolve each by deletion:
- `createEntity` (App.tsx:364) — was only passed to `<Palette onCreate>`; delete the `useCallback`.
- `placeEntity` (App.tsx:353) — was passed to `<Palette onPlace>` and the old CanvasAddMenu; Task 2 removed the CanvasAddMenu use. If nothing else references it, delete it; if `pendingSelect`/other code still calls it, keep it.
- `placedIds` (App.tsx:229 area) — was passed to `<Palette>` / old CanvasAddMenu; delete if unreferenced.
- `ACTIVE_KEY` usage inside the removed `onJump` is gone; keep the `ACTIVE_KEY` constant if it's still used elsewhere (it is, for active-diagram persistence) — only remove references that no longer resolve.
Re-run `npx tsc --noEmit` until clean. Do not silence unused-symbol errors with `// eslint-disable` or `_`-prefixes — delete the dead code.

- [ ] **Step 4: Run the full suite + tsc**

Run: `cd webapp && npx vitest run && npx tsc --noEmit`
Expected: full suite green (no test referenced the removed UI); tsc clean.

- [ ] **Step 5: Browser-verify the shelving**

With the dev server running, via Playwright MCP:
1. Load the app — confirm there is **no Entities tab** in the tab bar and **no bottom-left "Entities" palette panel** on the canvas.
2. Confirm an existing diagram still renders its nodes/edges normally (no regression).
3. Confirm the ＋-menu create flow from Task 2 still works (double-click → Entity → label → node appears).
4. Confirm no console errors.

- [ ] **Step 6: Commit**

```bash
cd webapp && git add src/App.tsx
git commit -m "feat: shelve the entity-library UI (Palette panel + Entities tab)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Keep global store, no flag, no structural change → honored across all tasks (Global Constraints + Task 1 keeps `model.entities[]`). ✓
- Orphan sweep on diagram delete, scoped to the deleted diagram's entities, not touching pre-existing catalog-only entities → Task 1 (impl + all four test cases including the "does not sweep pre-existing" guard). ✓
- ＋ menu "Entity" flips to create-new; creation relocated out of the catalog → Task 2. ✓
- Remove bottom-left Palette panel → Task 3 Step 1. ✓
- Remove Entities page nav tab + route; leave `EntitiesPage.tsx` on disk → Task 3 Steps 2 (+ "leave on disk" in Files). ✓
- Remove cross-diagram "place existing" pickers → Palette panel removed (Task 3), CanvasAddMenu search removed/repurposed (Task 2). ✓
- Templates unchanged; MCP unchanged → Global Constraints; no task touches them. ✓
- Reversibility (file parked, no data migration) → `EntitiesPage.tsx`/`Palette.tsx` left on disk; global store retained. ✓
- Testing: unit (orphan sweep + create) and browser (create flow, surfaces gone, no regression) → Task 1 tests, Task 2 Step 5, Task 3 Step 5. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step carries full code. Task 3 Step 3 names each specific symbol to check rather than saying "clean up unused code" generically.

**Type consistency:** `deleteDiagram(model, id): Model` signature unchanged (Task 1). `createEntityFromLabel(rawLabel: string, at?: {x,y})` defined in Task 2 Step 1 and called in Task 2 Step 3. `CanvasAddMenu` prop `onCreateEntity: (label: string) => void` defined in Task 2 Step 2 and supplied in Step 3. `Entity` shape `{ id, label, fields: [] }` matches the existing `createEntity`/`Palette` construction. Removed props (`entities`, `onPlaceEntity`, `placedIds`, `onPlace`, `onCreate`) are consistently dropped in Tasks 2-3.

**Note for the executor (cross-task):** Task 2 deliberately leaves `placeEntity`/`placedIds`/`createEntity` in place (still used by the Palette); Task 3 removes the Palette and then deletes whichever of those became unused. Do the tasks in order — running Task 3 before Task 2 would remove the only create path mid-stream.

# Dialog Restyle → Shared §6 Shell (Chrome Phase 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every dialog onto one shared §6 shell and fill the gaps: a real **Reset-confirm** (which now *clears the diagram to empty* instead of silently reseeding the demo graph), a counts-aware **Delete-confirm**, and a proper **Import JSON dialog** (drop zone + validation + "Import into a new diagram").

**Architecture:** A new presentational `DialogShell.tsx` renders the §6 card (scrim, header, body, footer) and owns Esc-to-cancel / Enter-fires-primary. The existing promise-based `Dialog.tsx` (prompt/confirm) is refactored to render *through* `DialogShell`, so New/Rename inherit the shell. Two new bespoke dialogs — `DestructiveDialog.tsx` (Reset + Delete, driven by an App `dialog` state) and `ImportDialog.tsx` — also build on `DialogShell`. New pure model helpers (`diagramCounts`, `describeCounts`, `clearDiagram`, `mergeModel`) carry the testable logic.

**Tech Stack:** Vite + React 18 + TypeScript, hand-written plain CSS in `src/index.css`, Vitest (node env — pure-function tests only, no DOM).

## Global Constraints

- Never use `window.alert` / `prompt` / `confirm` — in-app dialogs only. [[no-native-popups]]
- Never commit `webapp/model.json` or `webapp/history.json`.
- Capitalize only the first letter of multi-letter acronyms.
- App is served over plain-HTTP LAN — no secure-context-only browser APIs.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Product decisions locked for this phase:** (1) **Reset diagram = clear the active diagram to empty** (remove all nodes/groups/edges/notes/flows) but keep the diagram row; NOT the legacy reseed-demo behavior. (2) **Import = full §6 dialog**; the "Import into a new diagram" toggle is **on by default** and *adds* the imported diagram(s) to the current model with fresh ids; toggling it off *replaces* the whole model (today's behavior).
- **§6 design tokens (verbatim, copied into tasks):** shell `background: #fff`, `border: 1px solid #d7dce4`, `border-radius: 12px`, `box-shadow: 0 12px 34px rgba(15,23,42,0.14)`, `overflow: hidden`. Title **15.5px / 700**, padding `15px 18px 0`. Footer: padding `11px 14px`, `border-top: 1px solid #eceff3`, `background: #fbfbfc`, secondary actions left / primary right, `gap: 8px`. Footer secondary button: padding `7px 13px`, `border: 1px solid #dfe3ea`, `border-radius: 7px`, **12.5px / 550**. Primary: padding `7px 15px`, `background: #4f46e5`, `#fff`, **12.5px / 600**; destructive primary `background: #b91c1c`; disabled primary `background: #c7cdfa`. Scrim `rgba(15,23,42,0.28)`. `Esc` cancels, `⏎` fires the primary. Dialog widths: **420px** (Rename/Import/Reset/Delete), **560px** (Open). Rename helper text **11.5px** `#94a3b8` "Saved to model.json on confirm." Import drop zone: padding `20px 0`, centered, `border: 1px dashed #cbd5e1`, `border-radius: 9px`, title **13px / 600** "Drop a .json file", sub **11.5px** `#64748b` "or click to browse". Import error block: padding `10px 11px`, `border: 1px solid #f0d2d2`, `background: #fdf3f3`, `border-radius: 8px`, `!` in `#b91c1c`, title **12.5px / 600** `#b91c1c`, body **11.5px / 1.45** `#7f2d2d`. Reset/Delete checkbox 15×15px, `border: 1px solid #cbd5e1`, `border-radius: 4px`. Reset/Delete body **13px / 1.5** `#475569`.

---

## File Structure

- **Create** `webapp/src/DialogShell.tsx` — presentational §6 card (scrim + header + body + footer + Esc/Enter).
- **Create** `webapp/src/DestructiveDialog.tsx` — Reset/Delete confirm (title quotes name, counts body, backup checkbox, red primary).
- **Create** `webapp/src/ImportDialog.tsx` — drop zone + parse/validate + error block + "into new diagram" toggle.
- **Modify** `webapp/src/model.ts` — add `diagramCounts`, `describeCounts`, `clearDiagram`, `mergeModel`.
- **Modify** `webapp/src/model.test.ts` (or create if absent) — unit tests for the four helpers.
- **Modify** `webapp/src/Dialog.tsx` — refactor `DialogModal` to render through `DialogShell`; add `helperText` to `PromptOpts`.
- **Modify** `webapp/src/App.tsx` — add `dialog: 'reset' | 'delete' | 'import' | null` state; rewrite `reset` to clear-to-empty; route File ▸ Reset/Delete/Import to the new dialogs; render the three new dialogs.
- **Modify** `webapp/src/index.css` — restyle `.dialog*` + `.opendlg*` footer/buttons to §6 tokens; add `.dlgshell*`, `.destructive*`, `.importdlg*` styles.

---

### Task 1: Model helpers + tests

**Files:**
- Modify: `webapp/src/model.ts`
- Test: `webapp/src/model.test.ts` (create if it does not exist)

**Interfaces:**
- Consumes: existing `Model`, `Diagram`, `Template` types and the internal `mapDiagram` helper in `model.ts`.
- Produces:
  - `interface DiagramCounts { entities: number; groups: number; edges: number; flows: number; notes: number }`
  - `diagramCounts(d: Diagram): DiagramCounts`
  - `describeCounts(c: DiagramCounts): string`
  - `clearDiagram(model: Model, id: string): Model`
  - `mergeModel(model: Model, imported: Model): { model: Model; firstId: string | null }`

- [ ] **Step 1: Write the failing tests**

Create/append `webapp/src/model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { diagramCounts, describeCounts, clearDiagram, mergeModel } from './model'
import type { Diagram, Model } from './model'

function d(over: Partial<Diagram> = {}): Diagram {
  return { id: 'd1', name: 'D1', title: 'D1', type: 'canvas', nodes: [], groups: [], notes: [], edges: [], flows: [], ...over }
}
function m(diagrams: Diagram[], templates: Model['templates'] = []): Model {
  return { version: 2, diagrams, templates }
}

describe('diagramCounts / describeCounts', () => {
  it('counts each category', () => {
    const c = diagramCounts(d({
      nodes: [{}, {}, {}] as any,
      groups: [{}] as any,
      edges: [{}, {}] as any,
      flows: [{}] as any,
      notes: [{}, {}] as any,
    }))
    expect(c).toEqual({ entities: 3, groups: 1, edges: 2, flows: 1, notes: 2 })
  })

  it('describes non-zero categories, pluralized, with a trailing "and"', () => {
    expect(describeCounts({ entities: 12, groups: 3, edges: 9, flows: 2, notes: 0 }))
      .toBe('12 entities, 3 groups, 9 edges and 2 flows')
    expect(describeCounts({ entities: 1, groups: 0, edges: 1, flows: 0, notes: 0 }))
      .toBe('1 entity and 1 edge')
    expect(describeCounts({ entities: 5, groups: 0, edges: 0, flows: 0, notes: 0 }))
      .toBe('5 entities')
    expect(describeCounts({ entities: 0, groups: 0, edges: 0, flows: 0, notes: 0 }))
      .toBe('no content')
  })
})

describe('clearDiagram', () => {
  it('empties content but keeps the diagram row', () => {
    const before = m([d({ id: 'a', name: 'Keep', nodes: [{}] as any, flows: [{}] as any }), d({ id: 'b' })])
    const after = clearDiagram(before, 'a')
    const a = after.diagrams.find((x) => x.id === 'a')!
    expect(a.name).toBe('Keep')
    expect(a).toMatchObject({ nodes: [], groups: [], notes: [], edges: [], flows: [] })
    // other diagrams untouched, referential-ish integrity
    expect(after.diagrams.find((x) => x.id === 'b')).toBe(before.diagrams.find((x) => x.id === 'b'))
  })
})

describe('mergeModel', () => {
  it('adds imported diagrams with collision-free ids and returns the first', () => {
    const base = m([d({ id: 'd-x', name: 'X' })])
    const imported = m([d({ id: 'd-x', name: 'X import' }), d({ id: 'd-y', name: 'Y' })])
    const { model, firstId } = mergeModel(base, imported)
    expect(model.diagrams.map((x) => x.id)).toEqual(['d-x', 'd-x-2', 'd-y'])
    expect(firstId).toBe('d-x-2')
    // content preserved on the added copy
    expect(model.diagrams.find((x) => x.id === 'd-x-2')!.name).toBe('X import')
  })

  it('unions templates by id and handles an empty import', () => {
    const base = m([d()], [{ id: 't1', name: 'T1', fields: [] }])
    const imported = m([], [{ id: 't1', name: 'dup', fields: [] }, { id: 't2', name: 'T2', fields: [] }])
    const { model, firstId } = mergeModel(base, imported)
    expect(model.templates.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(firstId).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the helpers**

Append to `webapp/src/model.ts` (after `addTemplate`):

```ts
export interface DiagramCounts {
  entities: number
  groups: number
  edges: number
  flows: number
  notes: number
}

export function diagramCounts(d: Diagram): DiagramCounts {
  return {
    entities: d.nodes.length,
    groups: d.groups.length,
    edges: d.edges.length,
    flows: d.flows.length,
    notes: d.notes.length,
  }
}

// Human copy for destructive-confirm bodies: "12 entities, 3 groups, 9 edges and
// 2 flows". Lists only non-zero categories (entities/groups/edges/flows — notes
// are not surfaced), pluralizes, and joins with commas + a trailing "and".
// Returns "no content" when everything is zero.
export function describeCounts(c: DiagramCounts): string {
  const parts: string[] = []
  const push = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`)
  }
  push(c.entities, 'entity', 'entities')
  push(c.groups, 'group', 'groups')
  push(c.edges, 'edge', 'edges')
  push(c.flows, 'flow', 'flows')
  if (parts.length === 0) return 'no content'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Clear a diagram's content but keep the diagram row (id/name/title/type).
// patchDiagram's patch type excludes `flows`, so this uses mapDiagram directly.
export function clearDiagram(model: Model, id: string): Model {
  return mapDiagram(model, id, (d) => ({ ...d, nodes: [], groups: [], notes: [], edges: [], flows: [] }))
}

// Merge an imported model into this one as NEW diagrams: each imported diagram
// keeps its content but gets a collision-free id; imported templates are unioned
// by id. Returns the new model and the id of the first imported diagram (or null
// when the import has no diagrams).
export function mergeModel(model: Model, imported: Model): { model: Model; firstId: string | null } {
  const existing = new Set(model.diagrams.map((d) => d.id))
  const added: Diagram[] = []
  let firstId: string | null = null
  for (const d of imported.diagrams) {
    let id = d.id
    for (let n = 2; existing.has(id); n++) id = `${d.id}-${n}`
    existing.add(id)
    added.push({ ...d, id })
    if (firstId === null) firstId = id
  }
  const seenT = new Set(model.templates.map((t) => t.id))
  const templates = [...model.templates, ...imported.templates.filter((t) => !seenT.has(t.id))]
  return { model: { ...model, diagrams: [...model.diagrams, ...added], templates }, firstId }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp && npx vitest run src/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/model.ts webapp/src/model.test.ts
git commit -m "feat(dialogs): model helpers — diagramCounts/describeCounts/clearDiagram/mergeModel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: DialogShell + §6 CSS + refactor prompt/confirm

**Files:**
- Create: `webapp/src/DialogShell.tsx`
- Modify: `webapp/src/Dialog.tsx`
- Modify: `webapp/src/index.css`

**Interfaces:**
- Produces (Tasks 3-4 consume `DialogShell`):

```tsx
export function DialogShell(props: {
  title: string
  width?: number            // default 420
  danger?: boolean          // reserved for title styling; no behavior
  onCancel: () => void      // Esc + scrim click
  onSubmit?: () => void     // Enter (⏎ fires the primary)
  footer: React.ReactNode   // rendered in the §6 footer (secondary left / primary right)
  children: React.ReactNode // dialog body
}): JSX.Element
```

- [ ] **Step 1: Create DialogShell**

Create `webapp/src/DialogShell.tsx`:

```tsx
import { useCallback, useEffect } from 'react'

export function DialogShell(props: {
  title: string
  width?: number
  danger?: boolean
  onCancel: () => void
  onSubmit?: () => void
  footer: React.ReactNode
  children: React.ReactNode
}) {
  const { title, width = 420, danger, onCancel, onSubmit, footer, children } = props

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter' && onSubmit) {
        // Don't hijack Enter inside a multiline textarea.
        const t = e.target as HTMLElement | null
        if (t && t.tagName === 'TEXTAREA') return
        e.preventDefault()
        onSubmit()
      }
    },
    [onCancel, onSubmit],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  return (
    <div className="dlgshell__scrim" onMouseDown={onCancel}>
      <div
        className={`dlgshell${danger ? ' is-danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dlgshell__title">{title}</div>
        <div className="dlgshell__body">{children}</div>
        <div className="dlgshell__footer">{footer}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add helperText to PromptOpts and refactor DialogModal to use DialogShell**

In `webapp/src/Dialog.tsx`:

Add `helperText?: string` to the `PromptOpts` interface. Then replace the `DialogModal` component's `return (…)` markup (currently the `.dialog__overlay` / `.dialog` block, lines ~114-144) with a `DialogShell`-based render, and delete its own keydown effect (Esc/Enter now live in `DialogShell`). The new `DialogModal`:

```tsx
import { DialogShell } from './DialogShell'
// ...keep the existing prompt/confirm state, value state, refs, cancel/confirm callbacks.
// DELETE the useEffect that adds the window 'keydown' Escape/Enter listener
// (DialogShell owns those now).

  const opts = state.opts
  const danger = state.kind === 'confirm' && (state.opts as ConfirmOpts).danger
  const primaryLabel = opts.confirmText ?? (isPrompt ? 'OK' : danger ? 'Delete' : 'Confirm')

  return (
    <DialogShell
      title={opts.title}
      danger={danger}
      onCancel={cancel}
      onSubmit={confirm}
      footer={
        <>
          <button className="dlgshell__btn" onClick={cancel}>
            {opts.cancelText ?? 'Cancel'}
          </button>
          <button
            ref={okRef}
            className={`dlgshell__btn dlgshell__btn--primary${danger ? ' dlgshell__btn--danger' : ''}`}
            onClick={confirm}
          >
            {primaryLabel}
          </button>
        </>
      }
    >
      {opts.message && <p className="dlgshell__message">{opts.message}</p>}
      {isPrompt && (
        <label className="dlgshell__field">
          {(opts as PromptOpts).label && <span>{(opts as PromptOpts).label}</span>}
          <input
            ref={inputRef}
            value={value}
            placeholder={(opts as PromptOpts).placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
          {(opts as PromptOpts).helperText && (
            <span className="dlgshell__helper">{(opts as PromptOpts).helperText}</span>
          )}
        </label>
      )}
    </DialogShell>
  )
```

Keep the existing focus effect (focus input for prompt / primary button for confirm). The `.dialog*` classes are no longer emitted by `DialogModal`.

- [ ] **Step 3: Add helperText to the Rename diagram prompt**

In `webapp/src/App.tsx`, the `promptRenameDiagram` `showPrompt({ title: 'Rename diagram', label: 'Name', defaultValue: cur?.name })` call — add `helperText: 'Saved to model.json on confirm.'`.

- [ ] **Step 4: Add §6 shell CSS**

In `webapp/src/index.css`, append the shared shell styles, and re-point the old `.opendlg__footer` buttons to the §6 look. Append:

```css
/* ---- Shared §6 dialog shell ---- */
.dlgshell__scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 23, 42, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dlgshell {
  max-width: calc(100vw - 32px);
  background: #fff;
  border: 1px solid #d7dce4;
  border-radius: 12px;
  box-shadow: 0 12px 34px rgba(15, 23, 42, 0.14);
  overflow: hidden;
  font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.dlgshell__title { padding: 15px 18px 0; font-size: 15.5px; font-weight: 700; color: #1e293b; }
.dlgshell__body { padding: 12px 18px 16px; }
.dlgshell__message { margin: 0; font-size: 13px; line-height: 1.5; color: #475569; }
.dlgshell__field { display: flex; flex-direction: column; gap: 5px; }
.dlgshell__field > span:first-child { font-size: 11.5px; color: #64748b; }
.dlgshell__field input {
  padding: 9px 11px;
  border: 1px solid #dfe3ea;
  border-radius: 8px;
  font-size: 13.5px;
  box-sizing: border-box;
  width: 100%;
}
.dlgshell__field input:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.13);
}
.dlgshell__helper { font-size: 11.5px; color: #94a3b8; }
.dlgshell__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 11px 14px;
  border-top: 1px solid #eceff3;
  background: #fbfbfc;
}
.dlgshell__btn {
  padding: 7px 13px;
  border: 1px solid #dfe3ea;
  border-radius: 7px;
  background: #fff;
  color: #475569;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
}
.dlgshell__btn:hover { background: #f1f2f4; }
.dlgshell__btn--primary {
  border-color: transparent;
  background: #4f46e5;
  color: #fff;
  font-weight: 600;
  padding: 7px 15px;
}
.dlgshell__btn--primary:hover { background: #4338ca; }
.dlgshell__btn--primary:disabled { background: #c7cdfa; cursor: default; }
.dlgshell__btn--danger { background: #b91c1c; }
.dlgshell__btn--danger:hover { background: #991b1b; }
/* footer-left slot: a secondary action group pinned left (used by Open/Import) */
.dlgshell__footer-left { margin-right: auto; display: flex; gap: 8px; align-items: center; }
```

- [ ] **Step 5: Verify build + suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; suite green. (New/Rename/Delete prompts/confirms now render through the §6 shell.)

- [ ] **Step 6: Commit**

```bash
git add webapp/src/DialogShell.tsx webapp/src/Dialog.tsx webapp/src/App.tsx webapp/src/index.css
git commit -m "feat(dialogs): shared §6 DialogShell; route prompt/confirm through it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Destructive confirm dialog (Reset + Delete)

**Files:**
- Create: `webapp/src/DestructiveDialog.tsx`
- Modify: `webapp/src/App.tsx`
- Modify: `webapp/src/index.css`

**Interfaces:**
- Consumes: `DialogShell` (Task 2); `diagramCounts`, `describeCounts` (Task 1); existing `exportJson`, `deleteActiveDiagram`, `M.clearDiagram`, `active`, `activeId`, `setNodes`, `setEdges`, `setModel`, `rf`.
- Produces: an App `dialog` state and the `DestructiveDialog` component.

```tsx
export function DestructiveDialog(props: {
  mode: 'reset' | 'delete'
  diagramName: string
  countsText: string          // from describeCounts(diagramCounts(active))
  onCancel: () => void
  onConfirm: (backup: boolean) => void
}): JSX.Element
```

- [ ] **Step 1: Create the component**

Create `webapp/src/DestructiveDialog.tsx`:

```tsx
import { useState } from 'react'
import { DialogShell } from './DialogShell'

export function DestructiveDialog(props: {
  mode: 'reset' | 'delete'
  diagramName: string
  countsText: string
  onCancel: () => void
  onConfirm: (backup: boolean) => void
}) {
  const { mode, diagramName, countsText, onCancel, onConfirm } = props
  const [backup, setBackup] = useState(false)
  const verb = mode === 'reset' ? 'Reset' : 'Delete'
  const title = `${verb} "${diagramName}"?`
  const body =
    mode === 'reset'
      ? `This removes all ${countsText}, and cannot be undone. The diagram itself stays.`
      : `This deletes the diagram and its ${countsText}, and cannot be undone.`
  const submit = () => onConfirm(backup)

  return (
    <DialogShell
      title={title}
      danger
      onCancel={onCancel}
      onSubmit={submit}
      footer={
        <>
          <button className="dlgshell__btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="dlgshell__btn dlgshell__btn--primary dlgshell__btn--danger" onClick={submit}>
            {verb} diagram
          </button>
        </>
      }
    >
      <p className="dlgshell__message">{body}</p>
      <label className="destructive__check">
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        <span>Export a JSON backup first</span>
      </label>
    </DialogShell>
  )
}
```

- [ ] **Step 2: Rewrite `reset` to clear-to-empty and add the `dialog` state**

In `webapp/src/App.tsx`:

Add state near the other dialog state (`openDialog`): `const [dialog, setDialog] = useState<'reset' | 'delete' | 'import' | null>(null)`.

Replace the `reset` callback (currently reseeds `buildSeed()`) with a clear-to-empty version:

```ts
  const reset = useCallback(() => {
    if (!activeId) return
    // Clear the live canvas and the model's content for this diagram (flows too,
    // which never live on the canvas). The debounced write-back persists the now
    // empty canvas; clearDiagram drops the flows immediately.
    setNodes([])
    setEdges([])
    setModel((m) => (m ? M.clearDiagram(m, activeId) : m))
    setTimeout(() => rf.fitView({ padding: 0.2 }), 40)
  }, [activeId, setNodes, setEdges, setModel, rf])
```

(If `buildSeed` is now unused anywhere else, leave its import — a later task/phase may remove it; do not chase unrelated cleanup here.)

- [ ] **Step 3: Route the File-menu Reset/Delete to the dialog**

In `onMenuItem`'s File branch, change the `reset` and `delete` cases to open the dialog instead of acting immediately:

```ts
      case 'reset':
        setDialog('reset')
        break
      case 'delete':
        setDialog('delete')
        break
```

Delete the now-unused `confirmDeleteDiagram` (the old `showConfirm`-based one) if nothing else references it. Keep `deleteActiveDiagram` (the dialog calls it).

- [ ] **Step 4: Render the DestructiveDialog**

Add the import `import { DestructiveDialog } from './DestructiveDialog'` and `import { diagramCounts, describeCounts } from './model'` (or extend the existing `* as M` usage — use `M.diagramCounts`/`M.describeCounts` to avoid a second import). Near the `{openDialog && (…)}` block, add:

```tsx
      {dialog === 'reset' && active && (
        <DestructiveDialog
          mode="reset"
          diagramName={active.name}
          countsText={M.describeCounts(M.diagramCounts(active))}
          onCancel={() => setDialog(null)}
          onConfirm={(backup) => {
            if (backup) exportJson()
            reset()
            setDialog(null)
          }}
        />
      )}
      {dialog === 'delete' && active && activeId && (
        <DestructiveDialog
          mode="delete"
          diagramName={active.name}
          countsText={M.describeCounts(M.diagramCounts(active))}
          onCancel={() => setDialog(null)}
          onConfirm={(backup) => {
            if (backup) exportJson()
            deleteActiveDiagram(activeId)
            setDialog(null)
          }}
        />
      )}
```

- [ ] **Step 5: Add the checkbox CSS**

Append to `webapp/src/index.css`:

```css
/* ---- Destructive confirm (Reset / Delete) ---- */
.destructive__check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 12.5px;
  color: #475569;
  cursor: pointer;
}
.destructive__check input { width: 15px; height: 15px; accent-color: #4f46e5; }
```

- [ ] **Step 6: Verify build + suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; suite green.

- [ ] **Step 7: Commit**

```bash
git add webapp/src/DestructiveDialog.tsx webapp/src/App.tsx webapp/src/index.css
git commit -m "feat(dialogs): Reset (clear-to-empty) + Delete confirm with counts + backup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Import JSON dialog

**Files:**
- Create: `webapp/src/ImportDialog.tsx`
- Modify: `webapp/src/App.tsx`
- Modify: `webapp/src/index.css`

**Interfaces:**
- Consumes: `DialogShell` (Task 2); `M.normalizeModel`, `M.mergeModel` (Task 1); existing `setModel`, `setActiveId`, tab helpers (`addTab`/`openTabs`/`setOpenTabs`).
- Produces:

```tsx
export function ImportDialog(props: {
  onCancel: () => void
  // called with the parsed+normalized Model and whether to add-as-new (true) or
  // replace the whole model (false)
  onImport: (model: import('./model').Model, asNew: boolean) => void
}): JSX.Element
```

- [ ] **Step 1: Create the component**

Create `webapp/src/ImportDialog.tsx`:

```tsx
import { useRef, useState } from 'react'
import { normalizeModel, type Model } from './model'

type Parsed =
  | { ok: true; model: Model; fileName: string; diagramCount: number }
  | { ok: false; fileName: string; error: string }

export function ImportDialog(props: {
  onCancel: () => void
  onImport: (model: Model, asNew: boolean) => void
}) {
  const { onCancel, onImport } = props
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [asNew, setAsNew] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    file.text().then((text) => {
      try {
        const raw = JSON.parse(text)
        const model = normalizeModel(raw)
        setParsed({ ok: true, model, fileName: file.name, diagramCount: model.diagrams.length })
      } catch (err) {
        const msg = err instanceof SyntaxError ? err.message : 'Not valid JSON.'
        setParsed({ ok: false, fileName: file.name, error: msg })
      }
    })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const valid = parsed?.ok === true
  const submit = () => {
    if (parsed?.ok) onImport(parsed.model, asNew)
  }

  return (
    <DialogShellImport
      onCancel={onCancel}
      onSubmit={valid ? submit : undefined}
      valid={valid}
    >
      <div
        className={`importdlg__drop${dragOver ? ' is-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="importdlg__drop-title">Drop a .json file</div>
        <div className="importdlg__drop-sub">or click to browse</div>
        {parsed?.ok && (
          <div className="importdlg__drop-file">
            {parsed.fileName} · {parsed.diagramCount} diagram{parsed.diagramCount === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />
      {parsed && !parsed.ok && (
        <div className="importdlg__error">
          <div className="importdlg__error-title">
            <span className="importdlg__error-bang">!</span> Couldn't import {parsed.fileName}
          </div>
          <div className="importdlg__error-body">
            {parsed.error}. Nothing was imported.
          </div>
        </div>
      )}
      <label className="importdlg__toggle">
        <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
        <span>Import into a new diagram</span>
      </label>
    </DialogShellImport>
  )
}

// Thin wrapper so the footer can disable the primary until a valid parse.
function DialogShellImport(props: {
  onCancel: () => void
  onSubmit?: () => void
  valid: boolean
  children: React.ReactNode
}) {
  const { onCancel, onSubmit, valid, children } = props
  const { DialogShell } = require('./DialogShell')
  return (
    <DialogShell
      title="Import JSON"
      onCancel={onCancel}
      onSubmit={onSubmit}
      footer={
        <>
          <button className="dlgshell__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="dlgshell__btn dlgshell__btn--primary"
            onClick={onSubmit}
            disabled={!valid}
          >
            Import
          </button>
        </>
      }
    >
      {children}
    </DialogShell>
  )
}
```

> Implementer note: `require('./DialogShell')` is not valid in this ESM/Vite app — replace it with a top-level `import { DialogShell } from './DialogShell'` and use `DialogShell` directly (inline the wrapper into `ImportDialog`, or keep the helper but import at module top). Do NOT ship a `require` call. The structure above shows the intended footer/disabled wiring; implement it with a static import.

- [ ] **Step 2: Wire File ▸ Import to the dialog**

In `webapp/src/App.tsx`:
- Change the File-menu `import` case from `fileRef.current?.click()` to `setDialog('import')`.
- Change the `OpenDiagramDialog` `onImport` prop from `fileRef.current?.click()` to `() => { setOpenDialog(false); setDialog('import') }`.
- The hidden `<input ref={fileRef}>` and the old `onImport` change-handler can be removed (the dialog owns file selection now) — but if removing `onImport`/`fileRef` touches other references, leave them unused rather than breaking the build; prefer removal when clean.

- [ ] **Step 3: Render the ImportDialog + handle the result**

Add `import { ImportDialog } from './ImportDialog'`. Near the other dialogs:

```tsx
      {dialog === 'import' && (
        <ImportDialog
          onCancel={() => setDialog(null)}
          onImport={(imported, asNew) => {
            if (asNew) {
              setModel((m) => {
                if (!m) return imported
                const { model: merged, firstId } = M.mergeModel(m, imported)
                if (firstId) {
                  setActiveId(firstId)
                  setOpenTabs((t) => addTab(t, firstId))
                }
                return merged
              })
            } else {
              setModel(imported)
              const nextId = imported.diagrams[0]?.id ?? null
              setActiveId(nextId)
              if (nextId) setOpenTabs((t) => addTab(t, nextId))
            }
            setDialog(null)
          }}
        />
      )}
```

(Confirm the exact names of the tab-state setter and helper in App — the map showed `openTabs` + `addTab`; use whatever the surrounding code uses, e.g. `setOpenTabs`/`sanitizeOpenTabs`. Do not invent a setter that doesn't exist; match the file.)

- [ ] **Step 4: Add the Import dialog CSS**

Append to `webapp/src/index.css`:

```css
/* ---- Import JSON dialog ---- */
.importdlg__drop {
  padding: 20px 0;
  text-align: center;
  border: 1px dashed #cbd5e1;
  border-radius: 9px;
  cursor: pointer;
}
.importdlg__drop.is-over { border-color: #4f46e5; background: #f5f6ff; }
.importdlg__drop-title { font-size: 13px; font-weight: 600; color: #1e293b; }
.importdlg__drop-sub { font-size: 11.5px; color: #64748b; margin-top: 2px; }
.importdlg__drop-file { font-size: 11.5px; color: #4f46e5; margin-top: 8px; }
.importdlg__error {
  margin-top: 12px;
  padding: 10px 11px;
  border: 1px solid #f0d2d2;
  background: #fdf3f3;
  border-radius: 8px;
}
.importdlg__error-title { font-size: 12.5px; font-weight: 600; color: #b91c1c; }
.importdlg__error-bang { color: #b91c1c; font-weight: 700; }
.importdlg__error-body { font-size: 11.5px; line-height: 1.45; color: #7f2d2d; margin-top: 3px; }
.importdlg__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 12.5px;
  color: #475569;
  cursor: pointer;
}
.importdlg__toggle input { width: 15px; height: 15px; accent-color: #4f46e5; }
```

- [ ] **Step 5: Verify build + suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; suite green.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/ImportDialog.tsx webapp/src/App.tsx webapp/src/index.css
git commit -m "feat(dialogs): Import JSON dialog — drop zone, validation, import-as-new

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Browser validation (controller-run)

**Files:** none (verification only; run against a **throwaway** diagram — never the real "Homelab (sample)" for destructive checks [[sdd-smokes-use-throwaway-diagram]]).

- [ ] **Step 1: Shell + Rename.** Open File ▸ Rename… — confirm the §6 shell (white card, 15.5/700 title, footer with border-top, Cancel left / Rename right), the "Saved to model.json on confirm." helper, text pre-selected, Enter renames, Esc cancels.
- [ ] **Step 2: Reset (clear-to-empty).** On a throwaway diagram with a few entities/edges/a flow, File ▸ Reset diagram… — confirm the title quotes the name, the body lists the right counts ("removes all N entities, G groups, E edges and F flows"), the backup checkbox exports JSON when ticked, and confirming **empties the diagram (including flows) but keeps the diagram/tab**. Cancel leaves it untouched.
- [ ] **Step 3: Delete.** On a *second* throwaway diagram, File ▸ Delete diagram… — counts body, backup checkbox, confirm removes the diagram + its tab; Cancel leaves it.
- [ ] **Step 4: Import.** File ▸ Import JSON… — drop/browse a valid exported `homelab-model.json`: with the toggle **on**, the imported diagram(s) are ADDED (existing diagrams remain, new tab opens on the first import); with it **off**, the model is REPLACED. Feed an intentionally broken `.json` and confirm the error block names the file + parse position and says nothing was imported, with the primary **Import** disabled until a valid file is parsed.
- [ ] **Step 5: Cleanup.** Delete the throwaway diagrams; confirm `git status` shows no `model.json`/`history.json` staged; confirm the real "Homelab (sample)" diagram was never touched.

---

## Self-Review

**Spec coverage (§6):**
- Shared shell (surface/border/radius/shadow, title, footer, scrim, Esc/Enter) → Task 2 (`DialogShell` + CSS). ✅
- Rename (420, Name field, helper text, pre-select) → Task 2 (prompt through shell + helperText). ✅
- Reset destructive confirm (quotes name, counts, backup checkbox, red primary) → Task 3 + Task 1 (`describeCounts`). ✅ Behavior locked to clear-to-empty.
- Delete (same shell + counts + backup) → Task 3. ✅
- Import (drop zone, error block naming file + parse position + "nothing imported", into-new-diagram toggle on by default, primary disabled until valid) → Task 4 + Task 1 (`mergeModel`). ✅
- Open (560) — already built in Phase 2; its footer/buttons pick up §6 look via the shared button classes where they overlap; the All/Recent/Open-tabs sub-tabs, real thumbnails, and "edited Xm ago" remain **explicitly deferred** (tracked in the fast-follows doc), out of scope here.

**Placeholder scan:** none — the one `require('./DialogShell')` is explicitly called out with a mandatory static-import fix in an implementer note. ✅

**Type consistency:** `DialogShell` prop shape identical across Tasks 2-4; `describeCounts`/`diagramCounts`/`clearDiagram`/`mergeModel` signatures identical between Task 1 (definition) and Tasks 3-4 (consumption); the App `dialog` union (`'reset'|'delete'|'import'|null`) is introduced in Task 3 and extended-in-place by Task 4's `'import'` (already included in the Task 3 declaration). ✅

**Deferred (log to fast-follows if surfaced):** Open dialog sub-tabs/thumbnails/timestamps (pre-existing deferral); migrating New-diagram/New-flow/Rename-flow prompts is automatic via the shell refactor; `buildSeed` may become dead once reset no longer reseeds — leave for a cleanup sweep; drag-over highlight polish; focus-trap/tab-cycling inside dialogs (a11y pass).

# Note Spellcheck Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **View → Spellcheck notes** toggle that turns the browser's native spellcheck squiggles on note textareas on/off, default off, persisted per browser.

**Architecture:** A `noteSpellcheck` view preference in `App.tsx` (persisted to `localStorage`) drives a React context that `NoteNode` reads to set `spellCheck` on its `<textarea>`. The View menu exposes it as a checkmark toggle.

**Tech Stack:** React 18, @xyflow/react, plain CSS, Vitest (node env — no DOM).

## Global Constraints

- Capitalize only the first letter of multi-letter acronyms in identifiers.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Never mutate the "Homelab (sample)" diagram in any browser check — use a throwaway note.
- Do not commit `webapp/model.json` / `history.json` / `build/` / `dist/`.
- `localStorage` key: exactly `homelab-note-spellcheck`. Menu item id: exactly `note-spellcheck`. Menu label: exactly `Spellcheck notes`.

## File Structure

- **Modify** `webapp/src/nodes.tsx` — add `NoteSpellcheckContext`; `NoteNode` reads it and sets `spellCheck` on its textarea.
- **Modify** `webapp/src/App.tsx` — `noteSpellcheck` state + persistence, View menu item + handler, and wrap `<ReactFlow>` in the context provider.

All commands run from `webapp/`.

---

### Task 1: Note spellcheck toggle

**Files:**
- Modify: `webapp/src/nodes.tsx`
- Modify: `webapp/src/App.tsx`

**Interfaces:**
- Produces: `NoteSpellcheckContext` (a `React.Context<boolean>`) exported from `webapp/src/nodes.tsx`; consumed by `App.tsx`.

- [ ] **Step 1: Add the context + consume it in `NoteNode` (`nodes.tsx`)**

Change the React import at the top of `webapp/src/nodes.tsx` from:
```tsx
import { useEffect, useState } from 'react'
```
to:
```tsx
import { createContext, useContext, useEffect, useState } from 'react'
```

Add this near the top of the file (after the imports, before `SideHandles`):
```tsx
// Global toggle for the browser's native spellcheck on note textareas.
// Provided by App from a persisted view preference; default off = clean viewing.
export const NoteSpellcheckContext = createContext(false)
```

In `NoteNode`, read the context and apply it to the textarea. Change the start of `NoteNode` from:
```tsx
export function NoteNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as any
  return (
    <div className="note">
```
to:
```tsx
export function NoteNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as any
  const noteSpellcheck = useContext(NoteSpellcheckContext)
  return (
    <div className="note">
```

And add `spellCheck={noteSpellcheck}` to the `<textarea>`. Change:
```tsx
      <textarea
        value={d.text ?? ''}
        placeholder="note…"
```
to:
```tsx
      <textarea
        spellCheck={noteSpellcheck}
        value={d.text ?? ''}
        placeholder="note…"
```

- [ ] **Step 2: Add state + persistence in `App.tsx`**

Find the existing view-toggle state (around `const [showLegend, setShowLegend] = useState(true)` and `const [snapToGrid, setSnapToGrid] = useState(false)`). Immediately after the `snapToGrid` declaration, add:
```tsx
  const [noteSpellcheck, setNoteSpellcheck] = useState<boolean>(
    () => localStorage.getItem('homelab-note-spellcheck') === 'true',
  )
  useEffect(() => {
    localStorage.setItem('homelab-note-spellcheck', String(noteSpellcheck))
  }, [noteSpellcheck])
```
(`useState` and `useEffect` are already imported in `App.tsx`; if `useEffect` is somehow not imported, add it to the existing `react` import.)

- [ ] **Step 3: Add the View menu item + memo dep**

In the `viewMenuItems` `useMemo`, immediately after the `snap` item:
```tsx
      { id: 'snap', label: 'Snap to grid', checked: snapToGrid },
```
add:
```tsx
      { id: 'note-spellcheck', label: 'Spellcheck notes', checked: noteSpellcheck },
```

Then add `noteSpellcheck` to that `useMemo`'s dependency array. Change:
```tsx
    [showLegend, showMinimap, snapToGrid, railVisible, railTab],
```
to:
```tsx
    [showLegend, showMinimap, snapToGrid, noteSpellcheck, railVisible, railTab],
```

- [ ] **Step 4: Wire the handler**

In `onMenuItem`, inside the `if (menuId === 'view')` block, after the `snap` handler line:
```tsx
        else if (itemId === 'snap') setSnapToGrid((v) => !v)
```
add:
```tsx
        else if (itemId === 'note-spellcheck') setNoteSpellcheck((v) => !v)
```

- [ ] **Step 5: Import the context + wrap `<ReactFlow>` in the provider**

Add `NoteSpellcheckContext` to the existing import from `./nodes` in `App.tsx` (the one that already imports `nodeTypes`). For example, change:
```tsx
import { nodeTypes } from './nodes'
```
to:
```tsx
import { NoteSpellcheckContext, nodeTypes } from './nodes'
```
(If `nodeTypes` is imported alongside other names from `./nodes`, just add `NoteSpellcheckContext` to that list.)

Wrap the `<ReactFlow …>…</ReactFlow>` element (it opens around line 1518 and `nodeTypes={nodeTypes}` is one of its props) in the provider. So the structure becomes:
```tsx
      <NoteSpellcheckContext.Provider value={noteSpellcheck}>
        <ReactFlow
          …existing props and children unchanged…
        >
          …
        </ReactFlow>
      </NoteSpellcheckContext.Provider>
```
Only add the wrapping `<NoteSpellcheckContext.Provider value={noteSpellcheck}>` / `</NoteSpellcheckContext.Provider>` around the existing `<ReactFlow>` element — do not change ReactFlow's props or children.

- [ ] **Step 6: Typecheck + full test suite (must stay green)**

Run:
```bash
npm run typecheck
npm test
```
Expected: typecheck passes; all tests pass (this change touches only view wiring, no pure logic — there is nothing new to unit test in this node-env suite; browser verification is done by the controller).

- [ ] **Step 7: Commit**

```bash
git add src/nodes.tsx src/App.tsx
git commit -m "feat(view): toggle spellcheck on note text via View menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** context + textarea `spellCheck` (Step 1) ✔; persisted `noteSpellcheck` state, default off (Step 2) ✔; View menu item `note-spellcheck` / "Spellcheck notes" + deps (Step 3) ✔; handler (Step 4) ✔; provider wrap around ReactFlow (Step 5) ✔; suite stays green (Step 6) ✔. Browser verification (toggle flips squiggles + persists across reload) is controller validation, per the spec's Testing section.

**Placeholder scan:** none — every step has concrete code and exact identifiers.

**Type consistency:** `NoteSpellcheckContext` is `createContext(false)` (Context<boolean>); provided with `value={noteSpellcheck}` (boolean); consumed as `spellCheck={noteSpellcheck}` (boolean). Menu id `note-spellcheck` and localStorage key `homelab-note-spellcheck` match across steps and the spec.

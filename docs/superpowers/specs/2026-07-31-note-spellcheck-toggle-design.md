# Note Spellcheck Toggle — Design

**Date:** 2026-07-31
**Status:** Approved (design)

## Goal

Notes (the `NoteNode` `<textarea>`) show the browser's native spellcheck
squiggles, which are handy while editing but noise while viewing. Add a
**View → Spellcheck notes** toggle that turns those squiggles on/off,
defaulting to **off** (clean viewing), persisted per browser.

## Scope

- Affects only the free-text note textareas (`NoteNode` in `nodes.tsx`).
- Node labels / inspector fields are out of scope (user asked specifically
  about notes).

## Approach (chosen)

A global on/off view preference, not focus-based. All note textareas share
one setting.

## Components

### `webapp/src/nodes.tsx`
- Export a context: `export const NoteSpellcheckContext = createContext(false)`.
- In `NoteNode`, read it: `const noteSpellcheck = useContext(NoteSpellcheckContext)`
  and set `spellCheck={noteSpellcheck}` on the `<textarea>`.

### `webapp/src/App.tsx`
- **State:** `const [noteSpellcheck, setNoteSpellcheck] = useState<boolean>(() =>
  localStorage.getItem('homelab-note-spellcheck') === 'true')` (default
  false), near the other view toggles (`showLegend`, `snapToGrid`, ~line 234-238).
- **Persist:** `useEffect(() => localStorage.setItem('homelab-note-spellcheck',
  String(noteSpellcheck)), [noteSpellcheck])`.
- **Menu item:** add `{ id: 'note-spellcheck', label: 'Spellcheck notes',
  checked: noteSpellcheck }` to `viewMenuItems` in the display-toggle group
  (after the `snap` item); add `noteSpellcheck` to that `useMemo`'s deps.
- **Handler:** in `onMenuItem`'s `menuId === 'view'` branch, add
  `else if (itemId === 'note-spellcheck') setNoteSpellcheck((v) => !v)`.
- **Provider:** wrap the `<ReactFlow>…</ReactFlow>` element (~line 1518) in
  `<NoteSpellcheckContext.Provider value={noteSpellcheck}>` (import
  `NoteSpellcheckContext` from `./nodes`). React context reaches
  ReactFlow-rendered custom nodes.

## Behavior

- Default: **off** — note textareas render `spellCheck={false}`, no squiggles.
- Toggling the menu item flips the checkmark and every note's spellcheck live.
- The choice survives reload (localStorage), per browser (not shared via the
  model / server).

## Testing

No pure/unit-testable logic (UI state + a DOM attribute + localStorage). The
existing Vitest suite must stay green (this touches only view wiring).
Verification is a browser smoke:
- Toggle **View → Spellcheck notes** on → a misspelled word in a note shows a
  squiggle; the menu item shows a checkmark.
- Toggle off → squiggle disappears.
- Reload → the setting persists.
Use a throwaway diagram/note for the smoke — never the "Homelab (sample)".

## Out of scope

- Spellcheck on node labels, inspector inputs, or dialogs.
- Per-note or focus-based behavior.
- Syncing the preference across browsers/devices.

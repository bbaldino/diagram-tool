# Undo/Redo Design

**Status:** Design — approved in brainstorming, pending spec review.
**Branch:** builds on `feat/mcp-server-phase2`.

## Goal

Give the diagram canvas an undo/redo capability so a user can safely reverse
actions — most importantly a **Tidy** that repositioned everything — without
losing hand-tuned work. Undo is a first-class, server-owned feature that rides
the existing op → rev → SSE pipeline.

## Summary of decisions (from brainstorming)

1. **Scope: per-diagram, content only.** Undo affects the active diagram's
   `placements`, `groups`, `edges`, and `notes`. It does **not** cover the
   global entity catalog, templates, or the diagram list (add/rename/delete) —
   those are not undoable.
2. **Boundaries: one user action = one step.** A drag (press→release), a Tidy,
   a delete, a connect, a note edited until blur — each is exactly one undo
   step. Concretely: **one applied op-batch = one history entry per changed
   diagram** — created in-memory the moment the batch reaches `store.apply()`.
   This is unrelated to the debounced disk saves, which are a persistence
   optimization only. The client commits each action as its own op-batch.
   History is per-*action* (op-batch), deliberately **not** per-*operation* —
   we do not want Tidy or `author_diagram` to become many single-op steps.
3. **Shared linear timeline.** The diagram is a shared artifact; its history is
   one line, not per-user. Any committed change to a diagram's content — from
   this user, another tab, or an MCP agent — pushes an entry onto that
   diagram's timeline. Undo is itself an edit: it streams to every client, so
   undoing a change reverts it for everyone viewing that diagram. Per-user undo
   that preserves others' concurrent edits (OT/CRDT) is explicitly out of scope.
4. **Server-owned history.** There is one shared timeline, so it lives in the
   one place that already serializes every change in order: the store. Clients
   are thin — they call undo/redo endpoints and render whatever streams back.
5. **Storage: snapshots; deltas derived on demand.** Each history entry is a
   full copy of one diagram's content (a few KB). To move the pointer, the
   server computes the minimal ops with the existing `diffToOps` /
   `diffDiagramContents` machinery — no hand-written inverse ops. On the wire,
   undo is still a minimal delta; only *storage* keeps full snapshots.
6. **Persistence: sidecar `history.json`.** History persists to a separate
   git-ignored `webapp/history.json` (loaded/saved by the store next to
   `model.json`), so it survives a full `npm run dev` restart. `model.json`
   stays pure diagram data.

## Data model

Per diagram, the store holds a linear history:

```ts
// One diagram's undoable content (a slice of Diagram).
interface DiagramContent {
  placements: Placement[]
  groups: Group[]
  edges: DEdge[]
  notes: Note[]
}

interface DiagramHistory {
  entries: DiagramContent[] // index 0 = oldest kept state
  pointer: number           // index of the CURRENT state (entries[pointer])
}

// Keyed by diagram id.
type HistoryMap = Record<string, DiagramHistory>
```

Invariants:

- `entries[pointer]` **always equals the current model's content for that
  diagram.** Every content-changing apply keeps this true.
- `canUndo = pointer > 0`; `canRedo = pointer < entries.length - 1`.
- Depth is capped at `HISTORY_LIMIT = 100` entries per diagram. When a push
  would exceed it, drop the oldest entry (and decrement `pointer`).

## Server architecture (`webapp/server/store.ts`)

The store gains history alongside the model. Two apply paths, distinguished by
whether they *record* history:

**1. Recording apply (normal edits).** `apply(ops, writerId)` — unchanged
signature. After a real (non-no-op) apply, for each diagram id:

- **content changed** (compare `DiagramContent` before vs after by value): push
  a new entry. Truncate any redo entries after `pointer`, append the new
  content, set `pointer` to the new last index, enforce `HISTORY_LIMIT`.
- **diagram newly added**: seed `{ entries: [content], pointer: 0 }`.
- **diagram removed**: delete its `DiagramHistory`.

A single op-batch that touches two diagrams pushes one entry onto each of their
independent timelines.

**2. Navigating apply (undo/redo).** New methods:

```ts
undo(diagramId: string): Snapshot
redo(diagramId: string): Snapshot
```

Each:

- No-ops (returns current state) if the move isn't possible (`!canUndo` /
  `!canRedo`) or the diagram has no history.
- Computes the target index (`pointer - 1` or `pointer + 1`) and its snapshot.
- Derives ops via `diffDiagramContents(diagramId, currentContent, targetContent)`.
- Applies those ops **without recording history** and sets `pointer` to the
  target index (pointer-move, not a new branch — this is what makes undo itself
  redoable).
- Bumps rev, saves (model + history) debounced, broadcasts over SSE.
- Uses a writerId that is **not** any client's id (e.g. `'undo'`), so the
  initiating client does not skip the echo — it reconciles the reverted state
  like any external change.

**Snapshot gains per-diagram undo state** so clients can render button
enable/disable without extra queries:

```ts
interface Snapshot {
  rev: number
  model: Model
  writerId?: string
  undo: Record<string, { canUndo: boolean; canRedo: boolean }>
}
```

**Persistence.** `createStore` opts gain a history file with `loadHistory` /
`saveHistory` (JSON, debounced together with the model so the two never drift).
On startup, after loading both: for each diagram, if persisted
`entries[pointer]` does **not** equal the loaded model's content for that
diagram (e.g. `model.json` was hand-edited or re-imported), discard that
diagram's history and seed a fresh single-entry history from current content.
Diagrams present in the model but absent from history get a fresh single entry;
histories for diagrams no longer in the model are dropped.

## Server endpoints (`webapp/vite.config.ts`)

Two new routes, mirroring `/api/layout`:

- `POST /api/undo` `{ diagramId }` → `{ rev, canUndo, canRedo }`; 400 on bad
  body. Calls `store.undo(diagramId)`.
- `POST /api/redo` `{ diagramId }` → `{ rev, canUndo, canRedo }`; 400 on bad
  body. Calls `store.redo(diagramId)`.

The reverting change reaches all clients through the existing SSE stream; the
JSON response is only for the caller's immediate button state.

## Client architecture (`webapp/src/App.tsx`, `modelClient.ts`)

The client stays thin — no local snapshot stack.

- **Commit boundaries (per action).** Each user action commits as its own
  op-batch so the server records one entry per action:
  - Discrete commands (place, delete, connect, add group/note, color change,
    Tidy, inspector edits that change diagram content) flush the pending
    write-back and send that action's ops as a distinct batch.
  - Continuous gestures coalesce to one batch at gesture end: node drag on
    `onNodeDragStop`, group resize on resize end, inline-note text on blur.
    (Live intermediate frames still render; only the committed batch is what
    the history records.)
- **Invoking undo/redo.** `Ctrl/Cmd-Z` = undo, `Ctrl/Cmd-Shift-Z` and `Ctrl-Y`
  = redo, active only when the canvas is focused and the target is not a text
  input/textarea (so it doesn't hijack typing in a note or the Inspector).
  Toolbar **Undo** / **Redo** buttons sit in the diagram toolbar near Tidy.
  Both paths call `modelClient.undo(diagramId)` / `.redo(diagramId)` (thin
  `fetch` wrappers over the new endpoints).
- **Button state.** `canUndo`/`canRedo` for the active diagram come from
  `Snapshot.undo[activeId]` on each SSE frame (and the endpoint response for an
  instant local update). Buttons disable when the move isn't possible.
- **Reconciliation is unchanged.** The reverting delta arrives on the existing
  SSE path and re-seeds the active diagram exactly like a live MCP edit does
  today — no new rendering path.

## Data flow — one Ctrl-Z

1. Client `POST /api/undo { diagramId }`.
2. Store: target = `entries[pointer-1]`; `ops =
   diffDiagramContents(diagramId, entries[pointer], target)` (e.g. a single
   `placement.set` to restore a moved node; for a Tidy, exactly the nodes/groups
   whose positions differ).
3. Store applies `ops` without recording, sets `pointer -= 1`, bumps rev, saves
   (model + history) debounced, broadcasts.
4. All clients reconcile; only changed elements re-render. Initiator's buttons
   update from the response, everyone else's from the SSE `undo` map.

## Concurrency semantics

- External edits (other tab / MCP) to a diagram push entries onto that
  diagram's shared timeline just like local edits — no authorship tracking.
- **Agent (MCP) boundaries are per tool call.** Each MCP tool invocation is a
  discrete request that must commit as a single `store.apply()` (one op-batch)
  → one history entry. There is no timer in the agent path, so separate tool
  calls never merge. `author_diagram` is intentionally one batch = one step, so
  a single undo removes a whole agent-authored diagram rather than unwinding it
  node by node.
- A new committed change truncates the redo branch, as in any undo stack.
- Undo/redo are ordinary edits from the store's perspective (serialized revs),
  so there is no separate concurrency model to reason about. Last-writer-wins
  for genuinely simultaneous edits is inherited from the existing store and
  unchanged.

## Edge cases

- **Nothing to undo/redo:** endpoints no-op and report `canUndo/canRedo`
  honestly; buttons stay disabled.
- **No-op apply:** the store's existing byte-identical guard means a no-op edit
  never pushes a history entry.
- **Diagram deleted:** its history is dropped; a later re-add starts fresh.
- **Restart drift:** persisted-history-vs-model mismatch reseeds that diagram's
  history from current content (correctness over history preservation).
- **Depth cap:** oldest entries fall off at `HISTORY_LIMIT`; you can't undo
  past the cap.

## Testing

Vitest, server-side (no browser needed for the core):

- Store: recording apply pushes one entry per changed diagram; multi-diagram
  batch pushes to each timeline; redo truncation on new edit; `HISTORY_LIMIT`
  eviction; `undo`/`redo` derive correct ops and move the pointer without
  recording; `canUndo`/`canRedo` correctness; no-op guard doesn't push.
- Persistence: save/load round-trip; drift-reseed when model and history
  disagree; missing/extra diagram reconciliation.
- Endpoints: `/api/undo` and `/api/redo` happy path + bad body (400) + no-op.
- A focused integration test: apply a "Tidy-like" multi-node reposition, undo,
  assert the diagram content equals the pre-Tidy snapshot exactly.

## Out of scope / future

- Per-user undo preserving others' concurrent edits (OT/CRDT).
- Undoing global entity/template edits or diagram add/rename/delete.
- A visible history timeline / named checkpoints.
- Coalescing policy beyond per-action (e.g. merging a burst of tiny nudges).
- Strict per-action separation for *discrete* commands issued faster than the
  client send-settle (~500ms): such bursts may coalesce into one undo step.
  The high-value cases are already one step each — a drag (gesture-flushed),
  Tidy (`/api/layout` batch), and every MCP tool call (per-request batch).

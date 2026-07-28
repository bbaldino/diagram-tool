# Undo-history durability fix

**Date:** 2026-07-28
**Branch:** `fix/undo-history-reseed` (off `main`)
**Method:** systematic-debugging (root cause reproduced before fixing)

## Symptom

On the "Auth Proxy Architecture" diagram, undo stopped far earlier than the number of
edits made — nowhere near the 100-entry `HISTORY_LIMIT`. On disk, four diagrams' histories
had collapsed to a single entry each.

## Root cause

Undo history is server-side state (`webapp/server/history.ts`), persisted to `history.json`
alongside `model.json`, and **reconciled against the model at startup** (`server/store.ts`).
The old reconciliation discarded the entire stack on any mismatch:

```js
if (!current || JSON.stringify(current) !== JSON.stringify(diagramContent(d)))
  historyMap = history.seed(historyMap, d.id, diagramContent(d)) // WIPE
```

Two enablers let the model and history desync on disk, after which the reseed fired:

1. **Non-atomic, unordered persistence.** `model.json` and `history.json` were written as two
   independent, debounced `writeFile` calls (`store.ts` `scheduleSave`). A dev-server restart
   landing mid-write left `history.json` torn (→ `loadHistory` throws → empty map → every
   diagram reseeds) or left the model persisted ahead of history.
2. **Frequent restarts.** Vite restarts the Node server on any edit to a config-dependency
   module (`src/model.ts`, `server/*`, `src/ops.ts`, …). Routine development — including this
   project's own edits to `src/model.ts` — bounced the running server repeatedly, giving the
   desync many chances to fire.

The amplifier: a desync of a *single* unrecorded edit caused the reseed to discard the
*whole* stack. Reproduced in isolation: feeding a model one edit ahead of history wiped all
prior states (`canRedo: true → false`).

## Fix (two complementary halves)

**1. Reconciliation never destroys a stack** (`history.ts` `reconcile`, wired in `store.ts`):
- no history yet → seed one entry
- content == current head → unchanged (common case)
- content == some entry → move the pointer there (undo **and** redo preserved)
- content matches no entry (model ahead) → append as a new head, keeping the prior stack

So even an unforeseen desync can only ever *add* an entry, never wipe undo.

**2. Persistence can't desync** (`server/persist.ts` + `store.ts` ordering):
- `atomicWriteFile` writes to a temp sibling then `rename()`s over the target — `rename(2)` is
  atomic, so a torn/half-written file is never observed.
- `scheduleSave` snapshots the consistent `(history, model)` pair and writes **history before
  the model**, so history on disk is never staler than the model. The only possible skew
  becomes model-behind-history, which `reconcile` resolves losslessly by moving the pointer.

Belt (atomic + ordered writes stop the desync) and suspenders (reconcile refuses to destroy).

## Not changed / deferred

- `HISTORY_LIMIT` stays 100 (it was never the cause). Trivially tunable later if wanted.
- No move to an append-log / embedded DB: the failure was a missing `rename()`, not the flat
  file. An append store's benefits (write amplification, huge histories) don't apply at this
  single-user scale; revisit only if full-file rewrites ever actually hurt.

## Tests

- `server/history.test.ts` — `reconcile`: seed / no-op / setPointer / append cases.
- `server/store.test.ts` — regression: a model one edit ahead of a multi-entry history keeps
  the whole stack; model-behind realigns losslessly; saves persist history before model.
- `server/persist.test.ts` — atomic write replaces contents, leaves no temp files, survives
  rapid overwrites.

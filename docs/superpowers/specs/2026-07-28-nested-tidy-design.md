# Nested-aware Tidy (leaf-first recursive layout) — design

**Status:** Approved (design), pending implementation plan.
**Date:** 2026-07-28
**Branch:** `feat/nested-tidy` (off `main`).

## Motivation

The server-side layout path (`server/layout.ts` → `layout-elk.ts` / `layout-graphviz.ts`),
which the UI "Tidy" button drives via `POST /api/layout`, predates two model capabilities and
never caught up to them. Two concrete defects result:

1. **Nested groups get flattened.** Both adapters emit *every* group at the top level and only
   ever nest *node* placements into their parent group — a group's own `parentId` is ignored
   (ELK: all groups are `rootChildren`; Graphviz: all `cluster_*` subgraphs are emitted flat).
   So running Tidy on a group-inside-a-group **un-nests** the inner group — wrong output.
2. **Notes are ignored entirely.** Notes are never handed to the engine and never written back.
   Groups are therefore sized to fit only their node children, and a grouped note keeps its stale
   position while its parent group moves/resizes underneath it — so the note is flung outside the
   group or lands on top of nodes. The containment invariants (`reflowContainment` — padding,
   slack, grow-to-fit) are never applied to the engine's output either.

Neither is a regression; the engines were written when groups held only nodes and there were no
free-standing notes. From the user's seat it is a bug all the same: Tidy destroys nesting and
ejects notes.

## Approach: leaf-first recursive layout over flat engine calls

Rather than push a nested tree into the engine and rely on its hierarchical mode (ELK's
`INCLUDE_CHILDREN`, Graphviz nested clusters — the least predictable features of each), lay out
**one container at a time, innermost first**, and compose the results.

For the containment tree — the canvas (root) contains top-level nodes/groups/notes; each group
contains its child nodes/groups/notes — process **leaf-first (post-order)**:

1. Recurse into a container's child groups first, so each child group's **size** is already
   computed before the container itself is laid out.
2. Lay out the container's **direct children** as a single **flat** set of sized boxes:
   - each direct **node** → a fixed-size box (`W` × node height),
   - each direct **child group** → a fixed-size box **of that group's already-computed size**
     (the container neither knows nor cares what is inside it),
   - each direct **note** → a box of the note's own size,
   - plus the **edges whose lowest common ancestor is this container** (see *Edges*).
3. The flat layout returns each box's position plus the overall bounding size. The container
   group's **size** is that bounding box grown by containment padding/slack
   (`requiredGroupSize` / the containment constants). Positions are kept **relative to the
   container** (the model's convention for a child's `position`).
4. The **root/canvas** level is laid out the same way over top-level nodes and top-level
   groups-as-boxes. **Top-level (un-parented) notes are excluded** and left exactly where they
   are — Tidy only arranges the graph and grouped notes (see *Scope decisions*).
5. **`reflowContainment`** runs on the fully-assembled diagram as the final backstop, so every
   group still satisfies the canvas's padding/slack/grow-to-fit invariants regardless of what the
   engines returned.

### Worked example

```
Root
└─ Group B: { entity b1, Group C }
   └─ Group C: { entity c1, Group D }
      └─ Group D: { entity d1, entity d2 }
```

- Tidy **D** alone → `d1`, `d2` packed; `size(D)` set.
- Tidy **C** seeing two children — `c1` and a box the size of D → `size(C)`.
- Tidy **B** seeing `b1` and a box the size of C → `size(B)`.
- Tidy **Root** seeing box-B (+ any other top-level items).
- Compose absolute positions top-down; store each child's position relative to its parent;
  `reflowContainment` backstop.

## Engine adapter interface (simplified)

Because every engine call is now a **flat** layout of sized boxes, the adapters shrink to one job
and all cluster/hierarchy code is **removed**:

```ts
// One flat layout. No groups, no clusters, no hierarchy.
type FlatBox   = { id: string; width: number; height: number }
type FlatEdge  = { id: string; from: string; to: string }
type FlatResult = { positions: Record<string, { x: number; y: number }>; size: { width: number; height: number } }
type FlatEngine = (boxes: FlatBox[], edges: FlatEdge[]) => Promise<FlatResult>
```

- **ELK** (`runElk`): a single flat `layered` / `elk.direction=RIGHT` graph with the existing
  spacing options; **no** `INCLUDE_CHILDREN`, **no** group nodes. Positions are top-left; `size`
  is the graph bounding box.
- **Graphviz** (`runGraphviz`): a single flat `digraph`, `rankdir=LR`, fixed-size (`fixedsize`)
  nodes; **no** `cluster_*` subgraphs. Same Y-up→Y-down flip as today.
- Group framing (position + size) is now the **orchestrator's** responsibility, not the engine's.

The recursive orchestrator lives in `server/layout.ts` and is **pure** (its only side effect is
awaiting the injected flat engine), so it is exercised in tests with a deterministic fake engine —
no ELK/Graphviz quirks in the tested logic.

## Edges

Each edge is laid out at **exactly one level**: the **lowest common ancestor (LCA)** container of
its two endpoints. At that level it is **contracted** to the two *direct children of the LCA* that
contain its endpoints — `(directChildContaining(from), directChildContaining(to))` — so it
influences how those two boxes are placed relative to each other. Edges whose endpoints are both
inside the same direct child are handled deeper (their real LCA is deeper); edges fully inside one
group only affect that group's internal layout.

After the full composition, edge connection handles are baked from the **final absolute geometry**
exactly as today (`assignEdgeHandles`), so a cross-boundary edge influences *box placement* at its
LCA and its endpoint sides follow the final node centers.

## Coordinate correctness under nesting

A nested group's stored `position` is relative to **its** parent, not the canvas. Two spots that
currently assume a child is at most one group deep must walk the **full parent chain**:

- `absoluteCenter` (used to bake edge handles) — accumulate every ancestor group's offset, not
  just the immediate parent's.
- the orchestrator's write-back — convert each laid-out absolute position to **parent-relative**
  against the correct (possibly nested) parent.

These are mechanical but load-bearing: getting them wrong silently misplaces edges and nested
groups. The plan calls them out with explicit tests.

## Where it lives

- `server/layout.ts` — the recursive leaf-first orchestrator + the `FlatEngine` interface;
  `absoluteCenter` walks the full chain; `layoutDiagram` returns `{ nodes, groups, notes, edges }`.
- `server/layout-elk.ts` / `server/layout-graphviz.ts` — reduced to the flat `FlatEngine`.
- `server/mcp.ts` `handlers.layout` (and the `/api/layout` write-back path) — persist
  **notes** in addition to nodes/groups/edges, and run `reflowContainment` on the result before
  diffing to ops (still a single `store.apply` / one undo step).
- **Client unchanged** — it still `POST`s `/api/layout`; the moves stream back over SSE as today.

## Scope decisions (settled during design)

- **Grouped notes: Tidy owns their arrangement** — they are laid out inside their group like any
  other child and the group grows to fit them.
- **Top-level notes: untouched** — a free-floating annotation is treated as deliberate; Tidy does
  not relocate it (there is no natural "tidy" position for a disconnected note).

## Testing

- **Orchestrator (pure, fake engine):** leaf-first (post-order) call order; a group is sized to
  its children + padding; a nested group stays nested with parent-relative coordinates; a grouped
  note lands inside and its group grows; edge LCA contraction picks the right level; the 3-level
  B/C/D example composes correctly end-to-end.
- **Each adapter:** a flat set of sized boxes returns positions + a bounding size; fixed-size
  boxes are respected; existing per-engine tests are adapted to the flat interface.
- **`layoutDiagram` round-trip:** the B/C/D example returns nested, parent-relative,
  reflow-valid positions with notes placed inside their groups.
- **Browser (Playwright):** Tidy a diagram with a nested group and a grouped note; nesting is
  preserved, the note sits inside its group, nothing overlaps.

## Out of scope (follow-ups)

- Global cross-hierarchy edge *routing* — edges influence box placement at their LCA only, not
  end-to-end routed paths.
- Any change to interactive drag/nest behavior on the canvas.
- Arranging top-level notes.

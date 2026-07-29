# MCP edit-surface completion + shared containment — design

**Status:** Approved (design), pending implementation plan.
**Date:** 2026-07-29
**Branch:** `feat/mcp-edit-surface` (off `main`).
**Supersedes the intent of:** the deferred "Phase 2 — MCP resolution/search layer." A POC (below) showed the resolution layer solves a non-problem; the real gap is a missing edit surface.

## Motivation (from a POC)

Two fresh, cold agents (MCP-only) ran the same build-then-edit task — one favoring one-shot
`author_diagram`, one using incremental primitives:

- **uuid/resolution was a non-issue.** Creation tools (`add_node`, `connect`) return ids inline;
  agents threaded them through edits with zero lookups or errors. So a name→uuid resolution layer
  is *not* needed (left as an optional future add-on for editing large pre-existing diagrams).
- **The real gap is an incomplete incremental edit surface.** Both agents hit hard walls:
  - **No `edit_node`** — can't rename or update a node (yet `set_edge`/`set_note` exist). One agent
    resorted to delete+recreate, which mints a new uuid and silently breaks references.
  - **No `add_group`/`edit_group`** — groups are first-class in the model (`remove` takes a
    `groupId`, `author_diagram` has a `groups` spec) but can't be created/edited incrementally.
  - **No reparent** — can't move an existing node/note into (or out of) a group.
  - **No diagram lifecycle** — no create-empty / rename / delete diagram; the only door in is
    `author_diagram` (which only *creates new*).
- **`author_diagram` (one-shot) is excellent for scaffolding** but has no edit/upsert path.

Conclusion: keep `author_diagram` for scaffolding; **complete the incremental edit surface** for
surgical edits. And because the group padding/sizing invariants currently live client-side, MCP-driven
grouping/reparenting would otherwise produce overlapping/unsized groups — so this work also
**extracts those invariants into a shared module** enforced on the MCP path.

## Part 1 — Complete the MCP edit surface

Adopt a consistent verb scheme (renaming the existing `set_*` oddballs):

- **Create:** `add_node`, `add_group`, `add_note`, `connect` (edge), `new_diagram`.
- **Edit:** `edit_node`, `edit_group`, `edit_edge`, `edit_note`.
- **Delete:** `remove` (already unified over node/edge/group/note ids); add `delete_diagram`.
- **Diagram:** `new_diagram`, `rename_diagram`, `delete_diagram`, plus existing `list_diagrams`/`get_diagram`.

New/changed tools:

- **`edit_node`** (new) — update a node in a diagram by id: any of `label`, `icon`, `sub`, `status`,
  `actor`, `fields`, **`parentId`**. `parentId` is the reparent: setting it moves the node into a
  group (or `null`/absent to un-parent). No separate reparent tool. Returns `{ ok }`.
- **`add_group`** (new) — create a group in an existing diagram: `label`, optional `color`,
  optional `parentId` (for nesting), optional initial `position`/`size` (else defaults). Returns the
  new group's `{ id }`.
- **`edit_group`** (new) — update a group by id: `label`, `color`, `size`, **`parentId`**.
- **`add_note`** (new) / **`edit_note`** (new) — split the current `set_note` into clean
  create/update; both support `text`, `position`/`size`, **`parentId`**. `add_note` returns `{ id }`.
- **`edit_edge`** — rename of `set_edge` (same behavior).
- **`new_diagram`** (new) — create an empty diagram (`name`, optional `type`, default `canvas`).
  Returns `{ id }`. `rename_diagram` (new), `delete_diagram` (new).
- **Renames:** `set_edge`→`edit_edge`, `set_note`→`edit_note` (its update behavior; create moves to
  `add_note`). Update tool descriptions accordingly.
- **Unchanged:** `author_diagram` (scaffolding), `connect`, `remove`, `layout`, the flow tools,
  `list_nodes`, `list_diagrams`, `get_diagram`.

All handlers build `Op[]` and apply through the store (tagged `'mcp'`) exactly like the current ones;
creation tools return the minted uuid(s). Reuse `resolveElementRef` for id validation.

## Part 2 — Shared containment module

Extract the group containment/sizing invariants from `src/graph.ts` into a **server-safe, model-level
module** (`src/containment.ts`, no `@xyflow`/React/DOM import) so every mutation path enforces them.

- **Move the pure geometry** already written: `requiredGroupSize`, `paddedExtent`, `placeInGroup`, and
  the constants `GROUP_PAD`, `GROUP_MIN`, `GROUP_NEST_TOP_PAD`, `GROUP_SLACK`.
- **Add a model-level reflow** — `reflowContainment(diagram): Diagram` — that operates on the model's
  `nodes`/`groups`/`notes` (positions/sizes/parentId), not React Flow `Node[]`: grows groups to fit
  their children with padding + slack (inner-first cascade), floored at `GROUP_MIN`; places a
  newly-parented child non-overlapping via `placeInGroup`. (The existing RF-node-shaped
  `reflowGroups`/`growGroupsToFitChildren` in `graph.ts` become thin adapters over this, or the client
  adopts the model-level version directly — pick whichever keeps the client behavior identical.)
- **Apply on the MCP mutation path:** after `add_group`/`edit_group`/`edit_node`(parentId)/`add_note`/
  `edit_note`(parentId) change containment, run `reflowContainment` on the affected diagram before the
  op is finalized (or as part of the mutator), so an agent-made group is padded/sized correctly and a
  reparented node lands non-overlapping — the same result a human gets dragging in the UI.
- **Client keeps identical behavior** — it uses the shared module (directly or via adapters); no
  visible change to interactive nesting.

## Out of scope (follow-ups)

- **Tidy for the new nesting/notes model** — feed notes into layout and run `reflowContainment` on the
  layout result. This becomes a *small* follow-up now that containment is shared. (The layout engines
  are already server-side; this is about post-processing their output + including notes.)
- **A `find`/search-by-name tool** — optional; only helps editing large pre-existing diagrams the
  agent didn't build. Not needed per the POC.
- **`author_diagram` upsert/edit mode** — not needed; scaffolding + incremental edits cover it.

## Testing

- **Unit** (`server/mcp.test.ts`): each new/renamed tool round-trips (create returns a uuid; `edit_node`
  updates label + reparents via `parentId`; `add_group`/`edit_group`; `add_note`/`edit_note`;
  `new_diagram`/`rename_diagram`/`delete_diagram`); old `set_edge`/`set_note` names are gone, new names
  present. `containment.test.ts`: `reflowContainment` grows a parent to contain a reparented child
  with padding (no overlap, movable), inner-first cascade; the pure helpers keep their existing tests.
- **Cross-check** the client still nests/sizes identically (existing `graph.test.ts`/`buildGraph.test.ts`
  stay green; if the client adopts the model-level reflow, adapt those tests).
- **Browser (Playwright):** an agent-style sequence via MCP — `new_diagram`, `add_node`s, `connect`,
  `add_group` + reparent via `edit_node` — renders correctly (group padded/sized, child inside, no
  overlap), matching a human-built equivalent.

## Cleanup

Delete the leftover POC/scratch diagrams (`d-poc-oneshot-test`, `d-incremental-poc`, `d-untitled`) —
and note that until `delete_diagram` lands, that's a client-only action.
